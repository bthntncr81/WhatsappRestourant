import prisma from '../db/prisma';
import { AppError } from '../middleware/error-handler';
import { createLogger } from '../logger';
import {
  ConversationAssignmentDto,
  ConversationLockDto,
  ConversationParticipantDto,
  InternalNoteDto,
  AgentDto,
} from '@whatres/shared';
import { inboxService } from './inbox.service';

const logger = createLogger();

// Lock TTL in milliseconds (2 minutes)
const LOCK_TTL_MS = 2 * 60 * 1000;

export class AssignmentService {
  // ==================== ASSIGNMENT ====================

  async getAssignment(
    tenantId: string,
    conversationId: string
  ): Promise<ConversationAssignmentDto | null> {
    const assignment = await prisma.conversationAssignment.findUnique({
      where: { conversationId },
      include: {
        assignedUser: { select: { id: true, name: true } },
      },
    });

    if (!assignment) return null;

    return {
      id: assignment.id,
      tenantId: assignment.tenantId,
      conversationId: assignment.conversationId,
      assignedUserId: assignment.assignedUserId,
      assignedUserName: assignment.assignedUser.name,
      assignedAt: assignment.assignedAt.toISOString(),
    };
  }

  async assignConversation(
    tenantId: string,
    conversationId: string,
    assignedUserId: string
  ): Promise<ConversationAssignmentDto> {
    // Verify conversation belongs to tenant
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });

    if (!conversation) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }

    // Verify user belongs to tenant
    const membership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: assignedUserId } },
      include: { user: { select: { id: true, name: true } } },
    });

    if (!membership) {
      throw new AppError(400, 'INVALID_USER', 'User is not a member of this tenant');
    }

    // Upsert assignment
    const assignment = await prisma.conversationAssignment.upsert({
      where: { conversationId },
      create: {
        tenantId,
        conversationId,
        assignedUserId,
      },
      update: {
        assignedUserId,
        assignedAt: new Date(),
      },
      include: {
        assignedUser: { select: { id: true, name: true } },
      },
    });

    logger.info(
      { tenantId, conversationId, assignedUserId },
      'Conversation assigned'
    );

    return {
      id: assignment.id,
      tenantId: assignment.tenantId,
      conversationId: assignment.conversationId,
      assignedUserId: assignment.assignedUserId,
      assignedUserName: assignment.assignedUser.name,
      assignedAt: assignment.assignedAt.toISOString(),
    };
  }

  async unassignConversation(
    tenantId: string,
    conversationId: string
  ): Promise<void> {
    await prisma.conversationAssignment.deleteMany({
      where: { conversationId, tenantId },
    });

    logger.info({ tenantId, conversationId }, 'Conversation unassigned');
  }

  // ==================== HANDOFF ====================

  async handoffToAgent(
    tenantId: string,
    conversationId: string
  ): Promise<void> {
    // Update conversation status
    await prisma.conversation.update({
      where: { id: conversationId, tenantId },
      data: { status: 'PENDING_AGENT' },
    });

    // Send bot message
    await inboxService.createMessage(
      tenantId,
      conversationId,
      'OUT',
      'SYSTEM',
      '🔄 Sizi bir temsilciye bağlıyorum. Lütfen bekleyin.',
      undefined,
      undefined
    );

    logger.info({ tenantId, conversationId }, 'Conversation handed off to agent');
  }

  // ==================== LOCK ====================

  async getLock(
    tenantId: string,
    conversationId: string,
    currentUserId: string
  ): Promise<ConversationLockDto | null> {
    // Clean up expired locks
    await this.cleanupExpiredLocks();

    const lock = await prisma.conversationLock.findUnique({
      where: { conversationId },
      include: {
        lockedBy: { select: { id: true, name: true } },
      },
    });

    if (!lock) return null;

    return {
      conversationId: lock.conversationId,
      lockedByUserId: lock.lockedByUserId,
      lockedByUserName: lock.lockedBy.name,
      lockedAt: lock.lockedAt.toISOString(),
      expiresAt: lock.expiresAt.toISOString(),
      isOwnLock: lock.lockedByUserId === currentUserId,
    };
  }

  async acquireLock(
    tenantId: string,
    conversationId: string,
    userId: string
  ): Promise<ConversationLockDto> {
    // Clean up expired locks
    await this.cleanupExpiredLocks();

    // Check for existing lock
    const existingLock = await prisma.conversationLock.findUnique({
      where: { conversationId },
    });

    if (existingLock && existingLock.lockedByUserId !== userId) {
      throw new AppError(
        409,
        'CONVERSATION_LOCKED',
        'Conversation is locked by another user'
      );
    }

    const expiresAt = new Date(Date.now() + LOCK_TTL_MS);

    const lock = await prisma.conversationLock.upsert({
      where: { conversationId },
      create: {
        conversationId,
        lockedByUserId: userId,
        expiresAt,
      },
      update: {
        lockedByUserId: userId,
        lockedAt: new Date(),
        expiresAt,
      },
      include: {
        lockedBy: { select: { id: true, name: true } },
      },
    });

    logger.info({ tenantId, conversationId, userId }, 'Lock acquired');

    return {
      conversationId: lock.conversationId,
      lockedByUserId: lock.lockedByUserId,
      lockedByUserName: lock.lockedBy.name,
      lockedAt: lock.lockedAt.toISOString(),
      expiresAt: lock.expiresAt.toISOString(),
      isOwnLock: true,
    };
  }

  async refreshLock(
    tenantId: string,
    conversationId: string,
    userId: string
  ): Promise<ConversationLockDto> {
    const existingLock = await prisma.conversationLock.findUnique({
      where: { conversationId },
    });

    if (!existingLock) {
      throw new AppError(404, 'LOCK_NOT_FOUND', 'No lock exists for this conversation');
    }

    if (existingLock.lockedByUserId !== userId) {
      throw new AppError(403, 'NOT_LOCK_OWNER', 'You do not own this lock');
    }

    const expiresAt = new Date(Date.now() + LOCK_TTL_MS);

    const lock = await prisma.conversationLock.update({
      where: { conversationId },
      data: { expiresAt },
      include: {
        lockedBy: { select: { id: true, name: true } },
      },
    });

    return {
      conversationId: lock.conversationId,
      lockedByUserId: lock.lockedByUserId,
      lockedByUserName: lock.lockedBy.name,
      lockedAt: lock.lockedAt.toISOString(),
      expiresAt: lock.expiresAt.toISOString(),
      isOwnLock: true,
    };
  }

  async releaseLock(
    tenantId: string,
    conversationId: string,
    userId: string
  ): Promise<void> {
    const existingLock = await prisma.conversationLock.findUnique({
      where: { conversationId },
    });

    if (!existingLock) return;

    if (existingLock.lockedByUserId !== userId) {
      throw new AppError(403, 'NOT_LOCK_OWNER', 'You do not own this lock');
    }

    await prisma.conversationLock.delete({
      where: { conversationId },
    });

    logger.info({ tenantId, conversationId, userId }, 'Lock released');
  }

  async canWrite(
    tenantId: string,
    conversationId: string,
    userId: string
  ): Promise<boolean> {
    // Clean up expired locks first
    await this.cleanupExpiredLocks();

    const lock = await prisma.conversationLock.findUnique({
      where: { conversationId },
    });

    // No lock = anyone can write
    if (!lock) return true;

    // Owner of lock can write
    return lock.lockedByUserId === userId;
  }

  private async cleanupExpiredLocks(): Promise<void> {
    await prisma.conversationLock.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
  }

  // ==================== PARTICIPANTS ====================

  async getParticipants(
    tenantId: string,
    conversationId: string
  ): Promise<ConversationParticipantDto[]> {
    const participants = await prisma.conversationParticipant.findMany({
      where: { tenantId, conversationId },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return participants.map((p) => ({
      id: p.id,
      conversationId: p.conversationId,
      userId: p.userId,
      userName: p.user.name,
      canWrite: p.canWrite,
      joinedAt: p.joinedAt.toISOString(),
    }));
  }

  async joinConversation(
    tenantId: string,
    conversationId: string,
    userId: string,
    userRole: string
  ): Promise<ConversationParticipantDto> {
    // Verify conversation exists
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });

    if (!conversation) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }

    // Determine write permission based on role
    const canWrite = ['OWNER', 'ADMIN', 'AGENT'].includes(userRole);

    const participant = await prisma.conversationParticipant.upsert({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      create: {
        tenantId,
        conversationId,
        userId,
        canWrite,
      },
      update: {
        canWrite,
      },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    logger.info({ tenantId, conversationId, userId, canWrite }, 'User joined conversation');

    return {
      id: participant.id,
      conversationId: participant.conversationId,
      userId: participant.userId,
      userName: participant.user.name,
      canWrite: participant.canWrite,
      joinedAt: participant.joinedAt.toISOString(),
    };
  }

  async leaveConversation(
    tenantId: string,
    conversationId: string,
    userId: string
  ): Promise<void> {
    await prisma.conversationParticipant.deleteMany({
      where: { conversationId, userId },
    });

    // Also release any lock held by this user
    await prisma.conversationLock.deleteMany({
      where: { conversationId, lockedByUserId: userId },
    });

    logger.info({ tenantId, conversationId, userId }, 'User left conversation');
  }

  // ==================== INTERNAL NOTES ====================

  async getInternalNotes(
    tenantId: string,
    conversationId: string
  ): Promise<InternalNoteDto[]> {
    const notes = await prisma.internalNote.findMany({
      where: { tenantId, conversationId },
      include: {
        author: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return notes.map((n) => ({
      id: n.id,
      tenantId: n.tenantId,
      conversationId: n.conversationId,
      authorUserId: n.authorUserId,
      authorName: n.author.name,
      text: n.text,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));
  }

  async createInternalNote(
    tenantId: string,
    conversationId: string,
    authorUserId: string,
    text: string
  ): Promise<InternalNoteDto> {
    const note = await prisma.internalNote.create({
      data: {
        tenantId,
        conversationId,
        authorUserId,
        text,
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    logger.info({ tenantId, conversationId, authorUserId }, 'Internal note created');

    return {
      id: note.id,
      tenantId: note.tenantId,
      conversationId: note.conversationId,
      authorUserId: note.authorUserId,
      authorName: note.author.name,
      text: note.text,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  async updateInternalNote(
    tenantId: string,
    noteId: string,
    authorUserId: string,
    text: string
  ): Promise<InternalNoteDto> {
    const existing = await prisma.internalNote.findFirst({
      where: { id: noteId, tenantId },
    });

    if (!existing) {
      throw new AppError(404, 'NOTE_NOT_FOUND', 'Internal note not found');
    }

    if (existing.authorUserId !== authorUserId) {
      throw new AppError(403, 'NOT_AUTHOR', 'You can only edit your own notes');
    }

    const note = await prisma.internalNote.update({
      where: { id: noteId },
      data: { text },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    return {
      id: note.id,
      tenantId: note.tenantId,
      conversationId: note.conversationId,
      authorUserId: note.authorUserId,
      authorName: note.author.name,
      text: note.text,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  async deleteInternalNote(
    tenantId: string,
    noteId: string,
    authorUserId: string,
    isAdmin: boolean
  ): Promise<void> {
    const existing = await prisma.internalNote.findFirst({
      where: { id: noteId, tenantId },
    });

    if (!existing) {
      throw new AppError(404, 'NOTE_NOT_FOUND', 'Internal note not found');
    }

    if (existing.authorUserId !== authorUserId && !isAdmin) {
      throw new AppError(403, 'NOT_AUTHOR', 'You can only delete your own notes');
    }

    await prisma.internalNote.delete({
      where: { id: noteId },
    });

    logger.info({ tenantId, noteId }, 'Internal note deleted');
  }

  // ==================== AGENTS ====================

  async getAvailableAgents(tenantId: string): Promise<AgentDto[]> {
    const memberships = await prisma.membership.findMany({
      where: {
        tenantId,
        role: { in: ['OWNER', 'ADMIN', 'AGENT'] },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return memberships.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    }));
  }
}

export const assignmentService = new AssignmentService();


