import prisma from '../db/prisma';
import { AppError } from '../middleware/error-handler';
import {
  ConversationDto,
  ConversationListQueryDto,
  UpdateConversationDto,
  MessageDto,
  InboxSummaryDto,
  ConversationStatus,
  ConversationPhase,
  MessageDirection,
  MessageKind,
  GeoCheckResult,
} from '@whatres/shared';
import { Prisma } from '@prisma/client';

export class InboxService {
  // ==================== CONVERSATIONS ====================

  async getConversations(
    tenantId: string,
    query: ConversationListQueryDto
  ): Promise<{ conversations: ConversationDto[]; total: number }> {
    const where: Prisma.ConversationWhereInput = {
      tenantId,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.q) {
      where.OR = [
        { customerPhone: { contains: query.q, mode: 'insensitive' } },
        { customerName: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        take: query.limit || 50,
        skip: query.offset || 0,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    return {
      conversations: conversations.map((c) => this.mapConversationToDto(c)),
      total,
    };
  }

  async getConversation(tenantId: string, conversationId: string): Promise<ConversationDto> {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!conversation) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }

    return this.mapConversationToDto(conversation);
  }

  async updateConversation(
    tenantId: string,
    conversationId: string,
    dto: UpdateConversationDto
  ): Promise<ConversationDto> {
    const existing = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });

    if (!existing) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }

    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: dto.status,
        customerName: dto.customerName,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return this.mapConversationToDto(conversation);
  }

  async getOrCreateConversation(
    tenantId: string,
    customerPhone: string,
    customerName?: string
  ): Promise<ConversationDto> {
    let conversation = await prisma.conversation.findUnique({
      where: {
        tenantId_customerPhone: { tenantId, customerPhone },
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId,
          customerPhone,
          customerName,
          status: 'OPEN',
        },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    } else if (conversation.status === 'CLOSED') {
      // Reopen closed conversation on new incoming message
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: 'OPEN' },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    }

    return this.mapConversationToDto(conversation);
  }

  // ==================== MESSAGES ====================

  async getMessages(
    tenantId: string,
    conversationId: string,
    limit = 100,
    before?: string
  ): Promise<MessageDto[]> {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });

    if (!conversation) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }

    const where: Prisma.MessageWhereInput = {
      conversationId,
      tenantId,
    };

    if (before) {
      const beforeMessage = await prisma.message.findUnique({ where: { id: before } });
      if (beforeMessage) {
        where.createdAt = { lt: beforeMessage.createdAt };
      }
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        sender: {
          select: { id: true, name: true },
        },
      },
    });

    // Return in chronological order
    return messages.reverse().map((m) => this.mapMessageToDto(m));
  }

  async createMessage(
    tenantId: string,
    conversationId: string,
    direction: MessageDirection,
    kind: MessageKind,
    text: string | null,
    payloadJson?: Record<string, unknown>,
    senderUserId?: string,
    externalId?: string
  ): Promise<MessageDto> {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });

    if (!conversation) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }

    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          tenantId,
          conversationId,
          direction,
          kind,
          text,
          payloadJson: (payloadJson ?? undefined) as Prisma.InputJsonValue | undefined,
          senderUserId,
          externalId,
        },
        include: {
          sender: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          // Set to PENDING_AGENT if incoming message and currently OPEN
          ...(direction === 'IN' && conversation.status === 'OPEN'
            ? { status: 'PENDING_AGENT' }
            : {}),
        },
      }),
    ]);

    return this.mapMessageToDto(message);
  }

  async replyToConversation(
    tenantId: string,
    conversationId: string,
    text: string,
    senderUserId: string
  ): Promise<MessageDto> {
    return this.createMessage(tenantId, conversationId, 'OUT', 'TEXT', text, undefined, senderUserId);
  }

  // ==================== PHASE MANAGEMENT ====================

  async updateConversationPhase(
    tenantId: string,
    conversationId: string,
    phase: ConversationPhase,
    activeOrderId?: string | null,
  ): Promise<void> {
    await prisma.conversation.update({
      where: { id: conversationId, tenantId },
      data: {
        phase,
        ...(activeOrderId !== undefined ? { activeOrderId } : {}),
      },
    });
  }

  async getConversationRaw(tenantId: string, conversationId: string) {
    return prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
  }

  // ==================== GEO CHECK ====================

  async updateConversationGeoCheck(
    tenantId: string,
    conversationId: string,
    geoCheck: GeoCheckResult
  ): Promise<void> {
    await prisma.conversation.update({
      where: { id: conversationId, tenantId },
      data: {
        isWithinService: geoCheck.isWithinServiceArea,
        nearestStoreId: geoCheck.nearestStore?.id || null,
        geoCheckJson: geoCheck as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async getConversationGeoCheck(
    tenantId: string,
    conversationId: string
  ): Promise<GeoCheckResult | null> {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { geoCheckJson: true },
    });

    if (!conversation?.geoCheckJson) {
      return null;
    }

    return conversation.geoCheckJson as unknown as GeoCheckResult;
  }

  // ==================== SUMMARY ====================

  async getSummary(tenantId: string): Promise<InboxSummaryDto> {
    const [total, open, pendingAgent, closed] = await Promise.all([
      prisma.conversation.count({ where: { tenantId } }),
      prisma.conversation.count({ where: { tenantId, status: 'OPEN' } }),
      prisma.conversation.count({ where: { tenantId, status: 'PENDING_AGENT' } }),
      prisma.conversation.count({ where: { tenantId, status: 'CLOSED' } }),
    ]);

    return { total, open, pendingAgent, closed };
  }

  // ==================== HELPERS ====================

  private mapConversationToDto(conversation: any): ConversationDto {
    return {
      id: conversation.id,
      tenantId: conversation.tenantId,
      customerPhone: conversation.customerPhone,
      customerName: conversation.customerName,
      status: conversation.status as ConversationStatus,
      phase: (conversation.phase as ConversationPhase) || 'IDLE',
      activeOrderId: conversation.activeOrderId || null,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
      lastMessage: conversation.messages?.[0]
        ? this.mapMessageToDto(conversation.messages[0])
        : undefined,
      customerLat: conversation.customerLat,
      customerLng: conversation.customerLng,
      isWithinService: conversation.isWithinService,
      nearestStoreId: conversation.nearestStoreId,
    };
  }

  private mapMessageToDto(message: any): MessageDto {
    return {
      id: message.id,
      tenantId: message.tenantId,
      conversationId: message.conversationId,
      direction: message.direction as MessageDirection,
      kind: message.kind as MessageKind,
      text: message.text,
      payloadJson: message.payloadJson as Record<string, unknown> | null,
      senderUserId: message.senderUserId,
      senderName: message.sender?.name,
      externalId: message.externalId,
      createdAt: message.createdAt.toISOString(),
    };
  }
}

export const inboxService = new InboxService();

