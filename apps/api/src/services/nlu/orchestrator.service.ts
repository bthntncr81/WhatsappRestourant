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
  deriveSpecialRequest,
  exclusionNamesProduct,
  IntentAnalysis,
  SpecialRequest,
} from './intent-analysis.service';
import { stripTypedAddressNote } from '../message-templates';
import {
  classifyAddressText,
  foldTr,
  hasAddSignal,
  hasItemRemoveSignal,
} from './flow-text-signals';
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

// Hard cap for merged item/order notes (defensive: keeps a looping model from
// producing a kitchen ticket nobody can read)
const MAX_NOTES_LENGTH = 240;

// Only candidates that matched the CURRENT text this strongly may be
// force-added. Candidates injected from the previous intent or the cart
// (score 0.2) are context, not intent.
const DIRECT_MATCH_SCORE = 0.5;

// A fresh candidate at/above this score is real product evidence in the message
// (the category boost alone gives 0.3).
const FRESH_EVIDENCE_SCORE = 0.3;

// Staff-visible marker on item/order notes. No commas: mergeNotes splits on ','.
export const SPECIAL_REQUEST_PREFIX = 'Ozel istek: ';

// A special request we could not place yet is kept this long for the follow-up answer.
const PENDING_SPECIAL_REQUEST_TTL_MS = 30 * 60 * 1000;

interface PendingSpecialRequest extends SpecialRequest {
  sourceMessageId: string;
  createdAt: string;
  /** 'menu' → ask which product; 'draft' → ask which cart line */
  scope: 'menu' | 'draft';
  /** The products we asked about; the request only lands on one of these */
  menuItemIds?: string[];
  names?: string[];
  /** Our question, repeated while the request is still open */
  question?: string;
}

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
  /**
   * True when `clarificationQuestion` is only a generic "I did not understand"
   * placeholder (not a real, useful question from the model). The flow layer
   * prefers the conversational answer layer over these — they are the source
   * of the "Siparisinizi tam anlayamadim" spam.
   */
  weakClarification?: boolean;
  /** The special request ("Sadece mozerella, sade") that was written onto the order, if any */
  specialRequestNote?: string;
  error?: string;
}

/**
 * Local, LLM-free detector for informational questions ("kac para", "icinde ne
 * var", "ikisi arasinda fark ne"). Used to keep the bundle force-add fallback
 * from silently dropping a product into the cart when the customer only asked
 * a question.
 */
export function isInformationalQuestion(text: string): boolean {
  // Fold Turkish letters to ASCII so "kaç para" / "içinde ne var" match the
  // ASCII phrase lists below.
  const t = text
    .toLocaleLowerCase('tr')
    .replace(/̇/g, '')
    .replace(/ı/g, 'i')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u');

  // An explicit add/order request always wins over the question heuristic.
  const orderIntentPhrases = [
    'ekle', 'istiyorum', 'olsun', 'alayim', 'alalim', 'siparis ver',
    'getir', 'gonder', 'yollayin', 'lutfen bir', 'bir tane',
  ];
  if (orderIntentPhrases.some((p) => t.includes(p))) return false;

  const questionPhrases = [
    'kac para', 'kac tl', 'kac lira', 'ne kadar', 'kaca', 'fiyat',
    'icinde ne', 'icinde var', 'neler var', 'ne var',
    'fark ne', 'farki ne', 'hangisi', 'daha iyi', 'onerir', 'oneri',
    'acili mi', 'vejetaryen', 'vejeteryan', 'glutensiz', 'helal',
    'ne kadar surer', 'ne zaman gelir', 'kac dakika',
    'yapiyor musunuz', 'var mi', 'olur mu', 'mumkun mu',
    'pahali', 'ucuz', 'tuzlu',
    // complaints / confusion are not orders either ("Size cok yakin nasil yani",
    // "Yanlis oldu" each force-added a bundle in production)
    'nasil', 'neden', 'niye', 'yanlis', 'anlamadim',
  ];
  return questionPhrases.some((p) => t.includes(p));
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

      // The local regex also runs without the router: noting a special request
      // is harmless (a note + at most one question), so tenants without
      // ANTHROPIC_API_KEY get it too.
      const hasConstraintSignal = route.negativeConstraint || detectNegativeConstraint(userText);

      // 1. Find menu candidates for current message
      let candidates = await menuCandidateService.findCandidates(
        tenantId,
        userText
      );
      // Product evidence must come from THIS message only — 1b/1c below append
      // carried-over context candidates.
      const freshCandidates = candidates.slice();
      const directMatchIds = new Set(
        freshCandidates.filter((c) => c.score >= DIRECT_MATCH_SCORE).map((c) => c.menuItemId)
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
            select: { id: true, name: true, description: true, category: true, basePrice: true, discountType: true, discountValue: true, discountStartAt: true, discountEndAt: true },
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
                description: item.description,
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

      // 6. Special request ("sadece mozerella", "sogan olmasin"): derive a note
      // from THIS message, or pick up the one the customer gave on the previous
      // turn when we had to ask which product it belongs to.
      // WHY: the old negative-constraint gate parked these conversations in
      // PENDING_AGENT, which silences the bot; nobody answered and real orders
      // were lost (High Five, 12.09). A restrictive request is now written onto
      // the order (kitchen ticket + summary) and the order flow always continues.
      const specialRequest = hasConstraintSignal
        ? deriveSpecialRequest(
            userText,
            intentAnalysis?.negativeConstraintText,
            // Synonyms count as product words: "kolayi istemiyorum" matched
            // "Coca Cola" through "kola" and is a removal, not a note.
            freshCandidates.flatMap((c) => [c.name, ...(c.synonymsMatched || [])]),
            freshCandidates.map((c) => c.category).filter((c): c is string => !!c)
          )
        : null;
      const pendingRequest = specialRequest ? null : this.readPendingSpecialRequest(prevIntent);
      const effectiveRequest: SpecialRequest | null = specialRequest ?? pendingRequest;
      const removedItemTexts =
        specialRequest?.kind === 'exclude'
          ? await this.describeRemovedItems(tenantId, extraction, candidates, existingDraft)
          : new Map<string, string[]>();
      const srApply = effectiveRequest
        ? this.applySpecialRequest({
            extraction,
            request: effectiveRequest,
            fromThisMessage: !!specialRequest,
            existingDraft,
            freshCandidates,
            userText,
            removedItemTexts,
            // A request carried over from our product question only lands on one
            // of the products we asked about ("2 kola" must not get "Sadece mozerella").
            allowedItemIds:
              !specialRequest && pendingRequest?.menuItemIds?.length
                ? new Set(pendingRequest.menuItemIds)
                : null,
          })
        : { applied: false, noteItemIdx: new Set<number>() };

      // The intent row stores what the extractor returned (before the synthetic
      // bundle force-add below), same as before; it is written after the
      // branches so a still-open special request can be attached to it.
      const extractionForIntent: LlmExtractionResponse = JSON.parse(JSON.stringify(extraction));

      // 7. Build result based on confidence
      const result: OrchestrationResult = {
        success: true,
        confidence: extraction.confidence,
        itemsExtracted: extraction.items.length > 0,
      };

      // Check for low-confidence items (per-item confidence)
      const lowConfidenceItems = extraction.items.filter(
        (i) => i.action === 'add' && i.itemConfidence < 0.5
      );

      // If items were found, check required options FIRST before falling back to LLM clarification
      let hasExtractedItems = extraction.items.filter(i => i.action === 'add').length > 0;

      // If LLM didn't extract items but THIS message clearly named a bundle
      // with required options, force-add it. NEVER for:
      //  - a pure question ("meat five kac para") — the customer asked, not ordered,
      //  - a candidate that only came from an earlier turn or from the cart
      //    (score 0.2 context, not intent): "Hayalim kent e gidecek" and
      //    "Yanlis oldu" each added a 2'li Pizza Menu this way (High Five 28.08/30.08),
      //  - an address / delivery direction,
      //  - a special-request message (never add what the customer did not ask for).
      // Only a request written in THIS message blocks it: a request still open
      // from an earlier turn must not stop "2'li pizza menu" from being added.
      const addressLike = classifyAddressText(userText).kind !== 'none' && !hasAddSignal(userText);
      if (
        !hasExtractedItems &&
        directMatchIds.size > 0 &&
        !isInformationalQuestion(userText) &&
        !addressLike &&
        !specialRequest
      ) {
        for (const c of candidates) {
          if (!directMatchIds.has(c.menuItemId)) continue;
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

      // A "no-op keep" is an extraction that names menu items but changes
      // nothing: no add, no remove, no new note. That is a QUESTION about the
      // cart, not an edit to it. Note changes ("az tuz olsun") are explicitly
      // excluded so they still update — and still re-show — the order.
      const hasRemoveAction = extraction.items.some((i) => i.action === 'remove');
      const hasNoteChange =
        !!extraction.orderNotes || extraction.items.some((i) => !!i.notes);
      const isNoOpKeep =
        extraction.items.length > 0 && !hasExtractedItems && !hasRemoveAction && !hasNoteChange;

      const missingOptionsEarly = hasExtractedItems
        ? this.findMissingRequiredOptions(extraction.items, optionGroups, candidates)
        : [];

      if (missingOptionsEarly.length > 0) {
        // Items found but required options missing — skip LLM clarification, use our option selection
        const order = await this.createDraftOrder(
          tenantId, conversationId, extraction, candidates, optionGroups, existingDraft, srApply.noteItemIdx
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
        if (extraction.clarificationQuestion) {
          // A real question from the model ("Et Doner mi Tavuk Doner mi?") —
          // keep it, it is useful.
          result.clarificationQuestion = extraction.clarificationQuestion;
        } else {
          // Generic "I did not understand" placeholder. Flagged weak so the
          // flow layer can answer conversationally instead.
          result.clarificationQuestion =
            'Siparisinizi tam anlayamadim. Lutfen ne istediginizi biraz daha aciklar misiniz?';
          result.weakClarification = true;
        }
      } else if (lowConfidenceItems.length > 0 && !extraction.clarificationQuestion) {
        // Some items have low per-item confidence — ask about those specifically
        const itemNames = lowConfidenceItems
          .map((i) => candidates.find((c) => c.menuItemId === i.menuItemId)?.name || i.menuItemId)
          .join(', ');
        result.clarificationQuestion = `${itemNames} icin emin olamadim. Tam olarak ne istediginizi belirtir misiniz?`;
      } else if (extraction.items.length > 0 && !isNoOpKeep) {
        // Check for missing required options before creating draft
        const missingOptions = this.findMissingRequiredOptions(extraction.items, optionGroups, candidates);
        if (missingOptions.length > 0) {
          // Create draft order anyway (so items are saved), but ask for missing options
          const order = await this.createDraftOrder(
            tenantId, conversationId, extraction, candidates, optionGroups, existingDraft, srApply.noteItemIdx
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
            tenantId, conversationId, extraction, candidates, optionGroups, existingDraft, srApply.noteItemIdx
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
            result.weakClarification = true;
          }
        }
      } else if (isNoOpKeep) {
        // Keep-only, no note change: the model recognised menu items in the
        // text but is not changing anything — i.e. the customer asked a
        // QUESTION about products already in the cart ("ikisi arasinda fark
        // ne", "icinde ne var"). Without this branch createDraftOrder returns
        // the unchanged order and the flow re-sends the whole cart summary
        // instead of answering — the cart-summary noise from the transcripts.
        result.clarificationQuestion =
          'Siparisinizi tam anlayamadim. Lutfen ne istediginizi biraz daha aciklar misiniz?';
        result.weakClarification = true;
      }

      // 8. Special-request outcome: either the note landed on a draft (tell the
      // customer), or we keep it and keep the product question open. Never a
      // "staff will get back to you" dead end.
      // A request that is not placed yet lives until its 30-minute TTL, a new
      // request, or the answer that places it — never used up by unrelated
      // turns. In production the address and the pin came between our
      // "Yarim / Tam?" question and "yarim", and the old one-extra-turn rule
      // sent the sandwich to the kitchen without the note (High Five, 12.09).
      let pendingToPersist: PendingSpecialRequest | null = null;
      let specialQuestionNames: string[] | null = null;
      if (effectiveRequest && srApply.applied && result.draftOrderId) {
        result.specialRequestNote = effectiveRequest.note;
        if (result.confirmationMessage) {
          const ack = 'Ozel isteginizi siparis notuna ekledim, mutfagimiz buna gore hazirlayacak.';
          // WhatsApp interactive body limit is 1024 chars; when the ack does not
          // fit, the summary's "Not: Ozel istek: ..." line still shows it.
          if (ack.length + 2 + result.confirmationMessage.length <= 1024) {
            result.confirmationMessage = `${ack}\n\n${result.confirmationMessage}`;
          }
        }
      } else if (specialRequest && !result.draftOrderId) {
        const freshEvidence = freshCandidates.some((c) => c.score >= FRESH_EVIDENCE_SCORE);
        const draftCount = existingDraft?.items?.length ?? 0;
        // No product evidence at all ("sadece adres yazabilirim"): drop the
        // request, the normal pipeline answers the message unchanged.
        const scope: PendingSpecialRequest['scope'] | null = freshEvidence ? 'menu' : draftCount >= 2 ? 'draft' : null;
        if (scope) {
          const q = this.buildSpecialRequestQuestion(specialRequest.note, scope, freshCandidates, existingDraft);
          pendingToPersist = {
            ...specialRequest,
            sourceMessageId: messageId,
            createdAt: new Date().toISOString(),
            scope,
            menuItemIds: q?.ids,
            names: q?.names,
            question: q?.text,
          };
          if (!result.pendingOptionSelection) {
            if (result.clarificationQuestion && !result.weakClarification) {
              result.clarificationQuestion = `Ozel isteginizi (${specialRequest.note}) not alacagim. ${result.clarificationQuestion}`;
            } else if (q) {
              result.clarificationQuestion = q.text;
              // A concrete product question — the flow must send it, not route
              // to the generic answer layer that knows nothing about the request.
              result.weakClarification = false;
              specialQuestionNames = q.names;
            }
          }
        }
      } else if (pendingRequest && !srApply.applied) {
        // Still open: keep it with the ORIGINAL createdAt so the TTL stays honest.
        pendingToPersist = { ...pendingRequest };
        specialQuestionNames = pendingRequest.names ?? null;
        if (result.confirmationMessage) {
          // Something else went into the cart ("2 kola"): show it and keep our question open.
          if (pendingRequest.question) {
            const withQuestion = `${result.confirmationMessage}\n\n${pendingRequest.question}`;
            if (withQuestion.length <= 1024) result.confirmationMessage = withQuestion;
          }
        } else if (!result.pendingOptionSelection && !result.draftOrderId) {
          if (result.clarificationQuestion && !result.weakClarification) {
            result.clarificationQuestion = `Ozel isteginizi (${pendingRequest.note}) not alacagim. ${result.clarificationQuestion}`;
          } else if (classifyAddressText(userText).kind === 'none' && !isInformationalQuestion(userText)) {
            // Products named again → ask about those; nothing product-like → repeat our question.
            // Address / directions / a real question are left to the flow, which
            // acknowledges them and appends the open question itself.
            const freshEvidence = freshCandidates.some((c) => c.score >= FRESH_EVIDENCE_SCORE);
            const q =
              freshEvidence && pendingRequest.scope === 'menu'
                ? this.buildSpecialRequestQuestion(pendingRequest.note, 'menu', freshCandidates, existingDraft)
                : null;
            const text = q?.text ?? pendingRequest.question;
            if (text) {
              result.clarificationQuestion = text;
              result.weakClarification = false;
              if (q) {
                pendingToPersist = { ...pendingToPersist, menuItemIds: q.ids, names: q.names, question: q.text };
                specialQuestionNames = q.names;
              }
            }
          }
        }
      }

      // 9. Save order intent (include candidate IDs for follow-up context)
      const orderIntent = await this.saveOrderIntent(
        tenantId,
        conversationId,
        messageId,
        extractionForIntent,
        candidates.map((c) => c.menuItemId),
        pendingToPersist ? { _pendingSpecialRequest: pendingToPersist } : undefined
      );
      result.orderIntent = this.mapOrderIntentToDto(orderIntent);

      logger.info(
        {
          tenantId,
          conversationId,
          messageId,
          itemsExtracted: extraction.items.length,
          confidence: extraction.confidence,
          draftOrderId: result.draftOrderId,
          hasExistingDraft: !!existingDraft,
          specialRequest: effectiveRequest
            ? { note: effectiveRequest.note, applied: srApply.applied, pending: !!pendingToPersist }
            : undefined,
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
          specialRequest: pendingToPersist
            ? { note: pendingToPersist.note, names: specialQuestionNames }
            : undefined,
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

  // ==================== SPECIAL REQUEST (restrictive order note) ====================

  /** A special request saved on the previous intent, still within its TTL. */
  private readPendingSpecialRequest(prevIntent: { extractedJson: unknown } | null): PendingSpecialRequest | null {
    const p = (prevIntent?.extractedJson as any)?._pendingSpecialRequest;
    if (!p || typeof p.note !== 'string' || !p.note || typeof p.createdAt !== 'string') return null;
    const age = Date.now() - Date.parse(p.createdAt);
    if (!Number.isFinite(age) || age > PENDING_SPECIAL_REQUEST_TTL_MS) return null;
    return p as PendingSpecialRequest;
  }

  /**
   * The product question of a special request that is still open, for turns
   * that never reach the NLU (a pin) or that the flow answers itself (an
   * address before any product). Lets the flow repeat the concrete question
   * instead of a generic "what would you like to order?".
   */
  async getOpenSpecialRequestQuestion(tenantId: string, conversationId: string): Promise<string | null> {
    try {
      const pending = this.readPendingSpecialRequest(await this.getLastOrderIntent(tenantId, conversationId));
      return pending?.question || null;
    } catch {
      return null;
    }
  }

  /** Name, category and matched synonyms of each item the extractor wants to remove. */
  private async describeRemovedItems(
    tenantId: string,
    extraction: LlmExtractionResponse,
    candidates: MenuCandidateDto[],
    existingDraft: { items: Array<{ menuItemId: string; menuItemName: string }> } | null
  ): Promise<Map<string, string[]>> {
    const ids = [...new Set(extraction.items.filter((i) => i.action === 'remove').map((i) => i.menuItemId))];
    const texts = new Map<string, string[]>();
    if (ids.length === 0) return texts;
    const add = (id: string, ...values: Array<string | null | undefined>) => {
      const list = texts.get(id) ?? [];
      for (const v of values) if (v) list.push(v);
      texts.set(id, list);
    };
    for (const c of candidates) {
      if (ids.includes(c.menuItemId)) add(c.menuItemId, c.name, c.category, ...(c.synonymsMatched || []));
    }
    for (const d of existingDraft?.items ?? []) {
      if (ids.includes(d.menuItemId)) add(d.menuItemId, d.menuItemName);
    }
    try {
      // Cart-only candidates carry no category; the menu row does.
      const rows = await prisma.menuItem.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true, name: true, category: true },
      });
      for (const r of rows) add(r.id, r.name, r.category);
    } catch {
      // Non-critical: name/synonyms from the candidates still apply
    }
    return texts;
  }

  /**
   * Put the special request onto the extraction (item note or order note)
   * BEFORE the draft is written. Never adds products and never changes
   * quantities or prices. Returns which extracted items now carry the note.
   */
  private applySpecialRequest(opts: {
    extraction: LlmExtractionResponse;
    request: SpecialRequest;
    fromThisMessage: boolean;
    existingDraft: { items: Array<{ menuItemId: string; qty: number; notes: string | null; optionsJson: unknown }> } | null;
    freshCandidates: MenuCandidateDto[];
    userText: string;
    /** Name / category / synonyms of every removed item */
    removedItemTexts?: Map<string, string[]>;
    /** Carried-over request: only these products may receive it (null = no limit) */
    allowedItemIds?: Set<string> | null;
  }): { applied: boolean; noteItemIdx: Set<number> } {
    const { extraction, request } = opts;
    const items = extraction.items;
    const noteItemIdx = new Set<number>();
    const prefixed = `${SPECIAL_REQUEST_PREFIX}${request.note}`;
    const draftItems = opts.existingDraft?.items ?? [];
    const clean = (n: string | null | undefined) => (n && n !== '__CLEAR__' ? n : null);
    const foldNote = (n: string) => foldTr(n).replace(/^ozel istek:\s*/, '').replace(/\s+/g, ' ').trim();
    const applied = () => ({ applied: true, noteItemIdx });
    const allowed = (menuItemId: string) => !opts.allowedItemIds || opts.allowedItemIds.has(menuItemId);

    // 1. REMOVE-GUARD: the extractor maps "istemiyorum" to remove, so
    // "pizzada sogan istemiyorum" would delete the pizza. An ingredient
    // exclusion without an explicit removal verb keeps the item and notes it.
    // An exclusion that names the removed product itself ("kolayi istemiyorum",
    // "tatliyi istemiyorum") is a real removal and stays one.
    if (opts.fromThisMessage && request.kind === 'exclude' && !hasItemRemoveSignal(opts.userText)) {
      items.forEach((item, idx) => {
        if (item.action !== 'remove') return;
        if (exclusionNamesProduct(request.note, opts.removedItemTexts?.get(item.menuItemId) ?? [])) return;
        item.action = 'keep';
        item.notes = prefixed;
        noteItemIdx.add(idx);
      });
      if (noteItemIdx.size > 0) return applied();
    }

    // 2. The model already wrote notes for this message → trust them, flag for
    // staff. An echo of a note the cart line already has does not count.
    if (opts.fromThisMessage) {
      items.forEach((item, idx) => {
        const notes = clean(item.notes);
        if (item.action === 'remove' || !notes) return;
        if (item.action === 'keep') {
          const d = draftItems.find((di) => di.menuItemId === item.menuItemId);
          if (d?.notes && foldNote(d.notes).includes(foldNote(notes))) return;
        }
        if (!foldTr(notes).startsWith('ozel istek')) item.notes = `${SPECIAL_REQUEST_PREFIX}${notes}`;
        noteItemIdx.add(idx);
      });
      if (noteItemIdx.size > 0) return applied();
    }

    const addIdx = items
      .map((it, i) => (it.action === 'add' && allowed(it.menuItemId) ? i : -1))
      .filter((i) => i >= 0);

    // 3. Exactly one product added → the note belongs to it.
    if (addIdx.length === 1) {
      const it = items[addIdx[0]];
      it.notes = this.mergeNotes(clean(it.notes), prefixed);
      noteItemIdx.add(addIdx[0]);
      return applied();
    }

    // 5. Several products → do not guess the line; the kitchen reads the order note.
    if (addIdx.length >= 2) {
      extraction.orderNotes = this.mergeNotes(clean(extraction.orderNotes), prefixed);
      return applied();
    }

    // 4. Nothing added: a cart line named in this message, or the only cart line.
    const directKeeps = items
      .map((it, i) => (it.action === 'keep' && allowed(it.menuItemId) &&
        opts.freshCandidates.some((c) => c.menuItemId === it.menuItemId && c.score >= DIRECT_MATCH_SCORE) ? i : -1))
      .filter((i) => i >= 0);
    let targetIdx = directKeeps.length === 1 ? directKeeps[0] : -1;
    const freshNonDraft = opts.freshCandidates.some(
      (c) => c.score >= FRESH_EVIDENCE_SCORE && !draftItems.some((d) => d.menuItemId === c.menuItemId)
    );
    if (
      targetIdx < 0 &&
      draftItems.length === 1 &&
      allowed(draftItems[0].menuItemId) &&
      !freshNonDraft &&
      !items.some((i) => i.action === 'remove')
    ) {
      const d = draftItems[0];
      targetIdx = items.findIndex((i) => i.action === 'keep' && i.menuItemId === d.menuItemId);
      if (targetIdx < 0) {
        items.push({
          menuItemId: d.menuItemId,
          qty: d.qty,
          action: 'keep',
          // Carry the line's options so the required-option check does not re-ask them
          optionSelections: Array.isArray(d.optionsJson)
            ? (d.optionsJson as Array<{ groupName: string; optionName: string }>).map((o) => ({
                groupName: o.groupName,
                optionName: o.optionName,
              }))
            : [],
          extras: [],
          notes: '',
          itemConfidence: 0.9,
        });
        targetIdx = items.length - 1;
      }
    }
    if (targetIdx >= 0) {
      items[targetIdx].notes = this.mergeNotes(clean(items[targetIdx].notes), prefixed);
      noteItemIdx.add(targetIdx);
      // Resolved locally: the note edit must reach the draft instead of the
      // low-confidence / clarification branches.
      extraction.confidence = Math.max(extraction.confidence, CONFIDENCE_THRESHOLD);
      extraction.clarificationQuestion = null;
      return applied();
    }

    return { applied: false, noteItemIdx };
  }

  /** One concrete question that places the special request on a product. */
  private buildSpecialRequestQuestion(
    note: string,
    scope: 'menu' | 'draft',
    freshCandidates: MenuCandidateDto[],
    existingDraft: { items: Array<{ menuItemName: string; menuItemId: string }> } | null
  ): { text: string; names: string[]; ids: string[] } | null {
    if (scope === 'draft') {
      const lines = existingDraft?.items ?? [];
      const names = [...new Set(lines.map((i) => i.menuItemName))];
      if (names.length === 0) return null;
      return {
        text: `Ozel isteginizi (${note}) hangi urune ekleyelim: ${names.join(', ')}?`,
        names,
        ids: [...new Set(lines.map((i) => i.menuItemId))],
      };
    }
    const sorted = freshCandidates.slice().sort((a, b) => b.score - a.score);
    if (sorted.length === 0) return null;
    const floor = Math.max(0.15, sorted[0].score * 0.5);
    const picks = sorted.filter((c) => c.score >= floor).slice(0, 3);
    const list = picks
      .map((c) => `${c.name} (${(c.effectivePrice ?? c.basePrice).toFixed(2)} TL)`)
      .join(', ');
    return {
      text: `Ozel isteginizi (${note}) siparis notuna ekleyecegim. Hangisini istersiniz: ${list}?`,
      names: picks.map((c) => c.name),
      ids: picks.map((c) => c.menuItemId),
    };
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
- Kisa yaz (1-3 cumle). ASLA emoji kullanma.
- Fiyatlar sabittir: indirim, pazarlik veya "size ozel yapariz" gibi seyler ASLA teklif etme.
- ASLA musteriye "su kelimeyi yaz" gibi talimat verme; cevabin ya bilgi ya da net bir soru olsun.
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
    /** An open special request: the rewrite must mention it and ask only about `names` */
    specialRequest?: { note: string; names: string[] | null };
  }): Promise<void> {
    try {
      const choice = opts.route.model === 'sonnet' ? ('sonnet' as const) : ('haiku' as const);
      let situation = `Sistem su netlestirme ihtiyacini belirledi: "${opts.result.clarificationQuestion}". Musteriye bu netlestirmeyi kendi dilinde, dogal ve kisa bir mesajla sor.`;
      const names = opts.specialRequest?.names ?? [];
      if (opts.specialRequest) {
        situation +=
          ` Musterinin ozel istegi "${opts.specialRequest.note}" siparise not olarak eklenecek; bunu kisaca belirt.` +
          (names.length > 0 ? ` SADECE su urunleri sor: ${names.join(', ')}.` : '') +
          ' Baska urun veya fiyat uydurma.';
      }
      situation += ' "Gorevlimiz kontrol edecek", "temsilci", "size donecegiz" gibi ifadeler ASLA kullanma.';
      const system = this.buildClaudeReplySystemPrompt({
        candidates: opts.candidates,
        optionGroups: opts.optionGroups,
        existingOrderContext: opts.existingOrderContext,
        customerPreferencesContext: opts.customerPreferencesContext,
        situation,
      });
      const messages = this.buildClaudeMessages(opts.history, opts.userText);
      const reply = await claudeClientService.generateReply({ choice, system, messages });
      if (!reply) return; // Claude failed → keep the local clarification text

      // Guard rails: a "staff will get back to you" promise is exactly what
      // left customers waiting in silence, and a special-request question that
      // lost the product names is no longer answerable — keep the local text.
      const foldedReply = foldTr(reply.text);
      if (['gorevlimiz', 'temsilci', 'size donecegiz', 'donus yapacagiz', 'size donus'].some((p) => foldedReply.includes(p))) {
        logger.warn({ tenantId: opts.tenantId }, 'Hybrid reply promised a staff hand-off, keeping local text');
        return;
      }
      if (names.length > 0 && !names.some((n) => foldedReply.includes(foldTr(n)))) {
        return;
      }

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
    candidateIds?: string[],
    meta?: Record<string, unknown>
  ) {
    // Save candidate IDs alongside extraction data for follow-up context
    const extractionWithCandidates = {
      ...extraction,
      _candidateIds: candidateIds || [],
      ...(meta || {}),
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
   * Merge order/item notes without ever repeating the same note.
   *
   * ROOT CAUSE this fixes: the existing draft's notes are rendered into the
   * LLM prompt ("MEVCUT SIPARIS: ... - Not: Bol peynir") and the model echoes
   * them back on every turn. The old code blindly concatenated, so the note
   * length doubled each turn (L -> 2L -> 4L ...); 7 turns produced the
   * observed 128 repetitions.
   *
   * Rules: the same note appears once, DIFFERENT notes are all preserved, and
   * the result is capped so a runaway model cannot blow up the kitchen ticket.
   */
  private mergeNotes(existing: string | null | undefined, incoming?: string | null): string | null {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const part of `${existing ?? ''},${incoming ?? ''}`.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // Turkish-aware dedup key (İ/I/ı/i collapse to the same letter)
      const key = trimmed
        .toLocaleLowerCase('tr')
        .replace(/̇/g, '')
        .replace(/ı/g, 'i')
        .replace(/\s+/g, ' ')
        // "Ozel istek: Sadece mozerella" and an echoed "Sadece mozerella" are the same note
        .replace(/^ozel istek:\s*/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }

    if (out.length === 0) return null;

    let merged = out.join(', ');
    if (merged.length > MAX_NOTES_LENGTH) {
      merged = merged.substring(0, MAX_NOTES_LENGTH).replace(/,\s*[^,]*$/, '');
    }
    return merged || null;
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
    existingDraft?: any,
    /** Indices of extracted items that carry a special-request note */
    noteItemIdx?: Set<number>
  ) {
    // If all items are 'keep' or no items, nothing to do
    const actionItems = extraction.items.filter((i) => i.action !== 'keep');
    if (extraction.items.length === 0) return null;
    const noteKey = (notes: string | null | undefined) =>
      crypto.createHash('md5').update(foldTr(notes || '').replace(/^ozel istek:\s*/, '').trim()).digest('hex').slice(0, 6);

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
      for (const [i, item] of (existingDraft.items as any[]).entries()) {
        let key = this.itemKey(item.menuItemId, item.optionsJson);
        // A special-request line lives next to a plain line of the same
        // product; without a distinct key one would overwrite the other.
        if (existingItemsMap.has(key)) key = `${key}:n:${noteKey(item.notes)}:${i}`;
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
    for (const [idx, item] of extraction.items.entries()) {
      const candidate = candidates.find((c) => c.menuItemId === item.menuItemId);
      if (!candidate) continue;

      const action = item.action || 'add';

      // Resolve option price deltas
      const { totalDelta, resolvedOptions } = this.resolveOptionDeltas(item, optionGroups);
      const unitPrice = (candidate.effectivePrice ?? candidate.basePrice) + totalDelta;
      const optionsJson = resolvedOptions.length > 0 ? resolvedOptions : null;
      const extrasJson = item.extras.length > 0 ? item.extras : null;
      let key = this.itemKey(item.menuItemId, optionsJson);

      if (action === 'add') {
        let existing = existingItemsMap.get(key);
        // "1 Italiano Yarim" then "1 Italiano Yarim sadece mozzarella" must stay
        // two lines — merging would put the note on both sandwiches.
        if (existing && noteItemIdx?.has(idx) && noteKey(existing.notes) !== noteKey(item.notes)) {
          key = `${key}:n:${noteKey(item.notes)}`;
          existing = existingItemsMap.get(key);
        }
        if (existing) {
          // Same item+options → increase qty
          existing.qty += item.qty;
          existing.unitPrice = unitPrice; // Update price in case options changed
          if (item.notes === '__CLEAR__') {
            existing.notes = null;
          } else if (item.notes) {
            // Merge (not overwrite): a second note on the same line must not
            // erase the first one, and a repeated note must not duplicate.
            existing.notes = this.mergeNotes(existing.notes, item.notes);
          }
          if (extrasJson) {
            existing.extrasJson = extrasJson;
          }
        } else {
          // New item — dedup inside the incoming string too, in case the model
          // emitted "Bol peynir, Bol peynir" in one shot.
          existingItemsMap.set(key, {
            menuItemId: item.menuItemId,
            menuItemName: candidate.name,
            qty: item.qty,
            unitPrice,
            optionsJson,
            extrasJson,
            notes: item.notes === '__CLEAR__' ? null : this.mergeNotes(null, item.notes),
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
            existingItem.notes = this.mergeNotes(existingItem.notes, item.notes);
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
              ? { notes: this.mergeNotes(existingDraft.notes, extraction.orderNotes) }
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
          notes:
            extraction.orderNotes && extraction.orderNotes !== '__CLEAR__'
              ? this.mergeNotes(null, extraction.orderNotes)
              : null,
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

    // The written-address flag ("Konum paylasilmadi - ...") is for staff; the
    // customer summary must not show it (the flow's buildOrderSummary strips it too).
    return llmExtractorService.generateSimpleSummary(items, totalPrice, stripTypedAddressNote(order.notes));
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
