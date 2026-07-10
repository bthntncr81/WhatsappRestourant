import prisma from '../../db/prisma';
import { menuCandidateService } from './menu-candidate.service';
import {
  llmExtractorService,
  buildCandidatesPrompt,
  buildExistingOrderContext as buildExistingOrderPromptSection,
} from './llm-extractor.service';
import { preferencesService } from './preferences.service';
import {
  intentAnalysisService,
  detectNegativeConstraint,
  IntentAnalysis,
} from './intent-analysis.service';
import { modelRouterService, RouteDecision } from '../ai/model-router.service';
import { claudeClientService } from '../ai/claude-client.service';
import { trainingCaptureService } from '../ai/training-capture.service';
import { createLogger } from '../../logger';
import {
  OrderIntentDto,
  ExtractedOrderData,
  LlmExtractionResponse,
  LlmExtractedItem,
  MenuCandidateDto,
} from '@whatres/shared';
import crypto from 'crypto';

const logger = createLogger();

function computeEffectivePrice(
  basePrice: number,
  item: { discountType: string | null; discountValue: unknown; discountStartAt: Date | null; discountEndAt: Date | null },
): number {
  if (!item.discountType || !item.discountValue) return basePrice;
  const val = Number(item.discountValue);
  if (val <= 0) return basePrice;
  const now = new Date();
  if (item.discountStartAt && now < item.discountStartAt) return basePrice;
  if (item.discountEndAt && now > item.discountEndAt) return basePrice;
  if (item.discountType === 'PERCENTAGE') return Math.max(0, basePrice * (1 - val / 100));
  if (item.discountType === 'FIXED_AMOUNT') return Math.max(0, basePrice - val);
  return basePrice;
}

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

export interface OptionSelectionRequest {
  itemName: string;
  groupName: string;
  stepNumber: number;
  options: Array<{ id: string; name: string; priceDelta: number }>;
}

export interface OrchestrationResult {
  success: boolean;
  draftOrderId?: string;
  clarificationQuestion?: string;
  /** Structured option selection for interactive list message */
  pendingOptionSelection?: OptionSelectionRequest;
  itemsExtracted?: boolean;
  confidence?: number;
  orderIntent?: OrderIntentDto;
  confirmationMessage?: string;
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

      // ---- Hybrid AI stage 1: intent analysis + reply-model routing.
      // Runs on every message ONLY when the router is enabled
      // (ANTHROPIC_API_KEY set and AI_ROUTER_ENABLED !== 'false').
      // Without a key this block is skipped entirely — the code path is
      // byte-identical to the pre-hybrid behavior.
      let intentAnalysis: IntentAnalysis | null = null;
      let route: RouteDecision = { model: 'local', negativeConstraint: false };
      if (modelRouterService.isEnabled()) {
        intentAnalysis = await intentAnalysisService.analyze(userText);
        route = modelRouterService.route(intentAnalysis, detectNegativeConstraint(userText));
        logger.info(
          {
            tenantId,
            conversationId,
            replyModel: route.model,
            negativeConstraint: route.negativeConstraint,
            actionableIntentCount: intentAnalysis?.actionableIntentCount ?? null,
          },
          'AI router decision'
        );
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
            select: { id: true, name: true, category: true, basePrice: true, discountType: true, discountValue: true, discountStartAt: true, discountEndAt: true },
          });
          for (const item of prevMenuItems) {
            if (!candidates.some((c) => c.menuItemId === item.id)) {
              const bp = Number(item.basePrice);
              candidates.push({
                menuItemId: item.id,
                name: item.name,
                category: item.category,
                basePrice: bp,
                effectivePrice: computeEffectivePrice(bp, item),
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

      // 6b. NEGATIVE-CONSTRAINT GATE (hybrid mode only): when the analysis
      // detected a restrictive special request ("sadece", "olmasin",
      // "haric"...), never auto-create/modify an order. The customer gets a
      // "noted — our staff will confirm" reply and the conversation is
      // flagged for human review via the existing PENDING_AGENT inbox flag.
      // With no ANTHROPIC_API_KEY route.model is always 'local' and this
      // gate never fires, so today's behavior is unchanged.
      if (route.model !== 'local' && route.negativeConstraint) {
        return this.handleNegativeConstraintGate({
          tenantId,
          conversationId,
          userText,
          extraction,
          orderIntent,
          candidates,
          optionGroups,
          existingOrderContext,
          customerPreferencesContext,
          history,
          intentAnalysis,
        });
      }

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

      // If items were found, check required options FIRST before falling back to LLM clarification
      let hasExtractedItems = extraction.items.filter(i => i.action === 'add').length > 0;

      // If LLM didn't extract items but candidates include bundle items with required options,
      // force-add the best matching bundle candidate
      if (!hasExtractedItems && candidates.length > 0) {
        for (const c of candidates) {
          const groups = optionGroups.get(c.menuItemId);
          if (groups?.some(g => g.required)) {
            extraction.items.push({
              menuItemId: c.menuItemId,
              qty: 1,
              action: 'add',
              optionSelections: [],
              extras: [],
              notes: '',
              itemConfidence: 0.8,
            });
            hasExtractedItems = true;
            break;
          }
        }
      }

      const missingOptionsEarly = hasExtractedItems
        ? this.findMissingRequiredOptions(extraction.items, optionGroups, candidates)
        : [];

      if (missingOptionsEarly.length > 0) {
        // Items found but required options missing — skip LLM clarification, use our option selection
        const order = await this.createDraftOrder(
          tenantId, conversationId, extraction, candidates, optionGroups, existingDraft
        );
        if (order) {
          result.draftOrderId = order.id;
        }
        const first = missingOptionsEarly[0];
        const stepNum = first.selectedCount + 1;
        const cleanGroupName = first.groupName.replace(/ \(\d+x\)/, '');
        result.pendingOptionSelection = {
          itemName: first.itemName,
          groupName: cleanGroupName,
          stepNumber: stepNum,
          options: first.options.map((o, idx) => ({
            id: `opt_${idx}_${o.name.substring(0, 20).replace(/\s/g, '_')}`,
            name: o.name,
            priceDelta: o.priceDelta,
          })),
        };
        result.clarificationQuestion = `${stepNum}. ${cleanGroupName} seçin:`;
      } else if (!hasExtractedItems && (extraction.clarificationQuestion || extraction.confidence < CONFIDENCE_THRESHOLD)) {
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
        // Check for missing required options before creating draft
        const missingOptions = this.findMissingRequiredOptions(extraction.items, optionGroups, candidates);
        if (missingOptions.length > 0) {
          // Create draft order anyway (so items are saved), but ask for missing options
          const order = await this.createDraftOrder(
            tenantId, conversationId, extraction, candidates, optionGroups, existingDraft
          );
          if (order) {
            result.draftOrderId = order.id;
          }
          // Ask only the FIRST missing option step by step via interactive list
          const first = missingOptions[0];
          const stepNum = first.selectedCount + 1;
          const cleanGroupName = first.groupName.replace(/ \(\d+x\)/, '');
          result.pendingOptionSelection = {
            itemName: first.itemName,
            groupName: cleanGroupName,
            stepNumber: stepNum,
            options: first.options.map((o, idx) => ({
              id: `opt_${idx}_${o.name.substring(0, 20).replace(/\s/g, '_')}`,
              name: o.name,
              priceDelta: o.priceDelta,
            })),
          };
          result.clarificationQuestion = `${stepNum}. ${cleanGroupName} seçin:`;
        } else {
          // High confidence, all required options filled - create/update draft order
          const order = await this.createDraftOrder(
            tenantId, conversationId, extraction, candidates, optionGroups, existingDraft
          );
          if (order) {
            result.draftOrderId = order.id;
            result.confirmationMessage = this.generateConfirmationMessage(order);
          } else {
            // Items matched but the order did not change (recommendation-style
            // question, keep-only actions, or a candidate/ID mismatch). The
            // flow layer sends nothing when neither a confirmation nor a
            // clarification is set, so the customer would get silence —
            // always fall back to a local suggestion (free-text, therefore
            // eligible for the hybrid Claude rewrite below).
            result.clarificationQuestion = this.buildSuggestionFallback(candidates);
          }
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

      // ---- Hybrid AI stage 2: reply generation. Only free-text
      // clarification replies are re-generated with Claude (haiku/sonnet).
      // Structured option lists (pendingOptionSelection) and price-bearing
      // order summaries (confirmationMessage) always stay on the
      // local/template path. On any Claude failure the local text is kept.
      if (
        route.model !== 'local' &&
        result.clarificationQuestion &&
        !result.pendingOptionSelection
      ) {
        await this.applyHybridClarificationReply({
          tenantId,
          userText,
          result,
          route,
          candidates,
          optionGroups,
          existingOrderContext,
          customerPreferencesContext,
          history,
          intentAnalysis,
        });
      }

      return result;
    } catch (error) {
      logger.error({ error, tenantId, conversationId }, 'Orchestration failed');
      return { success: false, error: String(error) };
    }
  }

  /**
   * Local fallback when extraction matched items but no draft change was
   * possible. Lists the closest menu candidates so the customer always gets
   * a useful reply instead of silence (ASCII Turkish like the other
   * templates; the hybrid Claude rewrite polishes it when routed).
   */
  private buildSuggestionFallback(
    candidates: Array<{ name: string; basePrice: number; effectivePrice?: number }>
  ): string {
    const top = candidates.slice(0, 3);
    if (top.length === 0) {
      return 'Menumuzden ne istediginizi tam anlayamadim. Hangi urunu denemek istersiniz?';
    }
    const list = top
      .map((c) => `${c.name} (${(c.effectivePrice ?? c.basePrice).toFixed(2)} TL)`)
      .join(', ');
    return `Size su lezzetleri onerebilirim: ${list}. Hangisini isterseniz yazmaniz yeterli.`;
  }

  // ==================== HYBRID AI (Claude) REPLY LAYER ====================

  /**
   * System prompt for Claude reply generation. Reuses the EXACT same menu
   * candidates / existing order / preferences prompt sections as the local
   * extraction path (exported from llm-extractor.service.ts) so both models
   * see identical context.
   */
  private buildClaudeReplySystemPrompt(opts: {
    candidates: MenuCandidateDto[];
    optionGroups: OptionGroupsMap;
    existingOrderContext?: string;
    customerPreferencesContext?: string;
    situation: string;
  }): string {
    return (
      `Sen bir restoranin WhatsApp siparis asistanisin. Musteriye kisa, samimi ve net WhatsApp mesajlari yazarsin.

KURALLAR:
- Musterinin dilinde yaz (varsayilan Turkce).
- Sadece asagidaki menu bilgisine dayan; menu disinda urun veya fiyat uydurma.
- Kisa yaz (1-3 cumle), en fazla 1 emoji.
- Siparisi kendin onaylama veya olusturma; sana verilen DURUM talimatini uygula.
- Yanitin SADECE musteriye gidecek mesaj metni olsun; baslik, aciklama veya JSON ekleme.` +
      buildCandidatesPrompt(opts.candidates, opts.optionGroups) +
      buildExistingOrderPromptSection(opts.existingOrderContext) +
      (opts.customerPreferencesContext || '') +
      `\n\nDURUM: ${opts.situation}`
    );
  }

  /**
   * Convert DB conversation history into an Anthropic-compatible message
   * array (must start with a user turn) ending with the current message.
   */
  private buildClaudeMessages(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    userText: string
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const trimmed = history
      .slice(-8)
      .filter((m) => m.content && m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));
    // Anthropic requires the first message to be a user turn
    while (trimmed.length > 0 && trimmed[0].role !== 'user') trimmed.shift();
    // The incoming message is usually already persisted (= last history
    // entry); only append it when it is not.
    const last = trimmed[trimmed.length - 1];
    if (!last || last.role !== 'user' || last.content !== userText) {
      trimmed.push({ role: 'user', content: userText });
    }
    return trimmed;
  }

  /**
   * Hybrid stage 2 for free-text clarification replies: re-phrase the
   * locally produced clarification with Claude (haiku/sonnet). Keeps the
   * local text on any failure and captures a training sample on success.
   */
  private async applyHybridClarificationReply(opts: {
    tenantId: string;
    userText: string;
    result: OrchestrationResult;
    route: RouteDecision;
    candidates: MenuCandidateDto[];
    optionGroups: OptionGroupsMap;
    existingOrderContext?: string;
    customerPreferencesContext?: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    intentAnalysis: IntentAnalysis | null;
  }): Promise<void> {
    try {
      const choice = opts.route.model === 'sonnet' ? ('sonnet' as const) : ('haiku' as const);
      const system = this.buildClaudeReplySystemPrompt({
        candidates: opts.candidates,
        optionGroups: opts.optionGroups,
        existingOrderContext: opts.existingOrderContext,
        customerPreferencesContext: opts.customerPreferencesContext,
        situation: `Sistem su netlestirme ihtiyacini belirledi: "${opts.result.clarificationQuestion}". Musteriye bu netlestirmeyi kendi dilinde, dogal ve kisa bir mesajla sor.`,
      });
      const messages = this.buildClaudeMessages(opts.history, opts.userText);
      const reply = await claudeClientService.generateReply({ choice, system, messages });
      if (!reply) return; // Claude failed → keep the local clarification text

      opts.result.clarificationQuestion = reply.text;

      // Flywheel: every hybrid reply is a teacher sample (fire-and-forget)
      trainingCaptureService.capture({
        tenantId: opts.tenantId,
        source: choice === 'sonnet' ? 'claude-sonnet' : 'claude-haiku',
        model: reply.model,
        intentAnalysis: opts.intentAnalysis,
        system,
        history: messages.slice(0, -1),
        userMessage: opts.userText,
        assistantReply: reply.text,
      });
    } catch (error) {
      logger.warn({ error }, 'Hybrid clarification reply failed, keeping local text');
    }
  }

  /**
   * NEGATIVE-CONSTRAINT GATE: the message carries a restrictive special
   * request, so no order is auto-created/updated. The conversation is
   * flagged for human review (existing PENDING_AGENT inbox flag) and the
   * customer gets a "noted — our staff will confirm" reply (Claude sonnet
   * when possible, fixed template otherwise).
   */
  private async handleNegativeConstraintGate(opts: {
    tenantId: string;
    conversationId: string;
    userText: string;
    extraction: LlmExtractionResponse;
    orderIntent: any;
    candidates: MenuCandidateDto[];
    optionGroups: OptionGroupsMap;
    existingOrderContext?: string;
    customerPreferencesContext?: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    intentAnalysis: IntentAnalysis | null;
  }): Promise<OrchestrationResult> {
    // Flag for human review via the existing inbox status. PENDING_AGENT
    // also silences the bot for subsequent messages until an agent acts
    // (see the takeover guard in conversation-flow.service.ts).
    try {
      await prisma.conversation.update({
        where: { id: opts.conversationId },
        data: { status: 'PENDING_AGENT' },
      });
    } catch (error) {
      logger.warn(
        { error, conversationId: opts.conversationId },
        'Failed to flag conversation as PENDING_AGENT'
      );
    }

    const fallbackText =
      'Ozel isteginizi not aldim. 👍 Siparisinizi gorevlimiz kontrol edip sizinle onaylayacak.';

    const result: OrchestrationResult = {
      success: true,
      confidence: opts.extraction.confidence,
      orderIntent: this.mapOrderIntentToDto(opts.orderIntent),
      itemsExtracted: opts.extraction.items.length > 0,
      clarificationQuestion: fallbackText,
    };

    try {
      const constraintHint = opts.intentAnalysis?.negativeConstraintText
        ? ` ("${opts.intentAnalysis.negativeConstraintText}")`
        : '';
      const system = this.buildClaudeReplySystemPrompt({
        candidates: opts.candidates,
        optionGroups: opts.optionGroups,
        existingOrderContext: opts.existingOrderContext,
        customerPreferencesContext: opts.customerPreferencesContext,
        situation:
          `Musterinin mesajinda ozel/kisitlayici bir istek tespit edildi${constraintHint}. ` +
          'Siparis OTOMATIK OLUSTURULMADI. Musteriye istegini not aldigini ve gorevlimizin ' +
          'siparisi kontrol edip kendisiyle onaylayacagini kisa ve guven verici bir mesajla bildir. ' +
          'Soru sorma, siparis onaylama.',
      });
      const messages = this.buildClaudeMessages(opts.history, opts.userText);
      const reply = await claudeClientService.generateReply({ choice: 'sonnet', system, messages });
      if (reply) {
        result.clarificationQuestion = reply.text;
        trainingCaptureService.capture({
          tenantId: opts.tenantId,
          source: 'claude-sonnet',
          model: reply.model,
          intentAnalysis: opts.intentAnalysis,
          system,
          history: messages.slice(0, -1),
          userMessage: opts.userText,
          assistantReply: reply.text,
        });
      }
    } catch (error) {
      logger.warn({ error }, 'Negative-constraint gate Claude reply failed, using fallback text');
    }

    logger.info(
      {
        tenantId: opts.tenantId,
        conversationId: opts.conversationId,
        negativeConstraintText: opts.intentAnalysis?.negativeConstraintText ?? null,
      },
      'Negative-constraint gate applied — order creation skipped, flagged for human review'
    );

    return result;
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
   * Check for missing required option groups on extracted items.
   * Returns list of items with missing required selections.
   */
  private findMissingRequiredOptions(
    items: LlmExtractedItem[],
    optionGroups: OptionGroupsMap,
    candidates: Array<{ menuItemId: string; name: string }>
  ): Array<{ itemName: string; groupName: string; minSelect: number; maxSelect: number | null; selectedCount: number; options: Array<{ name: string; priceDelta: number }> }> {
    const missing: Array<{ itemName: string; groupName: string; minSelect: number; maxSelect: number | null; selectedCount: number; options: Array<{ name: string; priceDelta: number }> }> = [];

    for (const item of items) {
      if (item.action === 'remove') continue;
      const groups = optionGroups.get(item.menuItemId);
      if (!groups) continue;

      const candidate = candidates.find((c) => c.menuItemId === item.menuItemId);
      const itemName = candidate?.name || item.menuItemId;

      for (const group of groups) {
        if (!group.required) continue;

        const selections = item.optionSelections.filter(
          (s) => s.groupName.toLowerCase() === group.name.toLowerCase()
        );
        const minNeeded = (group as any).minSelect || 1;

        if (selections.length < minNeeded) {
          missing.push({
            itemName,
            groupName: group.name,
            minSelect: minNeeded,
            maxSelect: (group as any).maxSelect || null,
            selectedCount: selections.length,
            options: group.options.map((o) => ({ name: o.name, priceDelta: o.priceDelta })),
          });
        }
      }
    }

    return missing;
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
    candidates: Array<{ menuItemId: string; name: string; basePrice: number; effectivePrice?: number }>,
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
      const unitPrice = (candidate.effectivePrice ?? candidate.basePrice) + totalDelta;
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
          if (item.notes === '__CLEAR__') {
            // Special marker: clear notes from this item
            existingItem.notes = null;
          } else if (item.notes) {
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
          ...(extraction.orderNotes === '__CLEAR__'
            ? { notes: null }
            : extraction.orderNotes
              ? { notes: extraction.orderNotes }
              : {}),
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
