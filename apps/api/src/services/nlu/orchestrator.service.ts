import prisma from '../../db/prisma';
import { inboxService } from '../inbox.service';
import { menuCandidateService } from './menu-candidate.service';
import { llmExtractorService } from './llm-extractor.service';
import { createLogger } from '../../logger';
import {
  OrderIntentDto,
  ExtractedOrderData,
  LlmExtractionResponse,
} from '@whatres/shared';

const logger = createLogger();

// Confidence threshold for auto-confirmation
const CONFIDENCE_THRESHOLD = 0.7;

export interface OrchestrationResult {
  success: boolean;
  orderIntent?: OrderIntentDto;
  responseSent?: boolean;
  error?: string;
}

export class NluOrchestratorService {
  /**
   * Process incoming text message and extract order intent
   */
  async processMessage(
    tenantId: string,
    conversationId: string,
    messageId: string,
    userText: string
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();

    try {
      // Check if LLM is available
      if (!llmExtractorService.isAvailable()) {
        logger.warn({ tenantId }, 'LLM not available, skipping order extraction');
        return { success: false, error: 'LLM service not configured' };
      }

      // 1. Find menu candidates
      const candidates = await menuCandidateService.findCandidates(
        tenantId,
        userText
      );

      if (candidates.length === 0) {
        logger.info(
          { tenantId, conversationId },
          'No menu candidates found, skipping extraction'
        );
        return { success: true }; // Not an error, just no matches
      }

      // 2. Get option groups for candidates
      const optionGroups = await menuCandidateService.getOptionGroupsForItems(
        tenantId,
        candidates.map((c) => c.menuItemId)
      );

      // 3. Get conversation history for context
      const history = await this.getConversationHistory(conversationId);

      // 4. Extract order using LLM
      let extraction: LlmExtractionResponse;
      try {
        extraction = await llmExtractorService.extractOrder(
          userText,
          candidates,
          optionGroups,
          history
        );
      } catch (error) {
        logger.error({ error, tenantId, conversationId }, 'LLM extraction failed');
        // Graceful fallback: suggest agent handoff
        await this.sendAgentHandoffMessage(tenantId, conversationId);
        return { success: false, error: 'LLM extraction failed' };
      }

      // 5. Save order intent
      const orderIntent = await this.saveOrderIntent(
        tenantId,
        conversationId,
        messageId,
        extraction
      );

      // 6. Respond based on confidence
      let responseSent = false;

      if (extraction.clarificationQuestion || extraction.confidence < CONFIDENCE_THRESHOLD) {
        // Need clarification - ask question
        const question =
          extraction.clarificationQuestion ||
          'Siparişinizi tam anlayamadım. Lütfen ne istediğinizi biraz daha açıklar mısınız?';

        await this.sendBotMessage(tenantId, conversationId, question);
        responseSent = true;
      } else if (extraction.items.length > 0) {
        // High confidence - create draft order and ask for confirmation
        const order = await this.createDraftOrder(
          tenantId,
          conversationId,
          extraction,
          candidates
        );

        if (order) {
          const summaryMessage = await this.generateConfirmationMessage(order);
          await this.sendBotMessage(tenantId, conversationId, summaryMessage);
          responseSent = true;
        }
      }

      logger.info(
        {
          tenantId,
          conversationId,
          messageId,
          itemsExtracted: extraction.items.length,
          confidence: extraction.confidence,
          responseSent,
          durationMs: Date.now() - startTime,
        },
        'Order extraction completed'
      );

      return {
        success: true,
        orderIntent: this.mapOrderIntentToDto(orderIntent),
        responseSent,
      };
    } catch (error) {
      logger.error({ error, tenantId, conversationId }, 'Orchestration failed');
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get recent conversation history for LLM context
   */
  private async getConversationHistory(
    conversationId: string
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        kind: 'TEXT',
        text: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return messages
      .reverse()
      .map((m) => ({
        role: m.direction === 'IN' ? ('user' as const) : ('assistant' as const),
        content: m.text!,
      }));
  }

  /**
   * Save order intent to database
   */
  private async saveOrderIntent(
    tenantId: string,
    conversationId: string,
    messageId: string,
    extraction: LlmExtractionResponse
  ) {
    return prisma.orderIntent.create({
      data: {
        tenantId,
        conversationId,
        lastUserMessageId: messageId,
        extractedJson: extraction as any,
        confidence: extraction.confidence,
        needsClarification:
          extraction.confidence < CONFIDENCE_THRESHOLD ||
          !!extraction.clarificationQuestion,
        clarificationQuestion: extraction.clarificationQuestion,
      },
    });
  }

  /**
   * Create draft order from extraction
   */
  private async createDraftOrder(
    tenantId: string,
    conversationId: string,
    extraction: LlmExtractionResponse,
    candidates: Array<{ menuItemId: string; name: string; basePrice: number }>
  ) {
    if (extraction.items.length === 0) return null;

    // Calculate total price
    let totalPrice = 0;
    const orderItems: Array<{
      menuItemId: string;
      menuItemName: string;
      qty: number;
      unitPrice: number;
      optionsJson: any;
      extrasJson: any;
      notes: string | null;
    }> = [];

    for (const item of extraction.items) {
      const candidate = candidates.find((c) => c.menuItemId === item.menuItemId);
      if (!candidate) continue;

      let unitPrice = candidate.basePrice;

      // Add option price deltas (would need to look up actual prices)
      // For now, we'll store the selections and calculate later
      const optionsJson = item.optionSelections.length > 0 ? item.optionSelections : null;
      const extrasJson = item.extras.length > 0 ? item.extras : null;

      orderItems.push({
        menuItemId: item.menuItemId,
        menuItemName: candidate.name,
        qty: item.qty,
        unitPrice,
        optionsJson,
        extrasJson,
        notes: item.notes,
      });

      totalPrice += unitPrice * item.qty;
    }

    // Check for existing draft order
    const existingDraft = await prisma.order.findFirst({
      where: {
        tenantId,
        conversationId,
        status: 'DRAFT',
      },
    });

    if (existingDraft) {
      // Update existing draft
      await prisma.orderItem.deleteMany({
        where: { orderId: existingDraft.id },
      });

      await prisma.order.update({
        where: { id: existingDraft.id },
        data: {
          totalPrice: totalPrice,
          items: {
            create: orderItems.map((item) => ({
              menuItemId: item.menuItemId,
              menuItemName: item.menuItemName,
              qty: item.qty,
              unitPrice: item.unitPrice,
              optionsJson: item.optionsJson,
              extrasJson: item.extrasJson,
              notes: item.notes,
            })),
          },
        },
        include: { items: true },
      });

      return prisma.order.findUnique({
        where: { id: existingDraft.id },
        include: { items: true },
      });
    } else {
      // Create new draft
      return prisma.order.create({
        data: {
          tenantId,
          conversationId,
          status: 'DRAFT',
          totalPrice: totalPrice,
          items: {
            create: orderItems.map((item) => ({
              menuItemId: item.menuItemId,
              menuItemName: item.menuItemName,
              qty: item.qty,
              unitPrice: item.unitPrice,
              optionsJson: item.optionsJson,
              extrasJson: item.extrasJson,
              notes: item.notes,
            })),
          },
        },
        include: { items: true },
      });
    }
  }

  /**
   * Generate confirmation message for order
   */
  private async generateConfirmationMessage(order: any): Promise<string> {
    const items = order.items.map((item: any) => ({
      name: item.menuItemName,
      qty: item.qty,
      options: item.optionsJson?.map((o: any) => o.optionName) || [],
      price: Number(item.unitPrice) * item.qty,
    }));

    const totalPrice = Number(order.totalPrice);

    return llmExtractorService.generateOrderSummary(items, totalPrice);
  }

  /**
   * Send bot message to conversation
   */
  private async sendBotMessage(
    tenantId: string,
    conversationId: string,
    text: string
  ): Promise<void> {
    await inboxService.createMessage(
      tenantId,
      conversationId,
      'OUT',
      'TEXT',
      text,
      undefined,
      undefined // No sender user for bot messages
    );

    // TODO: Actually send via WhatsApp provider
    logger.info({ tenantId, conversationId, textPreview: text.substring(0, 50) }, 'Bot message sent');
  }

  /**
   * Send agent handoff message
   */
  private async sendAgentHandoffMessage(
    tenantId: string,
    conversationId: string
  ): Promise<void> {
    const message =
      'Bir sorunla karşılaştım, sizi bir temsilciye bağlıyorum. Lütfen bekleyin.';

    await this.sendBotMessage(tenantId, conversationId, message);

    // Update conversation status
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'PENDING_AGENT' },
    });
  }

  /**
   * Get order intents for a conversation
   */
  async getOrderIntents(
    tenantId: string,
    conversationId: string
  ): Promise<OrderIntentDto[]> {
    const intents = await prisma.orderIntent.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return intents.map((i) => this.mapOrderIntentToDto(i));
  }

  /**
   * Submit agent feedback on order intent
   */
  async submitFeedback(
    tenantId: string,
    intentId: string,
    feedback: 'correct' | 'incorrect'
  ): Promise<void> {
    await prisma.orderIntent.update({
      where: { id: intentId, tenantId },
      data: { agentFeedback: feedback },
    });

    logger.info({ tenantId, intentId, feedback }, 'Order intent feedback submitted');
  }

  /**
   * Map OrderIntent to DTO
   */
  private mapOrderIntentToDto(intent: any): OrderIntentDto {
    return {
      id: intent.id,
      tenantId: intent.tenantId,
      conversationId: intent.conversationId,
      lastUserMessageId: intent.lastUserMessageId,
      extractedJson: intent.extractedJson as ExtractedOrderData,
      confidence: intent.confidence,
      needsClarification: intent.needsClarification,
      clarificationQuestion: intent.clarificationQuestion,
      agentFeedback: intent.agentFeedback as 'correct' | 'incorrect' | null,
      createdAt: intent.createdAt.toISOString(),
    };
  }
}

export const nluOrchestratorService = new NluOrchestratorService();

