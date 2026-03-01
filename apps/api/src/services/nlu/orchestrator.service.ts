import prisma from '../../db/prisma';
import { menuCandidateService } from './menu-candidate.service';
import { llmExtractorService } from './llm-extractor.service';
import { preferencesService } from './preferences.service';
import { createLogger } from '../../logger';
import {
  OrderIntentDto,
  ExtractedOrderData,
  LlmExtractionResponse,
  LlmExtractedItem,
} from '@whatres/shared';
import crypto from 'crypto';

const logger = createLogger();

// Confidence threshold for auto-confirmation
const CONFIDENCE_THRESHOLD = 0.7;

// Type for option groups map
type OptionGroupsMap = Map<
  string,
  Array<{
    id: string;
    name: string;
    type: 'SINGLE' | 'MULTI';
    required: boolean;
    options: Array<{
      id: string;
      name: string;
      priceDelta: number;
      isDefault: boolean;
    }>;
  }>
>;

export interface OrchestrationResult {
  success: boolean;
  /** The draft order ID if one was created/updated */
  draftOrderId?: string;
  /** Clarification question if confidence is low */
  clarificationQuestion?: string;
  /** Whether items were extracted */
  itemsExtracted?: boolean;
  /** Confidence score from LLM */
  confidence?: number;
  /** The order intent saved */
  orderIntent?: OrderIntentDto;
  /** Generated confirmation message (order summary) */
  confirmationMessage?: string;
  /** Whether NLU needs agent handoff */
  needsAgentHandoff?: boolean;
  error?: string;
}

export class NluOrchestratorService {
  /**
   * Process incoming text message and extract order intent.
   * Does NOT send messages - returns data for the flow service to act on.
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
        return { success: false, needsAgentHandoff: true, error: 'LLM service not configured' };
      }

      // 1. Find menu candidates for current message
      let candidates = await menuCandidateService.findCandidates(
        tenantId,
        userText
      );

      // 1b. Include candidates from previous OrderIntent (for follow-up messages)
      // This covers both: items from previous extraction AND candidates that were
      // shown as options (e.g., when clarification was asked about döner type,
      // Kola/Ayran were also candidates but items was empty)
      const prevIntent = await this.getLastOrderIntent(tenantId, conversationId);
      if (prevIntent?.extractedJson) {
        const prevJson = prevIntent.extractedJson as any;

        // Get IDs from items AND from saved candidate list
        const prevItems = prevJson.items || [];
        const prevCandidateIds: string[] = prevJson._candidateIds || [];

        const allPrevIds = [
          ...prevItems.map((item: any) => item.menuItemId),
          ...prevCandidateIds,
        ].filter((id: string) => id && !candidates.some((c) => c.menuItemId === id));

        // Deduplicate
        const uniquePrevIds = [...new Set(allPrevIds)];

        if (uniquePrevIds.length > 0) {
          const prevMenuItems = await prisma.menuItem.findMany({
            where: { id: { in: uniquePrevIds }, tenantId },
            select: { id: true, name: true, category: true, basePrice: true },
          });
          for (const item of prevMenuItems) {
            if (!candidates.some((c) => c.menuItemId === item.id)) {
              candidates.push({
                menuItemId: item.id,
                name: item.name,
                category: item.category,
                basePrice: Number(item.basePrice),
                synonymsMatched: [],
                score: 0.2,
              });
            }
          }
        }
      }

      // 1c. Also include items from existing draft order
      const existingDraft = await prisma.order.findFirst({
        where: { tenantId, conversationId, status: 'DRAFT' },
        include: { items: true },
      });
      if (existingDraft) {
        for (const item of existingDraft.items) {
          if (!candidates.some((c) => c.menuItemId === item.menuItemId)) {
            candidates.push({
              menuItemId: item.menuItemId,
              name: item.menuItemName,
              category: '',
              basePrice: Number(item.unitPrice),
              synonymsMatched: [],
              score: 0.2,
            });
          }
        }
      }

      if (candidates.length === 0) {
        logger.info(
          { tenantId, conversationId },
          'No menu candidates found, skipping extraction'
        );
        return { success: true, itemsExtracted: false };
      }

      // 2. Get option groups for candidates
      const optionGroups = await menuCandidateService.getOptionGroupsForItems(
        tenantId,
        candidates.map((c) => c.menuItemId)
      );

      // 3. Get conversation history for context
      const history = await this.getConversationHistory(conversationId);

      // 4. Build existing order context for LLM
      const existingOrderContext = existingDraft
        ? this.buildExistingOrderContext(existingDraft)
        : undefined;

      // 4b. Get customer preferences context
      let customerPreferencesContext: string | undefined;
      try {
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { customerPhone: true },
        });
        if (conversation?.customerPhone) {
          const prefs = await preferencesService.getPreferences(
            tenantId,
            conversation.customerPhone
          );
          if (prefs) {
            customerPreferencesContext =
              preferencesService.buildPreferencesPrompt(prefs);
          }
        }
      } catch {
        // Non-critical, continue without preferences
      }

      // 5. Extract order using LLM (with existing order context + preferences)
      let extraction: LlmExtractionResponse;
      try {
        extraction = await llmExtractorService.extractOrder(
          userText,
          candidates,
          optionGroups,
          history,
          existingOrderContext,
          customerPreferencesContext
        );
      } catch (error) {
        logger.error({ error, tenantId, conversationId }, 'LLM extraction failed');
        return { success: false, needsAgentHandoff: true, error: 'LLM extraction failed' };
      }

      // 6. Save order intent (include candidate IDs for follow-up context)
      const orderIntent = await this.saveOrderIntent(
        tenantId,
        conversationId,
        messageId,
        extraction,
        candidates.map((c) => c.menuItemId)
      );

      // 7. Build result based on confidence
      const result: OrchestrationResult = {
        success: true,
        confidence: extraction.confidence,
        orderIntent: this.mapOrderIntentToDto(orderIntent),
        itemsExtracted: extraction.items.length > 0,
      };

      // Check for low-confidence items (per-item confidence)
      const lowConfidenceItems = extraction.items.filter(
        (i) => i.action === 'add' && i.itemConfidence < 0.5
      );

      if (extraction.clarificationQuestion || extraction.confidence < CONFIDENCE_THRESHOLD) {
        result.clarificationQuestion =
          extraction.clarificationQuestion ||
          'Siparisinizi tam anlayamadim. Lutfen ne istediginizi biraz daha aciklar misiniz?';
      } else if (lowConfidenceItems.length > 0 && !extraction.clarificationQuestion) {
        // Some items have low per-item confidence — ask about those specifically
        const itemNames = lowConfidenceItems
          .map((i) => candidates.find((c) => c.menuItemId === i.menuItemId)?.name || i.menuItemId)
          .join(', ');
        result.clarificationQuestion = `${itemNames} icin emin olamadim. Tam olarak ne istediginizi belirtir misiniz?`;
      } else if (extraction.items.length > 0) {
        // High confidence - create/update draft order with smart merge
        const order = await this.createDraftOrder(
          tenantId,
          conversationId,
          extraction,
          candidates,
          optionGroups,
          existingDraft
        );

        if (order) {
          result.draftOrderId = order.id;
          result.confirmationMessage = this.generateConfirmationMessage(order);
        }
      }

      logger.info(
        {
          tenantId,
          conversationId,
          messageId,
          itemsExtracted: extraction.items.length,
          confidence: extraction.confidence,
          draftOrderId: result.draftOrderId,
          hasExistingDraft: !!existingDraft,
          durationMs: Date.now() - startTime,
        },
        'Order extraction completed'
      );

      return result;
    } catch (error) {
      logger.error({ error, tenantId, conversationId }, 'Orchestration failed');
      return { success: false, error: String(error) };
    }
  }

  /**
   * Build existing order context string for LLM prompt
   */
  private buildExistingOrderContext(draft: any): string {
    if (!draft || !draft.items || draft.items.length === 0) return '';

    const lines = draft.items.map((item: any) => {
      let line = `- ${item.qty}x ${item.menuItemName} [${item.menuItemId}]`;
      if (item.optionsJson && Array.isArray(item.optionsJson) && item.optionsJson.length > 0) {
        const optionNames = item.optionsJson.map((o: any) => o.optionName || o.groupName).join(', ');
        line += ` (${optionNames})`;
      }
      if (item.notes) {
        line += ` - Not: ${item.notes}`;
      }
      return line;
    });

    return lines.join('\n');
  }

  /**
   * Get the last order intent for this conversation (for follow-up context)
   */
  private async getLastOrderIntent(tenantId: string, conversationId: string) {
    return prisma.orderIntent.findFirst({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'desc' },
    });
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
      take: 12,
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
    extraction: LlmExtractionResponse,
    candidateIds?: string[]
  ) {
    // Save candidate IDs alongside extraction data for follow-up context
    const extractionWithCandidates = {
      ...extraction,
      _candidateIds: candidateIds || [],
    };

    return prisma.orderIntent.create({
      data: {
        tenantId,
        conversationId,
        lastUserMessageId: messageId,
        extractedJson: extractionWithCandidates as any,
        confidence: extraction.confidence,
        needsClarification:
          extraction.confidence < CONFIDENCE_THRESHOLD ||
          !!extraction.clarificationQuestion,
        clarificationQuestion: extraction.clarificationQuestion,
      },
    });
  }

  /**
   * Resolve option price deltas for an extracted item.
   * Returns the total price delta from selected options.
   */
  private resolveOptionDeltas(
    item: LlmExtractedItem,
    optionGroups: OptionGroupsMap
  ): { totalDelta: number; resolvedOptions: Array<{ groupName: string; optionName: string; priceDelta: number }> } {
    let totalDelta = 0;
    const resolvedOptions: Array<{ groupName: string; optionName: string; priceDelta: number }> = [];

    const groups = optionGroups.get(item.menuItemId);
    if (!groups || item.optionSelections.length === 0) {
      return { totalDelta, resolvedOptions };
    }

    for (const selection of item.optionSelections) {
      const group = groups.find(
        (g) => g.name.toLowerCase() === selection.groupName.toLowerCase()
      );
      if (group) {
        const option = group.options.find(
          (o) => o.name.toLowerCase() === selection.optionName.toLowerCase()
        );
        if (option) {
          totalDelta += option.priceDelta;
          resolvedOptions.push({
            groupName: group.name,
            optionName: option.name,
            priceDelta: option.priceDelta,
          });
        } else {
          // Option not found by exact match, try fuzzy
          resolvedOptions.push({
            groupName: selection.groupName,
            optionName: selection.optionName,
            priceDelta: 0,
          });
        }
      } else {
        resolvedOptions.push({
          groupName: selection.groupName,
          optionName: selection.optionName,
          priceDelta: 0,
        });
      }
    }

    return { totalDelta, resolvedOptions };
  }

  /**
   * Generate a unique key for an order item (menuItemId + sorted options hash)
   * Used for deduplication and merging
   */
  private itemKey(menuItemId: string, optionsJson: any): string {
    if (!optionsJson || !Array.isArray(optionsJson) || optionsJson.length === 0) {
      return menuItemId;
    }
    const sorted = [...optionsJson]
      .sort((a, b) => `${a.groupName}:${a.optionName}`.localeCompare(`${b.groupName}:${b.optionName}`))
      .map((o) => `${o.groupName}:${o.optionName}`)
      .join('|');
    const hash = crypto.createHash('md5').update(sorted).digest('hex').slice(0, 8);
    return `${menuItemId}:${hash}`;
  }

  /**
   * Create or update draft order with smart merge logic.
   * Handles action: 'add', 'remove', 'keep' from LLM extraction.
   */
  async createDraftOrder(
    tenantId: string,
    conversationId: string,
    extraction: LlmExtractionResponse,
    candidates: Array<{ menuItemId: string; name: string; basePrice: number }>,
    optionGroups: OptionGroupsMap,
    existingDraft?: any
  ) {
    // If all items are 'keep' or no items, nothing to do
    const actionItems = extraction.items.filter((i) => i.action !== 'keep');
    if (extraction.items.length === 0) return null;

    // Build a map of existing items (from the draft order) keyed by itemKey
    const existingItemsMap = new Map<string, {
      menuItemId: string;
      menuItemName: string;
      qty: number;
      unitPrice: number;
      optionsJson: any;
      extrasJson: any;
      notes: string | null;
    }>();

    if (existingDraft?.items) {
      for (const item of existingDraft.items) {
        const key = this.itemKey(item.menuItemId, item.optionsJson);
        existingItemsMap.set(key, {
          menuItemId: item.menuItemId,
          menuItemName: item.menuItemName,
          qty: item.qty,
          unitPrice: Number(item.unitPrice),
          optionsJson: item.optionsJson,
          extrasJson: item.extrasJson,
          notes: item.notes,
        });
      }
    }

    // Process each extracted item based on action
    for (const item of extraction.items) {
      const candidate = candidates.find((c) => c.menuItemId === item.menuItemId);
      if (!candidate) continue;

      const action = item.action || 'add';

      // Resolve option price deltas
      const { totalDelta, resolvedOptions } = this.resolveOptionDeltas(item, optionGroups);
      const unitPrice = candidate.basePrice + totalDelta;
      const optionsJson = resolvedOptions.length > 0 ? resolvedOptions : null;
      const extrasJson = item.extras.length > 0 ? item.extras : null;
      const key = this.itemKey(item.menuItemId, optionsJson);

      if (action === 'add') {
        const existing = existingItemsMap.get(key);
        if (existing) {
          // Same item+options → increase qty
          existing.qty += item.qty;
          existing.unitPrice = unitPrice; // Update price in case options changed
          if (item.notes) {
            existing.notes = item.notes;
          }
          if (extrasJson) {
            existing.extrasJson = extrasJson;
          }
        } else {
          // New item
          existingItemsMap.set(key, {
            menuItemId: item.menuItemId,
            menuItemName: candidate.name,
            qty: item.qty,
            unitPrice,
            optionsJson,
            extrasJson,
            notes: item.notes,
          });
        }
      } else if (action === 'remove') {
        // Try to find and remove the item
        // First try exact key match
        if (existingItemsMap.has(key)) {
          existingItemsMap.delete(key);
        } else {
          // Try matching by menuItemId only (if customer says "kolayi cikar" without specifying options)
          for (const [k, v] of existingItemsMap) {
            if (v.menuItemId === item.menuItemId) {
              existingItemsMap.delete(k);
              break;
            }
          }
        }
      }
      // action === 'keep' → preserve item, but apply notes/extras if LLM provided them
      if (action === 'keep') {
        // Find the existing item to update notes/extras (e.g. "sogansiz" on existing burger)
        const existingByKey = existingItemsMap.get(key);
        const existingItem = existingByKey ||
          [...existingItemsMap.values()].find((v) => v.menuItemId === item.menuItemId);
        if (existingItem) {
          if (item.notes) {
            existingItem.notes = existingItem.notes
              ? `${existingItem.notes}, ${item.notes}`
              : item.notes;
          }
          if (extrasJson) {
            existingItem.extrasJson = extrasJson;
          }
        }
      }
    }

    // Build final order items array
    const finalItems = Array.from(existingItemsMap.values());

    if (finalItems.length === 0) {
      // All items removed → delete draft if exists
      if (existingDraft) {
        await prisma.orderItem.deleteMany({ where: { orderId: existingDraft.id } });
        await prisma.order.delete({ where: { id: existingDraft.id } });
      }
      return null;
    }

    // Calculate total price
    const totalPrice = finalItems.reduce(
      (sum, item) => sum + item.unitPrice * item.qty,
      0
    );

    if (existingDraft) {
      // Update existing draft with merged items
      await prisma.orderItem.deleteMany({
        where: { orderId: existingDraft.id },
      });

      await prisma.order.update({
        where: { id: existingDraft.id },
        data: {
          totalPrice,
          ...(extraction.orderNotes ? { notes: extraction.orderNotes } : {}),
          items: {
            create: finalItems.map((item) => ({
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
          totalPrice,
          notes: extraction.orderNotes || null,
          items: {
            create: finalItems.map((item) => ({
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
   * Generate confirmation message for order using template (no LLM call)
   */
  generateConfirmationMessage(order: any): string {
    const items = order.items.map((item: any) => {
      const options: string[] = [];
      if (item.optionsJson && Array.isArray(item.optionsJson)) {
        for (const opt of item.optionsJson) {
          options.push(opt.optionName || opt.groupName);
        }
      }
      return {
        name: item.menuItemName,
        qty: item.qty,
        options,
        price: Number(item.unitPrice) * item.qty,
        notes: item.notes || null,
      };
    });

    const totalPrice = Number(order.totalPrice);

    return llmExtractorService.generateSimpleSummary(items, totalPrice, order.notes);
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
