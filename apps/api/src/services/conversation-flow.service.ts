import prisma from '../db/prisma';
import { inboxService } from './inbox.service';
import { whatsappService } from './whatsapp.service';
import { nluOrchestratorService, OptionSelectionRequest } from './nlu/orchestrator.service';
import { deriveSpecialRequest } from './nlu/intent-analysis.service';
import { menuCandidateService } from './nlu/menu-candidate.service';
import {
  foldTr,
  words as foldedWords,
  classifyAddressText,
  hasAddSignal,
  hasQuestionSignal as textHasQuestionSignal,
  isAddressConfirmReply,
  isAddressRejectReply,
  isAddressWaitReply,
  isAreaComplaint,
  isConfusionAboutCart,
  isExplicitMidFlowEdit,
  isLocationRefusal,
  hasAddressEvidence,
  isMidFlowItemMention,
  isOrderDonePhrase,
  isPaymentQuestion,
  isUndoLastChangeIntent,
  mentionsMenuItemName,
} from './nlu/flow-text-signals';
import {
  conversationAnswerService,
  CartLine,
  GREETING_MARKER,
  OFF_TOPIC_FIRST_MARKER,
  OFF_TOPIC_FINAL_MARKER,
} from './nlu/conversation-answer.service';
import { whisperService } from './nlu/whisper.service';
import { geoService } from './geo.service';
import { orderService } from './order.service';
import { orderPaymentService } from './order-payment.service';
import { savedAddressService } from './saved-address.service';
import { storeService } from './store.service';
import { upsellService } from './upsell.service';
import { surveyService } from './survey.service';
import { reorderService } from './reorder.service';
import { billingService } from './billing.service';
import {
  TEMPLATES,
  TYPED_ADDRESS_NOTE,
  ADDRESS_ASK_MARKER,
  stripTypedAddressNote as stripTypedAddressFlag,
} from './message-templates';
import { Prisma } from '@prisma/client';
import { WHATSAPP_KVKK_MESSAGE, WHATSAPP_KVKK_ACCEPTED, WHATSAPP_MARKETING_ASK, WHATSAPP_MARKETING_ACCEPTED, WHATSAPP_MARKETING_DECLINED } from './legal-texts';
import { createLogger } from '../logger';
import {
  WhatsAppWebhookPayload,
  MessageDto,
  ConversationPhase,
  GeoCheckResult,
} from '@whatres/shared';

const logger = createLogger();

/**
 * Normalize Turkish text for keyword matching.
 * Handles İ/I/ı/i inconsistencies in JavaScript's toLowerCase().
 * 'İ'.toLowerCase() produces 'i̇' (i + combining dot above) instead of 'i'.
 */
function normalizeTr(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u0307/g, '') // Remove combining dot above (İ→i̇→i)
    .replace(/ı/g, 'i')     // Dotless ı → i
    .trim();
}

/**
 * Fold the remaining Turkish letters to ASCII for keyword matching.
 *
 * normalizeTr only handles the dotted/dotless i, so real customer spelling like
 * "cikar" written as "çıkar", "değiştir", "nasıl ödeyeceğim" or
 * "siparişi iptal et" never matched the ASCII keyword lists and silently fell
 * through to the wrong branch. Used for MATCHING ONLY — the raw customer text
 * is what reaches the LLM.
 */
function deaccentTr(text: string): string {
  return foldTr(text).trim();
}

// Keywords for user intent detection
const CONFIRM_KEYWORDS = ['evet', 'onayla', 'tamam', 'olsun', 'tamamla', 'onayliyorum', 'harika', 'super', 'guzel', 'iyi', 'mükemmel', 'mukemmel', 'dogru', 'aynen', 'kesinlikle'];
const CANCEL_KEYWORDS = ['iptal', 'vazgec', 'istemiyorum', 'sil', 'temizle'];
// NOTE: 'ekle' and 'cikar' were REMOVED on purpose. They are content-bearing
// order commands ("bi kremali mantarli makarna da ekle", "kolayi cikar") and
// must reach the NLU so the product actually lands in / leaves the cart.
// Keeping them here was the single cause of the 40x "Siparisinizi degistirmek
// icin yeni urun yazin" dead-end where the product silently vanished.
const EDIT_KEYWORDS = ['hayir', 'degistir', 'degis'];
// Item-level removal verbs — routed to the NLU, never to a template.
const REMOVE_KEYWORDS = ['cikar', 'kaldir'];
const MENU_KEYWORDS = ['menu', 'men\u00fc', 'neler var', 'fiyat', 'liste'];
const CASH_KEYWORDS = ['nakit', 'kapida', 'kap\u0131da'];
const CARD_KEYWORDS = ['kart', 'kredi'];
const GREETING_KEYWORDS = ['merhaba', 'selam', 'iyi gunler', 'iyi g\u00fcnler', 'nasilsiniz', 'nas\u0131ls\u0131n\u0131z', 'hey', 'sa'];
const THANKS_KEYWORDS = ['tesekkur', 'te\u015fekk\u00fcr', 'sagol', 'sa\u011fol', 'eyvallah'];
const HELP_KEYWORDS = ['yardim', 'yard\u0131m', 'nasil', 'nas\u0131l', 'ne yapabilirim'];
const REORDER_KEYWORDS = ['tekrar', 'favorilerim', 'favori', 'onceki', 'gene ayni', 'her zamanki'];
const WORKING_HOURS_KEYWORDS = [
  'saat kacta', 'saat kaçta', 'kacta acili', 'kaçta açılı',
  'ne zaman acili', 'ne zaman açılı', 'acilis saati', 'açılış saati',
  'calisma saat', 'çalışma saat', 'kapali mi', 'kapalı mı',
  'acik mi', 'açık mı', 'saat kac', 'saat kaç', 'kacta kapani',
  'kaçta kapanı', 'ne zamana kadar', 'kapaniyor', 'kapanıyor',
  'aciyorsunuz', 'açıyorsunuz', 'acik misiniz', 'açık mısınız',
];
const BROADCAST_OPT_OUT_KEYWORDS = ['kampanya istemiyorum', 'bildirim kapat'];
const PAYMENT_CHANGE_KEYWORDS = [
  'online ode', 'online öde',
  'odeme linki', 'ödeme linki',
  'online odeme', 'online ödeme',
  'kart ile ode', 'kart ile öde',
  'kartla ode', 'kartla öde',
  'link gonder', 'link gönder',
];

// Payment link expiry (30 minutes)
const PAYMENT_LINK_EXPIRY_MS = 30 * 60 * 1000;

// A conversation held by the old negative-constraint gate is replayed only when
// the hold is this fresh (same window as a "recent" confirmed order). Older holds
// restart cleanly instead of reviving a days-old cart.
const LEGACY_HOLD_REPLAY_MS = 2 * 60 * 60 * 1000;

// A pin sent before the current draft existed is still used for it within this window.
const PRE_ORDER_PIN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// Undo stack for cart changes made after the order was confirmed.
const MID_FLOW_UNDO_MAX = 3;
const MID_FLOW_UNDO_TTL_MS = 30 * 60 * 1000; // inactivity cancels a draft after ~15 min anyway

interface FlowContext {
  tenantId: string;
  conversationId: string;
  conversation: any; // Raw Prisma conversation record
  message: MessageDto;
  payload: WhatsAppWebhookPayload;
}

/** One cart line before a mid-flow change. Item ids are NOT kept: the NLU re-creates the rows on every pass. */
interface CartSnapshotLine {
  menuItemId: string;
  menuItemName: string;
  qty: number;
  unitPrice: number;
  optionsJson: any;
  extrasJson: any;
  notes: string | null;
}

/** Stored in conversation.flowMetadata.midFlowChanges (newest last). */
interface MidFlowChangeRecord {
  v: 1;
  orderId: string;
  phase: ConversationPhase;
  messageId: string;
  at: string;
  before: CartSnapshotLine[];
  beforeTotal: number;
  beforeNotes: string | null;
  afterSignature: string;
}

/** A PENDING_AGENT status that the old negative-constraint gate set by itself. */
interface LegacyGateHold {
  gateReplyAt: Date;
  heldMessage: { id: string; text: string | null } | null;
}

export class ConversationFlowService {
  /**
   * Main entry point - handle every incoming message through the state machine
   */
  async handleIncomingMessage(
    tenantId: string,
    conversationId: string,
    message: MessageDto,
    payload: WhatsAppWebhookPayload,
  ): Promise<void> {
    // Get full conversation record (with phase)
    const conversation = await inboxService.getConversationRaw(tenantId, conversationId);
    if (!conversation) {
      logger.error({ tenantId, conversationId }, 'Conversation not found in flow service');
      return;
    }

    const ctx: FlowContext = { tenantId, conversationId, conversation, message, payload };
    let currentPhase = (conversation.phase as ConversationPhase) || 'IDLE';

    // Agent takeover guard: if an agent has locked this conversation,
    // the bot stays completely silent. Only the agent responds via inbox.
    // An EXPIRED lock does not count: the inbox refreshes the lock every
    // 2 minutes while an agent has the thread open and stale rows are only
    // cleaned lazily, so a leftover row must not silence the bot forever.
    const lock = await prisma.conversationLock.findUnique({
      where: { conversationId },
    });
    const lockActive = !!lock && (!lock.expiresAt || new Date(lock.expiresAt).getTime() > Date.now());
    if (lockActive) {
      logger.info(
        { tenantId, conversationId, hasLock: true, status: conversation.status },
        'Bot silenced — conversation is handled by an agent',
      );
      return;
    }

    // PENDING_AGENT normally means a human took over (handoff button, an
    // assignment, a staff reply) and the bot must stay silent. The old
    // negative-constraint gate ALSO set it by itself for "sadece mozerella"
    // style orders, and nobody ever answered those customers (High Five, 12.09).
    // Only such bot-made holds with no human action since are resumed.
    let legacyHold: LegacyGateHold | null = null;
    if (conversation.status === 'PENDING_AGENT') {
      legacyHold = await this.findLegacyConstraintGateHold(ctx);
      if (!legacyHold) {
        logger.info(
          { tenantId, conversationId, hasLock: false, status: conversation.status },
          'Bot silenced — conversation is handled by an agent',
        );
        return;
      }
    }

    // Subscription guard: if the restaurant's subscription is suspended
    // (EXPIRED/CANCELLED, or UNPAID past the 2-day grace period), the bot stays
    // completely silent — no auto-reply to the incoming WhatsApp message. The
    // message is still stored (processIncomingMessage already ran); we only skip
    // generating a bot response so a non-paying tenant gets no service.
    //
    // EXCEPTION: the in-panel chatbot test console (customerPhone "chatbot-*")
    // is a developer/testing tool and must work regardless of subscription
    // status, so the owner can always preview the flow.
    const isChatbotTest = typeof conversation.customerPhone === 'string'
      && conversation.customerPhone.startsWith('chatbot-');
    if (!isChatbotTest) {
      const sub = await billingService.isSubscriptionActive(tenantId);
      if (!sub.active) {
        logger.info(
          { tenantId, conversationId, reason: sub.reason },
          'Bot silenced — tenant subscription is not active',
        );
        return;
      }
    }

    logger.info(
      { tenantId, conversationId, phase: currentPhase, messageKind: message.kind },
      'Flow service handling message',
    );

    try {
      if (legacyHold) {
        const resumed = await this.resumeFromConstraintGateHold(ctx, legacyHold);
        if (resumed.handled) return;
        currentPhase = resumed.phase;
      }

      // Store-closed guard: block new orders when all stores are closed
      const guardPhases: ConversationPhase[] = [
        'IDLE', 'ORDER_COLLECTING', 'ORDER_REVIEW', 'ADDITION_PROMPT',
      ];
      if (guardPhases.includes(currentPhase)) {
        const allClosed = await storeService.areAllStoresClosed(tenantId);
        if (allClosed) {
          // Only send if last outbound wasn't already the closed message
          const lastOut = await prisma.message.findFirst({
            where: { conversationId, tenantId, direction: 'OUT' },
            orderBy: { createdAt: 'desc' },
          });
          if (!lastOut || lastOut.text !== TEMPLATES.storeClosed) {
            await this.sendText(ctx, TEMPLATES.storeClosed);
          }
          return;
        }
      }
      // Inactivity warning intercept: if customer responds while warned, clear warning and continue
      if (conversation.flowSubState === 'INACTIVITY_WARNING') {
        const { inactivityTimeoutService } = await import('./inactivity-timeout.service');
        await inactivityTimeoutService.clearInactivityState(conversationId);
        // Refresh conversation object since flowSubState/flowMetadata changed
        const refreshed = await inboxService.getConversationRaw(tenantId, conversationId);
        if (refreshed) {
          ctx.conversation = refreshed;
        }
        await this.sendText(ctx, TEMPLATES.inactivityResumed);
        // Fall through to normal phase handler — customer's message is not lost
      }

      // Global reset command - works in any phase
      const RESET_KEYWORDS = ['sifirla', 'sıfırla', 'reset', 'bastan', 'baştan'];
      const normalizedText = normalizeTr(ctx.message.text || '');
      if (currentPhase !== 'IDLE' && RESET_KEYWORDS.some(k => normalizedText.includes(k))) {
        logger.info({ tenantId, conversationId, phase: currentPhase }, 'User requested conversation reset');
        await this.cancelActiveOrder(ctx);
        // Always force phase to IDLE (cancelActiveOrder may skip if no active order)
        await inboxService.updateConversationPhase(tenantId, conversationId, 'IDLE', null);
        await this.sendText(ctx, 'Konuşma sıfırlandı. Yeni sipariş vermek için menüden seçim yapabilirsiniz.\n\n*Menü* görmek için "menü" yazın.');
        return;
      }

      // KVKK consent gate: first-time customers see the notice once.
      // ANY reply after the notice counts as implicit acceptance —
      // no need to type "ONAYLIYORUM" specifically.
      if (!conversation.kvkkConsentAt) {
        // Check if we already sent the KVKK notice in this conversation
        const kvkkNoticeSent = await prisma.message.findFirst({
          where: {
            conversationId,
            tenantId,
            direction: 'OUT',
            text: { contains: 'kişisel verileriniz işlenmektedir' },
          },
        });

        if (kvkkNoticeSent) {
          // Customer replied AFTER seeing the notice → auto-accept
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { kvkkConsentAt: new Date() },
          });
          ctx.conversation.kvkkConsentAt = new Date();
          logger.info({ tenantId, conversationId }, 'KVKK auto-accepted (customer replied after notice)');
          // Fall through to normal flow — process the customer's actual message
        } else {
          // First ever message — send KVKK notice
          await this.sendText(ctx, WHATSAPP_KVKK_MESSAGE);
          return;
        }
      }

      let nextPhase: ConversationPhase;

      switch (currentPhase) {
        case 'IDLE':
          nextPhase = await this.handleIdle(ctx);
          break;
        case 'ADDITION_PROMPT':
          nextPhase = await this.handleAdditionPrompt(ctx);
          break;
        case 'ORDER_COLLECTING':
          nextPhase = await this.handleOrderCollecting(ctx);
          break;
        case 'ORDER_REVIEW':
          nextPhase = await this.handleOrderReview(ctx);
          break;
        case 'DELIVERY_TYPE_SELECTION':
          nextPhase = await this.handleDeliveryTypeSelection(ctx);
          break;
        case 'LOCATION_REQUEST':
          nextPhase = await this.handleLocationRequest(ctx);
          break;
        case 'ADDRESS_SELECTION':
          nextPhase = await this.handleAddressSelection(ctx);
          break;
        case 'ADDRESS_COLLECTION':
          nextPhase = await this.handleAddressCollection(ctx);
          break;
        case 'ADDRESS_SAVE_PROMPT':
          nextPhase = await this.handleAddressSavePrompt(ctx);
          break;
        case 'PAYMENT_METHOD_SELECTION':
          nextPhase = await this.handlePaymentMethodSelection(ctx);
          break;
        case 'PAYMENT_PENDING':
          nextPhase = await this.handlePaymentPending(ctx);
          break;
        case 'ORDER_CONFIRMED':
          nextPhase = await this.handleOrderConfirmed(ctx);
          break;
        case 'AGENT_HANDOFF':
          nextPhase = await this.handleAgentHandoff(ctx);
          break;
        default:
          nextPhase = await this.handleIdle(ctx);
      }

      // Update phase if changed
      if (nextPhase !== currentPhase) {
        await inboxService.updateConversationPhase(tenantId, conversationId, nextPhase);
        logger.info(
          { tenantId, conversationId, from: currentPhase, to: nextPhase },
          'Phase transition',
        );
      }
    } catch (error) {
      logger.error({ error, tenantId, conversationId, phase: currentPhase }, 'Flow service error');
      // Never expose a raw/technical error to the customer.
      await this.sendText(ctx, 'Kusura bakmayin, bunu isleyemedim. Ne yapmak istediginizi tekrar yazar misiniz?');
    }
  }

  /**
   * Handle payment completed callback (from iyzico)
   */
  async handlePaymentCompleted(
    tenantId: string,
    conversationId: string,
    orderId: string,
    success: boolean,
  ): Promise<void> {
    const conversation = await inboxService.getConversationRaw(tenantId, conversationId);
    if (!conversation) return;

    if (success) {
      // Check if order is already confirmed (payment change scenario)
      const order = await prisma.order.findFirst({
        where: { id: orderId, tenantId },
        select: { status: true, orderNumber: true },
      });

      if (order && order.status !== 'DRAFT') {
        // Payment change: order already confirmed, just update payment method
        await prisma.order.update({
          where: { id: orderId },
          data: { paymentMethod: 'CREDIT_CARD' },
        });
        await whatsappService.sendText(
          tenantId,
          conversationId,
          TEMPLATES.paymentChangeSuccess(order.orderNumber || 0),
        );
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: null },
        });
        await inboxService.updateConversationPhase(tenantId, conversationId, 'ORDER_CONFIRMED', null);
        return;
      }

      // Normal flow: DRAFT → PENDING_CONFIRMATION
      const pendingOrder = await orderService.setPendingConfirmation(tenantId, orderId, {
        paymentMethod: 'CREDIT_CARD',
      });

      await whatsappService.sendText(
        tenantId,
        conversationId,
        TEMPLATES.paymentSuccess(pendingOrder.orderNumber || 0),
      );

      await inboxService.updateConversationPhase(tenantId, conversationId, 'ORDER_CONFIRMED', null);
    } else {
      // Check if this was a payment change attempt
      const order = await prisma.order.findFirst({
        where: { id: orderId, tenantId },
        select: { status: true },
      });
      if (order && order.status !== 'DRAFT') {
        // Payment change failed - keep existing payment method
        await whatsappService.sendText(
          tenantId,
          conversationId,
          'Online odeme basarisiz oldu. Mevcut odeme yonteminiz gecerli olmaya devam edecektir.',
        );
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: null },
        });
        return;
      }
      await whatsappService.sendText(tenantId, conversationId, TEMPLATES.paymentFailed);
      // Stay in PAYMENT_PENDING - user can retry or switch to cash
    }
  }

  // ==================== PHASE HANDLERS ====================

  /**
   * IDLE: No active order. Listen for menu items or greetings.
   */
  private async handleIdle(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message } = ctx;
    const text = normalizeTr(message.text || '');

    // Adim 10: Faz-mesaj turu uyumsuzlugu - IDLE'da TEXT olmayan mesajlar
    if (message.kind !== 'TEXT' || !text) {
      // Voice messages: try transcription with Whisper
      if (message.kind === 'VOICE') {
        const voiceId = (message.payloadJson as any)?.voiceId;
        if (voiceId && whisperService.isAvailable()) {
          const transcribed = await whisperService.transcribeVoiceMessage(tenantId, voiceId);
          if (transcribed) {
            // Re-process as text message with transcribed content
            const fakeTextMessage = { ...message, kind: 'TEXT' as const, text: transcribed };
            const fakeCtx = { ...ctx, message: fakeTextMessage };
            return this.handleIdle(fakeCtx);
          }
        }
        await this.sendText(ctx, 'Sesli mesajinizi anlayamadim. Ne almak istediginizi yazar misiniz?');
        return 'IDLE';
      }
      if (message.kind === 'IMAGE') {
        await this.sendText(ctx, 'Gorseli okuyamiyorum. Ne almak istediginizi yazar misiniz?');
      } else if (message.kind === 'LOCATION') {
        // The pin really is reused at the address step (getFreshGeoCheck).
        const open = await nluOrchestratorService.getOpenSpecialRequestQuestion(tenantId, conversationId);
        await this.sendText(ctx, `${TEMPLATES.locationReceivedEarly}\n\n${open ?? 'Once ne yemek istersiniz?'}`);
      } else {
        // CATCH-ALL FIX: an unreadable message type is not a greeting.
        await this.sendText(ctx, 'Bu mesaj turunu okuyamadim. Ne yapmak istediginizi yazar misiniz?');
      }
      return 'IDLE';
    }

    // Check working hours and busy mode
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { isBusy: true, busyEstimateMinutes: true, busyMessage: true, workingHours: true },
    });

    // Working hours check
    if (tenant?.workingHours) {
      const wh = tenant.workingHours as any;
      const now = new Date();
      const trTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const today = dayNames[trTime.getDay()];
      const currentTime = `${String(trTime.getHours()).padStart(2, '0')}:${String(trTime.getMinutes()).padStart(2, '0')}`;

      const closedDays: string[] = Array.isArray(wh.closed) ? wh.closed : [];
      const daySchedule = wh[today];
      // Supports two UI shapes: top-level `closed: string[]` (settings) and per-day `closed: boolean` (onboarding).
      if (closedDays.includes(today) || daySchedule?.closed === true) {
        const nextOpen = this.getNextOpenDay(wh, today);
        await this.sendText(ctx, `Bugun kapali gunumuz. ${nextOpen}\n\nCalisma saatlerimiz:\n${this.formatWorkingHours(wh)}`);
        return 'IDLE';
      }

      // 24h open (allDay flag, or open === close) is always open and skips the time check.
      // Overnight ranges where close <= open (e.g. 18:00 - 03:00) span midnight.
      const isAllDay = daySchedule?.allDay === true || (!!daySchedule?.open && daySchedule.open === daySchedule.close);
      if (!isAllDay && daySchedule?.open && daySchedule?.close) {
        const { open, close } = daySchedule;
        const isOpenNow = open < close
          ? currentTime >= open && currentTime < close
          : currentTime >= open || currentTime < close;
        if (!isOpenNow) {
          await this.sendText(ctx, `Su an siparis alamiyoruz. Bugunun calisma saati: ${open} - ${close}\n\nCalisma saatlerimiz:\n${this.formatWorkingHours(wh)}`);
          return 'IDLE';
        }
      }
    }

    // Busy mode check
    if (tenant?.isBusy) {
      const estimate = tenant.busyEstimateMinutes ? `Tahmini teslimat suresi: ~${tenant.busyEstimateMinutes} dakika.` : '';
      const custom = tenant.busyMessage || '';
      const busyText = `Su an yogun bir donemimiz var. ${estimate} ${custom}\n\nSiparis vermeye devam edebilirsiniz.`.trim();
      await this.sendText(ctx, busyText);
    }

    // Handle reorder list selection (sub-state)
    if (ctx.conversation.flowSubState === 'REORDER_LIST_SHOWN') {
      const listReplyId = ctx.payload.interactive?.listReply?.id;
      if (listReplyId?.startsWith('reorder_')) {
        return this.handleReorderSelection(ctx, listReplyId);
      }
      // Not a list reply — clear sub-state and continue normal flow
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { flowSubState: null },
      });
    }

    // Broadcast opt-out
    if (BROADCAST_OPT_OUT_KEYWORDS.some(k => text.includes(k))) {
      try {
        const { broadcastService } = await import('./broadcast.service');
        await broadcastService.handleOptInResponse(tenantId, ctx.conversation.customerPhone, false);
        await this.sendText(ctx, TEMPLATES.broadcastOptOutConfirmed);
      } catch (err) {
        logger.warn({ err }, 'Broadcast opt-out failed');
        await this.sendText(ctx, 'Kampanya bildirimleri kapatildi.');
      }
      return 'IDLE';
    }

    // Working hours question — answer with schedule
    if (WORKING_HOURS_KEYWORDS.some(k => text.includes(k))) {
      const tenantForHours = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { workingHours: true },
      });
      if (tenantForHours?.workingHours) {
        const formatted = this.formatWorkingHours(tenantForHours.workingHours as any);
        await this.sendText(ctx, `Çalışma saatlerimiz:\n\n${formatted}\n\nSipariş vermek için ürün adını yazabilirsiniz.`);
      } else {
        await this.sendText(ctx, 'Çalışma saatlerimiz henüz ayarlanmamış. Sipariş vermek için ürün adını yazabilirsiniz.');
      }
      return 'IDLE';
    }

    // Detect if message contains order signals (numbers, "istiyorum", etc.)
    const orderSignalWords = ['istiyorum', 'siparis', 'sipariş', 'ver', 'getir', 'olsun', 'tane', 'adet', 'li ', 'lu ', 'lü ', 'lı '];
    const hasOrderSignal = orderSignalWords.some(w => text.includes(w)) || /\d/.test(text);

    // Greeting / thanks — only if message is PURELY a greeting (no order content)
    const words = text.split(/\s+/).filter(w => w.length > 1);
    if (!hasOrderSignal && words.length <= 3 && (this.matchesKeyword(text, GREETING_KEYWORDS) || this.matchesKeyword(text, THANKS_KEYWORDS))) {
      // This is the ONLY legitimate greeting site, and even here the template
      // is used at most once per conversation.
      await this.sendGreetingOnce(ctx, 'Buyurun, sizi dinliyorum.');
      return 'IDLE';
    }

    // Help request
    if (!hasOrderSignal && this.matchesKeyword(text, HELP_KEYWORDS)) {
      await this.sendText(ctx, 'Tabii, yardimci olayim. Ne yemek istersiniz ya da menu hakkinda neyi merak ediyorsunuz?');
      return 'IDLE';
    }

    // Menu request — only a short, explicit "show me the menu" request gets the
    // photo/PDF dump. A real question that merely mentions the menu is answered.
    if (!hasOrderSignal && this.isMenuMediaRequest(text)) {
      const sent = await this.sendMenuMedia(ctx);
      if (!sent) {
        await this.sendText(ctx, TEMPLATES.menuNotAvailable);
      }
      return 'IDLE';
    }

    // Reorder / Favorites
    if (this.matchesKeyword(text, REORDER_KEYWORDS)) {
      return this.handleReorderRequest(ctx);
    }

    // Check for active (non-draft) orders — seamless addition
    // Only consider orders from the last 2 hours for seamless addition.
    // Older orders should not intercept new order attempts.
    const activeParentOrder = await orderService.findActiveOrderForConversation(
      tenantId, conversationId
    );

    const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
    const isRecentOrder = activeParentOrder?.createdAt &&
      (Date.now() - new Date(activeParentOrder.createdAt).getTime()) < SESSION_MAX_AGE_MS;

    if (activeParentOrder && isRecentOrder && ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY'].includes(activeParentOrder.status)) {
      // Payment change request: customer wants to switch to online payment
      const isPaymentChange = PAYMENT_CHANGE_KEYWORDS.some(k => text.includes(k));
      if (isPaymentChange) {
        return this.handlePaymentChangeRequest(ctx, activeParentOrder);
      }

      // "Ne kadar tuttu" / "IBAN var mi" about the confirmed order: answer it.
      // It must never reach the NLU, which could treat it as an addition.
      if (await this.tryAnswerPaymentQuestion(ctx, message.text || '', 'IDLE', activeParentOrder)) {
        return 'IDLE';
      }

      // Seamless addition: run NLU directly, add items to existing order
      const addResult = await nluOrchestratorService.processMessage(
        tenantId, conversationId, message.id, text,
      );

      if (addResult.needsAgentHandoff) {
        await this.sendText(ctx, TEMPLATES.agentHandoff);
        return 'AGENT_HANDOFF';
      }

      if (addResult.draftOrderId && addResult.itemsExtracted) {
        return this.handleSeamlessAddition(ctx, activeParentOrder, addResult.draftOrderId);
      }

      if (addResult.clarificationQuestion && !addResult.weakClarification) {
        await inboxService.updateConversationPhase(
          tenantId, conversationId, 'ORDER_COLLECTING', null,
        );
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            flowSubState: 'SEAMLESS_ADDITION',
            flowMetadata: JSON.stringify({ parentOrderId: activeParentOrder.id }),
          },
        });
        await this.sendText(ctx, addResult.clarificationQuestion);
        return 'ORDER_COLLECTING';
      }

      // `|| weakClarification` closes a fall-through hole: without it a weak
      // "anlayamadim" with itemsExtracted=true would drop past this block and
      // run the NLU a second time on the same message.
      if (!addResult.itemsExtracted || addResult.weakClarification) {
        // CATCH-ALL FIX: not an order action — this is a real question about the
        // restaurant, so answer it instead of firing the greeting template.
        // (No pre-confirm guard here: this order is already confirmed.)
        if (await this.answerConversationally(ctx, message.text || '')) return 'IDLE';
        if (addResult.clarificationQuestion) {
          await this.sendText(ctx, addResult.clarificationQuestion);
          return 'IDLE';
        }
        await this.sendGreetingOnce(ctx, 'Buyurun, nasil yardimci olabilirim?');
        return 'IDLE';
      }
    }

    // Try NLU extraction
    const result = await nluOrchestratorService.processMessage(
      tenantId, conversationId, message.id, text,
    );

    if (result.needsAgentHandoff) {
      await this.sendText(ctx, TEMPLATES.agentHandoff);
      return 'AGENT_HANDOFF';
    }

    // Option selection needed — ask via interactive list before confirming order
    if (result.pendingOptionSelection && result.clarificationQuestion) {
      await this.startOptionSelection(ctx, result);
      return 'ORDER_COLLECTING';
    }

    if (result.draftOrderId && result.confirmationMessage) {
      await inboxService.updateConversationPhase(
        tenantId, conversationId, 'ORDER_REVIEW', result.draftOrderId,
      );
      await this.sendOrderConfirmButtons(ctx, result.confirmationMessage);
      await this.checkMinBasketWarning(ctx, result.draftOrderId);
      // Products AND a payment/address question in the first message
      // ("... IBAN ve odeyecegim miktari yazar misiniz"): the cart is shown, now
      // answer the rest too — it used to be silently ignored (High Five, 30.08).
      ctx.conversation.activeOrderId = result.draftOrderId;
      if (!(await this.sendPreConfirmNotice(ctx, text, message.text || ''))) {
        await this.answerSideQuestion(ctx, message.text || '');
      }
      return 'ORDER_REVIEW';
    }

    // A real, useful question from the model ("Et Doner mi Tavuk Doner mi?")
    // is asked as-is. A generic "anlayamadim" placeholder is not — that path
    // goes to the conversational answer layer below.
    if (result.clarificationQuestion && !result.weakClarification) {
      await this.sendText(ctx, result.clarificationQuestion);
      return 'ORDER_COLLECTING';
    }

    // `|| weakClarification` is REQUIRED here. `itemsExtracted` is
    // `extraction.items.length > 0`, which is also true for keep/remove-only
    // extractions — exactly what a pure question produces ("ikisi arasinda
    // fark ne" keeps the cart untouched). Without this the message fell to the
    // tail below and the customer got the generic "Siparisinizi tam
    // anlayamadim" again — the 38x defect.
    if (!result.itemsExtracted || result.weakClarification) {
      // CATCH-ALL FIX (87x "Merhaba! Hosgeldiniz"): the customer asked
      // something real ("gel al yapiyor musunuz", "peperoni piza ne kadar",
      // "en hizli ne hazirlanir"). Answer it.
      if (await this.sendPreConfirmNotice(ctx, text, message.text || '')) return 'IDLE';
      if (await this.answerConversationally(ctx, message.text || '')) return 'IDLE';
      if (result.clarificationQuestion) {
        await this.sendText(ctx, result.clarificationQuestion);
        return 'ORDER_COLLECTING';
      }
      await this.sendGreetingOnce(ctx, 'Buyurun, nasil yardimci olabilirim?');
      return 'IDLE';
    }

    return 'IDLE';
  }

  // ==================== ADDITION PROMPT (legacy fallback) ====================

  private async handleAdditionPrompt(ctx: FlowContext): Promise<ConversationPhase> {
    // Legacy: redirect to IDLE — seamless addition handles this now
    await inboxService.updateConversationPhase(ctx.tenantId, ctx.conversationId, 'IDLE', null);
    return this.handleIdle(ctx);
  }

  /**
   * ORDER_COLLECTING: Items being added to cart. Listen for more items or confirmation.
   */
  private async handleOrderCollecting(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, conversation } = ctx;
    const text = normalizeTr(message.text || '');
    const buttonId = ctx.payload.interactive?.buttonReply?.id;

    // Handle OPTION_SELECTION sub-state: user is selecting options for a bundle item
    if (conversation.flowSubState === 'OPTION_SELECTION') {
      const listReplyTitle = ctx.payload.interactive?.listReply?.title;
      const selectedOption = listReplyTitle || text;
      // Cancel intent can arrive as free text ("iptal") OR as a list/button
      // reply whose title is "İptal" — in which case `text` is empty and we must
      // inspect the selected option title too. Without this the bot keeps
      // re-sending the option list forever instead of cancelling.
      const cancelText = normalizeTr(selectedOption);

      if (this.isFullCancelIntent(text) || this.matchesKeyword(cancelText, CANCEL_KEYWORDS)) {
        await this.cancelActiveOrder(ctx);
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: null, flowMetadata: null },
        });
        await this.sendText(ctx, TEMPLATES.orderCancelled);
        return 'IDLE';
      }

      // Add selected option directly to draft order item's optionsJson
      const orderId = conversation.activeOrderId;
      if (orderId) {
        const orderItem = await prisma.orderItem.findFirst({
          where: { orderId },
          orderBy: { createdAt: 'desc' },
        });

        if (orderItem) {
          const currentOptions = (orderItem.optionsJson as any[]) || [];
          // Find which option group this selection belongs to
          const menuItem = await prisma.menuItem.findUnique({
            where: { id: orderItem.menuItemId },
            include: {
              optionGroups: {
                include: {
                  group: { include: { options: true } },
                },
              },
            },
          });

          let matchedGroupName = '';
          let matchedPriceDelta = 0;
          if (menuItem) {
            for (const og of menuItem.optionGroups) {
              const opt = og.group.options.find(
                o => normalizeTr(o.name) === normalizeTr(selectedOption)
              );
              if (opt) {
                // Check if this group still needs selections
                const existingForGroup = currentOptions.filter(
                  (co: any) => co.groupName === og.group.name
                ).length;
                if (existingForGroup < (og.group.maxSelect || og.group.minSelect || 1)) {
                  matchedGroupName = og.group.name;
                  matchedPriceDelta = Number(opt.priceDelta);
                  break;
                }
              }
            }
          }

          if (matchedGroupName) {
            currentOptions.push({
              groupName: matchedGroupName,
              optionName: selectedOption,
              priceDelta: matchedPriceDelta,
            });

            // Update order item with new option and recalculate price
            const totalDelta = currentOptions.reduce((sum: number, o: any) => sum + (o.priceDelta || 0), 0);
            await prisma.orderItem.update({
              where: { id: orderItem.id },
              data: {
                optionsJson: currentOptions,
                unitPrice: Number(orderItem.unitPrice) + matchedPriceDelta,
              },
            });

            // Recalculate order total
            const allItems = await prisma.orderItem.findMany({ where: { orderId } });
            const newTotal = allItems.reduce((sum, i) => sum + Number(i.unitPrice) * i.qty, 0);
            await prisma.order.update({
              where: { id: orderId },
              data: { totalPrice: newTotal },
            });

            // Check if more options needed
            if (menuItem) {
              const updatedOptions = currentOptions;
              let nextMissing: { groupName: string; remaining: number; options: any[] } | null = null;

              for (const og of menuItem.optionGroups) {
                if (!og.group.required) continue;
                const selectedCount = updatedOptions.filter(
                  (co: any) => co.groupName === og.group.name
                ).length;
                const needed = og.group.minSelect || 1;
                if (selectedCount < needed) {
                  nextMissing = {
                    groupName: og.group.name,
                    remaining: needed - selectedCount,
                    options: og.group.options.map(o => ({
                      id: `opt_${o.name.substring(0, 20).replace(/\s/g, '_')}`,
                      name: o.name,
                      priceDelta: Number(o.priceDelta),
                    })),
                  };
                  break;
                }
              }

              if (nextMissing) {
                const stepNum = (currentOptions.filter((co: any) => co.groupName === nextMissing!.groupName).length) + 1;
                const cleanName = nextMissing.groupName.replace(/ \(\d+x\)/, '');
                await this.sendOptionSelectionList(ctx, {
                  itemName: menuItem.name,
                  groupName: cleanName,
                  stepNumber: stepNum,
                  options: nextMissing.options,
                });
                return 'ORDER_COLLECTING';
              }

              // All options selected! Show order summary
              await prisma.conversation.update({
                where: { id: conversationId },
                data: { flowSubState: null, flowMetadata: null },
              });
              const order = await orderService.getOrder(tenantId, orderId);
              if (order) {
                const summary = this.buildOrderSummary(order);
                await inboxService.updateConversationPhase(tenantId, conversationId, 'ORDER_REVIEW', orderId);
                await this.sendOrderConfirmButtons(ctx, summary);
                return 'ORDER_REVIEW';
              }
            }
          }
        }
      }

      // A payment question while the option list is open is answered and the
      // list comes back. It used to get only "Seçiminizi anlayamadım" — the
      // IBAN / amount question of High Five 30.08 was never answered.
      if (
        message.kind === 'TEXT' &&
        !listReplyTitle &&
        (await this.tryAnswerPaymentQuestion(ctx, message.text || '', 'ORDER_COLLECTING'))
      ) {
        await this.resendOptionSelectionList(ctx);
        return 'ORDER_COLLECTING';
      }
      await this.sendText(ctx, 'Seçiminizi anlayamadım. Lütfen listeden bir seçenek seçin veya iptal etmek için "iptal" yazın.');
      await this.resendOptionSelectionList(ctx);
      return 'ORDER_COLLECTING';
    }

    // Handle SEAMLESS_ADDITION sub-state: clarification answer for active order addition
    if (conversation.flowSubState === 'SEAMLESS_ADDITION') {
      let parentMeta: any = {};
      try { parentMeta = JSON.parse(conversation.flowMetadata || '{}'); } catch { /* ignore */ }
      const parentOrderId = parentMeta.parentOrderId;

      if (parentOrderId && message.kind === 'TEXT' && text) {
        // Check if user is confirming/acknowledging the addition (e.g. "tamamdır", "tamam", "ok")
        // Don't send to NLU - just acknowledge and clear sub-state
        if (this.matchesKeyword(text, CONFIRM_KEYWORDS)) {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { flowSubState: null, flowMetadata: null },
          });
          await this.sendText(ctx, 'Tamam, ekleme kaydedildi! Baska bir istegininiz olursa yazabilirsiniz.');
          return 'ORDER_COLLECTING';
        }

        // Check if user wants to cancel/undo the addition
        if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { flowSubState: null, flowMetadata: null },
          });
          await this.sendText(ctx, 'Ekleme iptal edildi. Baska bir istegininiz var mi?');
          return 'ORDER_COLLECTING';
        }

        const addResult = await nluOrchestratorService.processMessage(
          tenantId, conversationId, message.id, text,
        );

        if (addResult.draftOrderId && addResult.itemsExtracted) {
          const activeOrder = await orderService.getOrder(tenantId, parentOrderId);
          if (activeOrder) {
            await prisma.conversation.update({
              where: { id: conversationId },
              data: { flowSubState: null, flowMetadata: null },
            });
            return this.handleSeamlessAddition(ctx, activeOrder, addResult.draftOrderId);
          }
        }

        if (addResult.clarificationQuestion && !addResult.weakClarification) {
          await this.sendText(ctx, addResult.clarificationQuestion);
          return 'ORDER_COLLECTING';
        }

        // No items extracted — clear sub-state and go to IDLE
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: null, flowMetadata: null },
        });
        await inboxService.updateConversationPhase(tenantId, conversationId, 'IDLE', null);
        // CATCH-ALL FIX: answer the question instead of greeting again.
        if (await this.answerConversationally(ctx, message.text || '')) return 'IDLE';
        if (addResult.clarificationQuestion) {
          await this.sendText(ctx, addResult.clarificationQuestion);
          return 'IDLE';
        }
        await this.sendGreetingOnce(ctx, 'Buyurun, baska ne yapabilirim?');
        return 'IDLE';
      }
    }

    // Handle confirm/cancel buttons from order summary
    if (buttonId === 'confirm_order') {
      return this.handleOrderConfirm(ctx);
    }
    if (buttonId === 'cancel_order') {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // A pin before the order is confirmed: kept and reused at the address step
    // (getFreshGeoCheck). The customer is told so, and an open product question
    // is repeated instead of going quiet (High Five, 12.09).
    if (message.kind === 'LOCATION') {
      const draft = await this.getDraftOrder(ctx);
      const open = draft?.items?.length
        ? null
        : await nluOrchestratorService.getOpenSpecialRequestQuestion(tenantId, conversationId);
      await this.sendText(ctx, open ? `${TEMPLATES.locationReceivedEarly}\n\n${open}` : TEMPLATES.locationReceivedEarly);
      return 'ORDER_COLLECTING';
    }

    if (message.kind !== 'TEXT' || !text) {
      // Voice messages: try transcription with Whisper
      if (message.kind === 'VOICE') {
        const voiceId = (message.payloadJson as any)?.voiceId;
        if (voiceId && whisperService.isAvailable()) {
          const transcribed = await whisperService.transcribeVoiceMessage(tenantId, voiceId);
          if (transcribed) {
            const fakeTextMessage = { ...message, kind: 'TEXT' as const, text: transcribed };
            const fakeCtx = { ...ctx, message: fakeTextMessage };
            return this.handleOrderCollecting(fakeCtx);
          }
        }
        await this.sendText(ctx, 'Sesli mesajinizi anlayamadim. Ne eklemek istediginizi yazar misiniz?');
        return 'ORDER_COLLECTING';
      }
      if (message.kind === 'IMAGE') {
        await this.sendText(ctx, 'Gorseli okuyamiyorum. Ne eklemek istediginizi yazar misiniz?');
      }
      return 'ORDER_COLLECTING';
    }

    // Cancel — only full order cancel if text is purely a cancel keyword
    // "salata iptal" gibi urun+iptal ifadelerini NLU'ya gonder (urun cikarma)
    if (this.isFullCancelIntent(text)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // Menu request — only for a short, explicit "show me the menu"
    if (this.isMenuMediaRequest(text)) {
      const sent = await this.sendMenuMedia(ctx);
      if (!sent) {
        await this.sendText(ctx, TEMPLATES.menuNotAvailable);
      }
      return 'ORDER_COLLECTING';
    }

    // Confirm order -> move to review (only if draft order exists with items)
    // 'olsun' is a confirm keyword, but "sadece peynir olsun" is a special
    // request, not a "show me the summary" confirmation: let it reach the NLU.
    // Only a REAL special request skips the shortcut: the raw regex also
    // matched "tamam sadece bu kadar" / "baska bir sey istemiyorum", which then
    // reached the NLU and could empty the cart.
    if (
      (this.matchesKeyword(text, CONFIRM_KEYWORDS) && !deriveSpecialRequest(text, null, [])) ||
      isOrderDonePhrase(text)
    ) {
      const order = await this.getActiveOrder(ctx);
      if (order && order.items.length > 0) {
        const summary = this.buildOrderSummary(order);
        await this.sendOrderConfirmButtons(ctx, summary);
        return 'ORDER_REVIEW';
      }
      // No draft order → "evet" might be answer to a clarification question
      // Fall through to NLU processing below
    }

    // Try adding more items via NLU
    const result = await nluOrchestratorService.processMessage(
      tenantId, conversationId, message.id, text,
    );

    if (result.draftOrderId) {
      // Update active order reference
      await inboxService.updateConversationPhase(
        tenantId, conversationId, 'ORDER_COLLECTING', result.draftOrderId,
      );
    }

    // A bundle with required options: the interactive list, same as IDLE. This
    // path used to send only "1. Pizza secin:" as text, and a payment question
    // in the same message was ignored.
    if (result.pendingOptionSelection && result.clarificationQuestion) {
      await this.startOptionSelection(ctx, result);
      return 'ORDER_COLLECTING';
    }

    if (result.confirmationMessage) {
      // Send summary with confirm/cancel buttons
      await this.sendOrderConfirmButtons(ctx, result.confirmationMessage);
      // Adim 9: Erken minimum sepet uyarisi
      if (result.draftOrderId) {
        await this.checkMinBasketWarning(ctx, result.draftOrderId);
      }
      // Flow-order guard: the cart was still updated, we only add the honest
      // one-liner about what comes when.
      if (!(await this.sendPreConfirmNotice(ctx, text, message.text || ''))) {
        // Product AND question in the same message: the cart is already shown
        // above, now answer the question too.
        await this.answerSideQuestion(ctx, message.text || '');
      }
      return 'ORDER_REVIEW';
    } else if (result.clarificationQuestion && !result.weakClarification) {
      await this.sendText(ctx, result.clarificationQuestion);
    } else if (!result.itemsExtracted || result.weakClarification) {
      // See handleIdle: keep-only extractions set itemsExtracted=true, so the
      // weak flag must be part of this condition or the generic
      // "tam anlayamadim" leaks out through the tail branch.
      if (await this.sendPreConfirmNotice(ctx, text, message.text || '')) {
        return 'ORDER_COLLECTING';
      }
      // Conversational answer layer (full menu + descriptions + cart).
      // The model's own clarification (when it had one) is the fallback text,
      // used only if the answer layer is unreachable.
      await this.sendSmartFallback(ctx, text, result.clarificationQuestion);
    }

    return 'ORDER_COLLECTING';
  }

  /**
   * ORDER_REVIEW: Order summary shown with buttons, waiting for confirm/cancel/edit.
   */
  private async handleOrderReview(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, conversation, payload } = ctx;
    const text = normalizeTr(message.text || '');
    const buttonId = payload.interactive?.buttonReply?.id;

    // Handle UPSELL_OFFERED sub-state
    if (conversation.flowSubState === 'UPSELL_OFFERED') {
      return this.handleUpsellResponse(ctx, text, buttonId);
    }

    // Handle confirm button ("bu kadar" / "baska bir sey istemiyorum" = that's all → confirm;
    // the old path sent it to the cancel-keyword branch and could cancel a one-item order)
    if (buttonId === 'confirm_order' || this.isConfirmIntent(text) || (message.kind === 'TEXT' && isOrderDonePhrase(text))) {
      return this.handleOrderConfirm(ctx);
    }

    // Handle cancel button
    if (buttonId === 'cancel_order') {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    if (message.kind !== 'TEXT' || !text) {
      // Never silence while the summary waits for Onayla (a pin used to get no reply).
      if (message.kind === 'VOICE') {
        const transcribed = await this.transcribeVoice(ctx);
        if (transcribed) {
          return this.handleOrderReview({ ...ctx, message: { ...message, kind: 'TEXT' as const, text: transcribed } });
        }
        await this.sendText(ctx, 'Sesli mesajinizi anlayamadim. Siparisinizi onaylamak icin asagidaki *Onayla* butonunu kullanabilirsiniz.');
      } else if (message.kind === 'LOCATION') {
        await this.sendText(ctx, TEMPLATES.locationReceivedEarly);
      } else if (message.kind === 'IMAGE') {
        await this.sendText(ctx, 'Gorseli okuyamiyorum. Siparisinizde degisiklik varsa yazabilirsiniz.');
      }
      const current = await this.getActiveOrder(ctx);
      if (message.kind !== 'VOICE' && current && current.items.length > 0) {
        await this.sendOrderConfirmButtons(ctx, this.buildOrderSummary(current));
      }
      return 'ORDER_REVIEW';
    }

    // Cancel — only full order cancel; "X iptal" goes to NLU for item removal
    if (this.isFullCancelIntent(text)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // "X iptal" / "kolayi cikar" / "ayrani kaldir" — item-level removal goes to
    // the NLU. REMOVE_KEYWORDS is included because 'cikar' and 'kaldir' used to
    // be swallowed by the edit-template dead-end below.
    if (!this.isFullCancelIntent(text) && this.matchesKeyword(text, [...CANCEL_KEYWORDS, ...REMOVE_KEYWORDS])) {
      // Save order state before NLU processing (in case NLU incorrectly removes all items)
      const orderBefore = await this.getActiveOrder(ctx);
      const itemCountBefore = orderBefore?.items?.length || 0;
      const savedItems = orderBefore?.items?.map((item: any) => ({
        menuItemId: item.menuItemId,
        menuItemName: item.menuItemName,
        qty: item.qty,
        unitPrice: item.unitPrice,
        optionsJson: item.optionsJson,
        extrasJson: item.extrasJson,
        notes: item.notes,
      })) || [];

      // Pass to NLU for item removal, then show updated summary
      const result = await nluOrchestratorService.processMessage(
        tenantId, conversationId, message.id, text,
      );

      const order = await this.getActiveOrder(ctx);
      if (order && order.items.length > 0) {
        // Item successfully removed, show updated summary
        if (result.confirmationMessage) {
          await this.sendText(ctx, result.confirmationMessage);
        }
        const summary = this.buildOrderSummary(order);
        await this.sendOrderConfirmButtons(ctx, summary);
        return 'ORDER_REVIEW';
      }

      // All items removed — check if this was intended
      if (itemCountBefore > 1) {
        // NLU incorrectly removed all items when user only wanted partial removal
        // Restore the draft order
        logger.warn(
          { tenantId, conversationId, text, itemCountBefore },
          'NLU removed all items during partial removal request — restoring order'
        );

        // Re-create the draft order with saved items
        const totalPrice = savedItems.reduce(
          (sum: number, item: any) => sum + Number(item.unitPrice) * item.qty, 0
        );
        const restoredOrder = await prisma.order.create({
          data: {
            tenantId,
            conversationId,
            customerPhone: conversation.customerPhone,
            status: 'DRAFT',
            totalPrice,
            notes: orderBefore?.notes || null,
            items: {
              // NOTE: `tenantId` and `sortOrder` are NOT columns on OrderItem
              // (see schema.prisma). Sending them made every restore throw a
              // PrismaClientValidationError, which surfaced to the customer as
              // "Bir hata olustu" AND lost the order.
              create: savedItems.map((item: any) => ({
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

        // Update conversation to point to restored order
        await inboxService.updateConversationPhase(
          tenantId, conversationId, 'ORDER_REVIEW', restoredOrder.id,
        );

        await this.sendText(ctx, 'Hangi urunu siparisinizden cikaralim? Lutfen urun adini belirtin.');
        const summary = this.buildOrderSummary(restoredOrder);
        await this.sendOrderConfirmButtons(ctx, summary);
        return 'ORDER_REVIEW';
      }

      // Single item order — removing it is legitimate full cancel
      if (result.confirmationMessage) {
        await this.sendText(ctx, result.confirmationMessage);
      }
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // Edit -> back to collecting.
    // ONLY for a bare "hayir" / "degistir" with no other content. Anything that
    // also names a product ("bi kremali mantarli makarna da ekle") must fall
    // through to the NLU below so the product actually reaches the cart —
    // this branch used to swallow those messages and the product vanished.
    const reviewWords = text.split(/\s+/).filter(Boolean);
    if (reviewWords.length <= 2 && this.matchesKeyword(text, EDIT_KEYWORDS)) {
      await this.sendText(ctx, 'Tabii, siparisinizde neyi degistirelim?');
      return 'ORDER_COLLECTING';
    }

    // Menu request — only for a short, explicit "show me the menu"
    if (this.isMenuMediaRequest(text)) {
      const sent = await this.sendMenuMedia(ctx);
      if (!sent) {
        await this.sendText(ctx, TEMPLATES.menuNotAvailable);
      }
      // Re-send current order summary with buttons
      const order = await this.getActiveOrder(ctx);
      if (order && order.items.length > 0) {
        const summary = this.buildOrderSummary(order);
        await this.sendOrderConfirmButtons(ctx, summary);
      }
      return 'ORDER_REVIEW';
    }

    // Default: treat as new product or note — pass to NLU
    const result = await nluOrchestratorService.processMessage(
      tenantId, conversationId, message.id, text,
    );

    if (result.draftOrderId) {
      await inboxService.updateConversationPhase(
        tenantId, conversationId, 'ORDER_REVIEW', result.draftOrderId,
      );
    }

    // A newly named bundle with required options: the list (and any payment question) first.
    if (result.pendingOptionSelection && result.clarificationQuestion) {
      await this.startOptionSelection(ctx, result);
      return 'ORDER_COLLECTING';
    }

    if (result.confirmationMessage) {
      // Item WAS added/changed — always show the up-to-date cart.
      await this.sendOrderConfirmButtons(ctx, result.confirmationMessage);
      if (!(await this.sendPreConfirmNotice(ctx, text, message.text || ''))) {
        // Product AND question in the same message — answer the question too.
        await this.answerSideQuestion(ctx, message.text || '');
      }
      return 'ORDER_REVIEW';
    }

    if (result.clarificationQuestion && !result.weakClarification) {
      // Send clarification, then re-show current order with buttons
      await this.sendText(ctx, result.clarificationQuestion);
      const order = await this.getActiveOrder(ctx);
      if (order && order.items.length > 0) {
        const summary = this.buildOrderSummary(order);
        await this.sendOrderConfirmButtons(ctx, summary);
      }
      return 'ORDER_REVIEW';
    }

    // Not an order action — flow-order guard first, then answer the question.
    // The confirm/cancel buttons from the previous summary stay usable, so the
    // summary is NOT re-sent on every chat turn.
    if (await this.sendPreConfirmNotice(ctx, text, message.text || '')) {
      return 'ORDER_REVIEW';
    }
    if (await this.answerConversationally(ctx, message.text || '')) {
      return 'ORDER_REVIEW';
    }
    if (result.clarificationQuestion) {
      await this.sendText(ctx, result.clarificationQuestion);
      return 'ORDER_REVIEW';
    }

    // Last resort — re-show the cart so the customer is never left in silence.
    const existingOrder = await this.getActiveOrder(ctx);
    if (existingOrder && existingOrder.items.length > 0) {
      const summary = this.buildOrderSummary(existingOrder);
      await this.sendOrderConfirmButtons(ctx, summary);
    }
    return 'ORDER_REVIEW';
  }

  /**
   * Handle order confirmation (from button or text)
   */
  private async handleOrderConfirm(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation } = ctx;

    const order = await this.getActiveOrder(ctx);
    if (!order || order.items.length === 0) {
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    // Check if this is an addition order - skip location/address
    if (order.parentOrderId) {
      const validationError = await this.validateAdditionItems(ctx, order);
      if (validationError) {
        await this.sendText(ctx, validationError);
        return 'ORDER_COLLECTING';
      }
      await this.sendPaymentButtons(ctx);
      return 'PAYMENT_METHOD_SELECTION';
    }

    // Try upsell before proceeding to address/location
    try {
      const suggestion = await upsellService.getSuggestion(
        tenantId,
        order.id,
        conversation.customerPhone,
        conversation.customerName,
      );

      if (suggestion) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            flowSubState: 'UPSELL_OFFERED',
            flowMetadata: JSON.stringify({
              upsellItemId: suggestion.itemId,
              upsellItemName: suggestion.itemName,
              upsellPrice: suggestion.price,
              upsellSource: suggestion.source,
            }),
          },
        });

        const tmpl = TEMPLATES.upsellButtons(suggestion.price);
        await whatsappService.sendInteractiveButtons(
          tenantId,
          conversationId,
          suggestion.message,
          tmpl.buttons,
        );
        return 'ORDER_REVIEW';
      }
    } catch (err) {
      logger.warn({ err }, 'Upsell check failed, continuing normal flow');
    }

    // No upsell -> proceed to delivery type selection
    return this.proceedToDeliveryTypeSelection(ctx);
  }

  /**
   * Handle customer response to upsell offer
   */
  private async handleUpsellResponse(
    ctx: FlowContext,
    text: string,
    buttonId: string | undefined,
  ): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation } = ctx;

    // Parse stored upsell metadata
    let upsellMeta: any = {};
    try {
      upsellMeta = JSON.parse(conversation.flowMetadata || '{}');
    } catch { /* ignore */ }

    const accepted = buttonId === 'upsell_accept' ||
      this.matchesKeyword(text, ['ekle', 'evet', 'tamam', 'olsun']);
    const rejected = buttonId === 'upsell_reject' ||
      this.matchesKeyword(text, ['hayir', 'istemiyorum', 'yok', 'gecen']);

    if (accepted && upsellMeta.upsellItemId) {
      // Add upsell item to order
      const order = await this.getActiveOrder(ctx);
      if (order) {
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: upsellMeta.upsellItemId,
            menuItemName: upsellMeta.upsellItemName,
            qty: 1,
            unitPrice: upsellMeta.upsellPrice,
          },
        });

        // Update order total
        const newTotal = Number(order.totalPrice) + upsellMeta.upsellPrice;
        await prisma.order.update({
          where: { id: order.id },
          data: { totalPrice: newTotal },
        });

        await this.sendText(ctx, `${upsellMeta.upsellItemName} sepete eklendi!`);

        // Log upsell event
        await upsellService.logEvent(
          tenantId, conversationId, order.id,
          upsellMeta.upsellItemId, upsellMeta.upsellItemName,
          true, upsellMeta.upsellSource || 'rule',
        );
      }
    } else if (rejected) {
      // Log rejection
      const order = await this.getActiveOrder(ctx);
      if (order && upsellMeta.upsellItemId) {
        await upsellService.logEvent(
          tenantId, conversationId, order.id,
          upsellMeta.upsellItemId, upsellMeta.upsellItemName,
          false, upsellMeta.upsellSource || 'rule',
        );
      }
    } else {
      // Unrecognized response — remind
      await this.sendText(ctx, 'Lutfen butonlardan birini secin.');
      return 'ORDER_REVIEW';
    }

    // Clear sub-state and proceed to address/location
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { flowSubState: null, flowMetadata: null },
    });

    return this.proceedToAddressFlow(ctx);
  }

  /**
   * Proceed to address/location flow after order review (and optional upsell)
   */
  // ==================== REORDER / FAVORITES ====================

  private async handleReorderRequest(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation } = ctx;

    const favorites = await reorderService.getFavorites(tenantId, conversation.customerPhone, 10);

    if (favorites.length === 0) {
      await this.sendText(ctx, TEMPLATES.noFavoritesYet);
      return 'IDLE';
    }

    const sections = reorderService.buildFavoritesListSections(favorites);

    await whatsappService.sendListMessage(
      tenantId,
      conversationId,
      TEMPLATES.favoritesListHeader(favorites.length),
      TEMPLATES.favoritesListButton,
      sections,
      TEMPLATES.favoritesListHeaderText,
    );

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { flowSubState: 'REORDER_LIST_SHOWN' },
    });

    return 'IDLE';
  }

  private async handleReorderSelection(
    ctx: FlowContext,
    listReplyId: string,
  ): Promise<ConversationPhase> {
    const { tenantId, conversationId } = ctx;
    const menuItemId = listReplyId.replace('reorder_', '');

    // Clear sub-state
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { flowSubState: null },
    });

    try {
      const result = await reorderService.addFavoriteToOrder(
        tenantId, conversationId, menuItemId, 1,
      );

      await inboxService.updateConversationPhase(
        tenantId, conversationId, 'ORDER_COLLECTING', result.orderId,
      );

      await this.sendText(ctx, TEMPLATES.orderItemAdded(result.itemName, 1));
      await this.sendText(ctx, 'Yaninda baska bir sey ister misiniz?');

      return 'ORDER_COLLECTING';
    } catch (error) {
      logger.error({ error, tenantId, menuItemId }, 'Failed to add favorite to order');
      await this.sendText(ctx, 'Bu urun su anda musait degil. Baska bir urun denemek ister misiniz?');
      return 'IDLE';
    }
  }

  /**
   * Show delivery type selection buttons (Gel Al / Paket Servis)
   */
  private async proceedToDeliveryTypeSelection(ctx: FlowContext): Promise<ConversationPhase> {
    // Sepet olusmadan verilen kurye talimati ("cocuk cikip alacak") onaylanan
    // siparise burada yazilir; tekrar cagrilirsa bir sey yapmaz (liste temizlenir).
    const onaylanan = await this.getActiveOrder(ctx);
    if (onaylanan) await this.applyPreDraftDeliveryNotes(ctx, onaylanan);
    await whatsappService.sendInteractiveButtons(
      ctx.tenantId,
      ctx.conversationId,
      'Siparişinizi nasıl almak istersiniz?',
      [
        { id: 'delivery_type_pickup', title: 'Gel Al' },
        { id: 'delivery_type_delivery', title: 'Paket Servis' },
      ],
    );
    return 'DELIVERY_TYPE_SELECTION';
  }

  /**
   * DELIVERY_TYPE_SELECTION: Customer chooses Gel Al (pickup) or Paket Servis (delivery)
   */
  private async handleDeliveryTypeSelection(ctx: FlowContext): Promise<ConversationPhase> {
    const { message, payload } = ctx;
    const raw = (message.text || '').trim();
    const text = normalizeTr(raw);
    const buttonId = payload.interactive?.buttonReply?.id;

    const order = await this.getActiveOrder(ctx);
    if (!order || order.items.length === 0) {
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    // Answer to our "X siparisinize eklensin mi?" question
    const addAnswer = await this.interceptMidFlowAddAnswer(ctx, 'DELIVERY_TYPE_SELECTION');
    if (addAnswer) return addAnswer;

    // "Yanlis oldu" right after a cart change at this step: undo it (never the NLU).
    const undone = await this.interceptMidFlowUndo(ctx, 'DELIVERY_TYPE_SELECTION');
    if (undone) return undone;

    // Cancel: short phrases plus everyday "iptal edin" / "vazgectim" wording.
    // Never a bare word-prefix match: that cancelled the whole order for any
    // text containing "istemiyorum" or a word starting "sil".
    if (await this.isStepCancelIntent(ctx, raw)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    const answered = await this.tryAnswerPaymentQuestion(ctx, raw, 'DELIVERY_TYPE_SELECTION');
    if (answered) return answered;

    const isPickup = buttonId === 'delivery_type_pickup' || this.isPickupIntent(text);
    if (isPickup) {
      return this.switchToPickup(ctx, order);
    }

    // The customer answered with an address instead of pressing "Paket Servis".
    // Park it and continue to the address step: the pin stays the preferred
    // option there, with a one-tap "continue with this address".
    if (!buttonId && message.kind === 'TEXT' && raw) {
      const cls = classifyAddressText(raw);
      if ((cls.kind === 'full' || cls.kind === 'landmark') && !hasAddSignal(raw)) {
        await prisma.order.update({
          where: { id: order.id },
          data: { deliveryType: 'DELIVERY', deliveryAddress: this.joinParked(order.deliveryAddress, raw) },
        });
        return this.proceedToAddressFlow(ctx);
      }
      if (cls.kind === 'directions') {
        await this.appendOrderNote(order, `Teslimat notu: ${raw}`);
        // "kapiya getirin" / "kapiya birakin" is also the delivery choice itself.
        if (this.isDeliveryIntent(text) || foldTr(raw).includes('kapiya')) {
          await prisma.order.update({ where: { id: order.id }, data: { deliveryType: 'DELIVERY' } });
          await this.sendText(ctx, 'Teslimat notunuzu aldim.');
          return this.proceedToAddressFlow(ctx);
        }
        await this.sendText(ctx, 'Teslimat notunuzu aldim.');
        return this.proceedToDeliveryTypeSelection(ctx);
      }
    }

    const isDelivery = buttonId === 'delivery_type_delivery' || this.isDeliveryIntent(text);
    if (isDelivery) {
      // Paket Servis selected
      await prisma.order.update({
        where: { id: order.id },
        data: { deliveryType: 'DELIVERY' },
      });
      // Continue to address flow
      return this.proceedToAddressFlow(ctx);
    }

    // Mid-flow cart edit ("bir de kola ekle") — explicit edits only
    if (text) {
      const mid = await this.tryMidFlowAddition(ctx, 'DELIVERY_TYPE_SELECTION');
      if (mid.nextPhase) return mid.nextPhase;
      if (mid.handled) {
        return this.proceedToDeliveryTypeSelection(ctx);
      }
    }

    // Could not understand — re-send buttons
    await whatsappService.sendInteractiveButtons(
      ctx.tenantId,
      ctx.conversationId,
      'Lutfen "Gel Al" veya "Paket Servis" seceneklerinden birini secin:',
      [
        { id: 'delivery_type_pickup', title: 'Gel Al' },
        { id: 'delivery_type_delivery', title: 'Paket Servis' },
      ],
    );
    return 'DELIVERY_TYPE_SELECTION';
  }

  /**
   * Check if text indicates pickup intent
   */
  private isPickupIntent(text: string): boolean {
    const pickupKeywords = ['gel al', 'gelal', 'gelip', 'kendim', 'yerinde', 'gel alayim', 'geliyorum', 'gelin al'];
    return pickupKeywords.some((kw) => text.includes(kw));
  }

  /**
   * Check if text indicates delivery intent
   */
  private isDeliveryIntent(text: string): boolean {
    const deliveryKeywords = ['paket', 'adrese', 'eve', 'teslimat', 'getirin', 'gonderin', 'kurye'];
    return deliveryKeywords.some((kw) => text.includes(kw));
  }

  private async proceedToAddressFlow(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId } = ctx;

    // A pin the customer already sent for this order (before Onayla, or while
    // the old gate held the chat) is used — never asked again. In production
    // the customer sent it, heard "we will use it at the delivery step", and was
    // then asked for it anyway (High Five, 12.09).
    const pinGeo = await this.getFreshGeoCheck(ctx);
    if (pinGeo?.isWithinServiceArea) {
      await this.sendText(ctx, TEMPLATES.pinReused);
      return this.processGeoResult(ctx, pinGeo);
    }
    if (pinGeo && !pinGeo.isWithinServiceArea) {
      // Same three ways forward as an out-of-area pin at this step.
      return this.sendOutOfAreaOptions(ctx, pinGeo);
    }

    // An address the customer typed earlier is offered back — never asked twice.
    const order = await this.getActiveOrder(ctx);
    const parked: string | null = order?.deliveryAddress || null;

    // Check for saved addresses before requesting location
    if (await this.sendSavedAddressList(ctx, parked)) {
      return 'ADDRESS_SELECTION';
    }

    if (parked) {
      await whatsappService.sendLocationRequest(
        tenantId,
        conversationId,
        TEMPLATES.locationRequestWithParked(parked),
      );
      const tmpl = TEMPLATES.typedAddressContinueButtons;
      await whatsappService.sendInteractiveButtons(tenantId, conversationId, tmpl.body, tmpl.buttons);
      return 'LOCATION_REQUEST';
    }

    await whatsappService.sendLocationRequest(
      tenantId,
      conversationId,
      TEMPLATES.locationRequest,
    );
    return 'LOCATION_REQUEST';
  }

  /**
   * LOCATION_REQUEST: waiting for a location pin — or a written address.
   *
   * The pin is preferred but not mandatory: a customer who does not want to
   * share one continues with a written address that staff verifies. Free text
   * here is classified locally; only an explicit cart edit reaches the NLU.
   * WHY: "Hayalim kent e gidecek", "Yanlis oldu" and "Size cok yakin nasil
   * yani" each added a 2'li Pizza Menu in production, and the only way out of
   * an out-of-area pin was "farkli konum gonderin veya iptal yazin".
   */
  private async handleLocationRequest(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, payload } = ctx;

    // Location message received
    if (message.kind === 'LOCATION' && payload.location?.latitude && payload.location?.longitude) {
      return this.processLocationPin(ctx);
    }

    const raw = (message.text || '').trim();
    const text = normalizeTr(raw);
    const buttonId = payload.interactive?.buttonReply?.id;

    // 1. Buttons first: a button reply arrives as TEXT whose text is the title.
    const addAnswer = await this.interceptMidFlowAddAnswer(ctx, 'LOCATION_REQUEST');
    if (addAnswer) return addAnswer;
    if (buttonId === 'oos_pickup' || buttonId === 'delivery_type_pickup') {
      const order = await this.getActiveOrder(ctx);
      if (!order || order.items.length === 0) {
        await this.sendText(ctx, TEMPLATES.orderEmpty);
        return 'IDLE';
      }
      return this.switchToPickup(ctx, order, { fromOutOfArea: buttonId === 'oos_pickup' });
    }
    if (buttonId === 'oos_new_location') {
      await whatsappService.sendLocationRequest(tenantId, conversationId, TEMPLATES.locationRequest);
      return 'LOCATION_REQUEST';
    }
    if (buttonId === 'oos_type_address' || buttonId === 'use_typed_address') {
      const order = await this.getActiveOrder(ctx);
      if (order?.deliveryAddress) {
        return this.acceptTypedAddress(ctx, order.deliveryAddress, {
          outOfAreaGeo: await this.getFreshOutOfAreaGeo(ctx),
        });
      }
      await this.sendText(ctx, TEMPLATES.typedAddressPrompt);
      return 'LOCATION_REQUEST';
    }

    // 2. Other message kinds
    if (message.kind === 'IMAGE') {
      await this.sendText(ctx, 'Gorseli okuyamiyorum. Konumunuzu paylasabilir ya da acik adresinizi yazabilirsiniz.');
      return 'LOCATION_REQUEST';
    }
    if (message.kind === 'VOICE') {
      const transcribed = await this.transcribeVoice(ctx);
      if (transcribed) {
        return this.handleLocationRequest({ ...ctx, message: { ...message, kind: 'TEXT' as const, text: transcribed } });
      }
      await this.sendText(ctx, 'Sesli mesajinizi anlayamadim. Konumunuzu paylasabilir ya da acik adresinizi yazabilirsiniz.');
      return 'LOCATION_REQUEST';
    }
    if (message.kind !== 'TEXT' || !raw) {
      await this.sendText(ctx, TEMPLATES.reminderSendLocation);
      return 'LOCATION_REQUEST';
    }

    // 3. "Yanlis oldu" / "geri al": undo the last cart change — before cancel and any NLU.
    const undone = await this.interceptMidFlowUndo(ctx, 'LOCATION_REQUEST');
    if (undone) return undone;

    // 4. Cancel ("iptal edin", "vazgectim"). Must run before the written-address
    // catch-all below, or "siparisi iptal etmek istiyorum" becomes the address.
    // "konum atmak istemiyorum" is not a cancel.
    if (await this.isStepCancelIntent(ctx, raw)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    const order = await this.getActiveOrder(ctx);
    if (!order || order.items.length === 0) {
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    // 5. Explicit switch to pickup. Not isPickupIntent: its 'gelip' also matches
    // directions like "cocuk gelip alacak".
    const folded = foldTr(raw);
    if (['gel al', 'gelal', 'gelip alirim', 'gelip alacagim', 'kendim alirim', 'gel alayim'].some((p) => folded.includes(p))) {
      return this.switchToPickup(ctx, order);
    }

    // 6. Payment question ("IBAN ve odeyecegim miktari yazar misiniz")
    const answered = await this.tryAnswerPaymentQuestion(ctx, raw, 'LOCATION_REQUEST');
    if (answered) return answered;

    // 7. The customer does not want to (or cannot) share a pin
    if (isLocationRefusal(raw)) {
      await this.sendText(ctx, TEMPLATES.typedAddressPrompt);
      return 'LOCATION_REQUEST';
    }

    // 8. Complaint about an out-of-area pin ("size cok yakin nasil yani")
    const oosGeo = await this.getFreshOutOfAreaGeo(ctx);
    const cls = classifyAddressText(raw);
    if (oosGeo && cls.kind === 'none' && isAreaComplaint(raw)) {
      return this.sendOutOfAreaComplaint(ctx, oosGeo);
    }

    // 9. Explicit cart edit ("bir de kola ekle")
    const mid = await this.tryMidFlowAddition(ctx, 'LOCATION_REQUEST');
    if (mid.nextPhase) return mid.nextPhase;
    if (mid.handled) {
      await this.sendText(ctx, TEMPLATES.reminderSendLocation);
      return 'LOCATION_REQUEST';
    }

    // 10. A written address / delivery directions
    if (cls.kind === 'full' || cls.kind === 'landmark') {
      return this.acceptTypedAddress(ctx, raw, { outOfAreaGeo: oosGeo });
    }
    if (cls.kind === 'directions') {
      await this.appendOrderNote(order, `Teslimat notu: ${raw}`);
      await this.sendText(ctx, TEMPLATES.deliveryNoteSaved);
      return 'LOCATION_REQUEST';
    }
    // Everything else that reads like an address. The location request itself
    // invites a written address, so this IS the reply to our question: small-
    // town addresses carry no street keyword ("Kepez 25 kat 2", "Dilaverler
    // koyu 12") and used to get the same reminder forever.
    const askedForAddress = await this.hasAskedForAddress(ctx, order);
    if (cls.kind === 'vague' || (cls.kind === 'none' && this.isPlausibleAddressReply(raw))) {
      const evidence =
        cls.kind === 'none' && (/\d/.test(raw) || cls.hasDetail || foldedWords(raw).length >= 3);
      if (askedForAddress || evidence) {
        return this.acceptTypedAddress(ctx, raw, { outOfAreaGeo: oosGeo });
      }
      // Ask ONCE for the missing detail, but never block: "Bu adresle devam"
      // works as is, and the next reply is accepted (the ask carries the marker).
      await prisma.order.update({
        where: { id: order.id },
        data: { deliveryAddress: this.joinParked(order.deliveryAddress, raw) },
      });
      await whatsappService.sendInteractiveButtons(
        tenantId,
        conversationId,
        TEMPLATES.typedAddressDetailAsk(raw),
        TEMPLATES.typedAddressContinueButtons.buttons,
      );
      return 'LOCATION_REQUEST';
    }

    // 11. Fallback: always offer both ways forward, never "written address not accepted".
    if (oosGeo) {
      return this.sendOutOfAreaOptions(ctx, oosGeo);
    }
    await this.sendText(ctx, TEMPLATES.reminderSendLocation);
    return 'LOCATION_REQUEST';
  }

  /**
   * PAYMENT_METHOD_SELECTION: Buttons sent, waiting for Nakit/Kart selection.
   */
  private async handlePaymentMethodSelection(ctx: FlowContext): Promise<ConversationPhase> {
    const { message, payload } = ctx;
    const raw = (message.text || '').trim();
    const text = normalizeTr(raw);

    // Interactive button reply
    const buttonId = payload.interactive?.buttonReply?.id;

    const addAnswer = await this.interceptMidFlowAddAnswer(ctx, 'PAYMENT_METHOD_SELECTION');
    if (addAnswer) return addAnswer;

    const undone = await this.interceptMidFlowUndo(ctx, 'PAYMENT_METHOD_SELECTION');
    if (undone) return undone;

    // "kapida kart gecer mi?" is a question. It used to submit a CASH order
    // through the 'kapida' cash keyword.
    if (!buttonId) {
      const answered = await this.tryAnswerPaymentQuestion(ctx, raw, 'PAYMENT_METHOD_SELECTION');
      if (answered) return answered;
    }

    // "kart kapida" / "kart kasada" is card at the door, not cash.
    if (
      buttonId === 'pay_card_door' ||
      (!buttonId && this.matchesKeyword(text, CARD_KEYWORDS) && this.matchesKeyword(text, ['kapida', 'kasada']))
    ) {
      return this.handleCardDoorPayment(ctx);
    }

    if (buttonId === 'pay_cash' || this.matchesKeyword(text, CASH_KEYWORDS)) {
      return this.handleCashPayment(ctx);
    }

    if (buttonId === 'pay_card_online' || buttonId === 'pay_card' || this.matchesKeyword(text, CARD_KEYWORDS)) {
      return this.handleCardPayment(ctx);
    }

    // Cancel: short phrases plus everyday "iptal edin" / "vazgectim"
    if (await this.isStepCancelIntent(ctx, raw)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // Mid-flow cart edit before paying — explicit edits only
    if (text) {
      const mid = await this.tryMidFlowAddition(ctx, 'PAYMENT_METHOD_SELECTION');
      if (mid.nextPhase) return mid.nextPhase;
      if (mid.handled) {
        await this.sendPaymentButtons(ctx);
        return 'PAYMENT_METHOD_SELECTION';
      }
    }

    // Re-send payment buttons
    await this.sendPaymentButtons(ctx);
    return 'PAYMENT_METHOD_SELECTION';
  }

  /**
   * PAYMENT_PENDING: Waiting for iyzico callback or user action.
   * Adim 11: Odeme zaman asimi kontrolu eklendi
   */
  private async handlePaymentPending(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, conversation } = ctx;
    const text = normalizeTr(message.text || '');

    const answered = await this.tryAnswerPaymentQuestion(ctx, message.text || '', 'PAYMENT_PENDING');
    if (answered) return answered;

    // Switch to cash
    if (this.matchesKeyword(text, CASH_KEYWORDS)) {
      return this.handleCashPayment(ctx);
    }

    // Retry card payment
    if (this.matchesKeyword(text, CARD_KEYWORDS)) {
      return this.handleCardPayment(ctx);
    }

    // Cancel: short phrases plus everyday "iptal edin" / "vazgectim"
    if (await this.isStepCancelIntent(ctx, message.text || '')) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // Check for payment link and timeout
    const pendingPayment = conversation.activeOrderId
      ? await orderPaymentService.getPendingPayment(tenantId, conversation.activeOrderId)
      : null;

    if (pendingPayment?.checkoutFormUrl) {
      // Adim 11: Odeme linki suresi dolmus mu kontrol et
      const paymentCreatedAt = pendingPayment.createdAt ? new Date(pendingPayment.createdAt).getTime() : 0;
      const now = Date.now();

      if (paymentCreatedAt && (now - paymentCreatedAt) > PAYMENT_LINK_EXPIRY_MS) {
        // Odeme linki suresi dolmus - tekrar secim yap
        await this.sendText(ctx, 'Odeme linkinin suresi doldu. Lutfen odeme yontemini tekrar secin.');
        await this.sendPaymentButtons(ctx);
        return 'PAYMENT_METHOD_SELECTION';
      }

      await this.sendText(ctx, TEMPLATES.reminderPayment(pendingPayment.checkoutFormUrl));
    } else {
      await this.sendPaymentButtons(ctx);
      return 'PAYMENT_METHOD_SELECTION';
    }

    return 'PAYMENT_PENDING';
  }

  /**
   * ORDER_CONFIRMED: Order done. New message starts fresh.
   */
  private async handleOrderConfirmed(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation, message, payload } = ctx;
    const subState = conversation.flowSubState;

    // Handle survey sub-states
    if (subState === 'SURVEY_RATING') {
      return this.handleSurveyRating(ctx);
    }
    if (subState === 'SURVEY_COMMENT') {
      return this.handleSurveyComment(ctx);
    }
    if (subState === 'BROADCAST_OPT_IN_ASKED') {
      return this.handleBroadcastOptInResponse(ctx);
    }

    // Payment change pending: customer sent a payment link, waiting for iyzico callback
    if (subState === 'PAYMENT_CHANGE_PENDING') {
      const text = normalizeTr(message.text || '');
      // Cancel payment change — revert to cash
      if (this.matchesKeyword(text, CANCEL_KEYWORDS) || this.matchesKeyword(text, CASH_KEYWORDS)) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: null },
        });
        await this.sendText(ctx, 'Online odeme iptal edildi. Mevcut odeme yonteminiz gecerlidir.');
        return 'ORDER_CONFIRMED';
      }
      // Remind about payment link
      const orderId = conversation.activeOrderId;
      if (orderId) {
        const pendingPayment = await orderPaymentService.getPendingPayment(tenantId, orderId);
        if (pendingPayment?.checkoutFormUrl) {
          await this.sendText(ctx, TEMPLATES.reminderPayment(pendingPayment.checkoutFormUrl));
          return 'ORDER_CONFIRMED';
        }
      }
      // No pending payment found — clear sub-state
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { flowSubState: null },
      });
    }

    const text = normalizeTr(message.text || '');

    // If customer tries to cancel — check order status first
    if (text && this.isFullCancelIntent(text)) {
      const order = conversation.activeOrderId
        ? await prisma.order.findFirst({
            where: { id: conversation.activeOrderId, tenantId },
          })
        : null;

      if (order) {
        const cancelableStatuses = ['PENDING_CONFIRMATION'];
        if (cancelableStatuses.includes(order.status)) {
          // Order is still waiting for restaurant — allow cancel
          await prisma.order.update({
            where: { id: order.id },
            data: { status: 'CANCELLED' },
          });
          await inboxService.updateConversationPhase(tenantId, conversationId, 'IDLE', null);
          await this.sendText(ctx, 'Siparisiniz iptal edildi.\nYeni siparis icin istediginiz urunleri yazabilirsiniz.');
          return 'IDLE';
        } else {
          // Order already confirmed/preparing — block cancel
          await this.sendText(
            ctx,
            'Siparisiniz hazirlaniyor. Bu asamada iptal yapilamaz.\nYardim icin *"destek"* yazabilirsiniz.',
          );
          return 'ORDER_CONFIRMED';
        }
      }
    }

    // Otherwise reset to IDLE and process as new order / greeting
    await inboxService.updateConversationPhase(tenantId, conversationId, 'IDLE', null);
    ctx.conversation.phase = 'IDLE';
    return this.handleIdle(ctx);
  }

  /**
   * Handle survey rating response (1-5 stars)
   */
  private async handleSurveyRating(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation, payload } = ctx;
    const text = normalizeTr(ctx.message.text || '');
    const buttonId = payload.interactive?.buttonReply?.id;

    // Parse rating from button or text
    let rating: number | null = null;

    if (buttonId?.startsWith('survey_')) {
      rating = parseInt(buttonId.replace('survey_', ''), 10);
    } else if (text) {
      // Try to parse number from text (1-5)
      const num = parseInt(text, 10);
      if (num >= 1 && num <= 5) {
        rating = num;
      }
    }

    if (!rating) {
      // Unrecognized — remind
      await this.sendText(ctx, 'Lutfen 1-5 arasi bir puan verin veya butonlardan secim yapin.');
      return 'ORDER_CONFIRMED';
    }

    // Parse survey metadata
    let surveyMeta: any = {};
    try {
      surveyMeta = JSON.parse(conversation.flowMetadata || '{}');
    } catch { /* ignore */ }

    // Create survey record
    const survey = await surveyService.createSurvey(
      tenantId,
      conversationId,
      surveyMeta.surveyOrderId || '',
      conversation.customerPhone,
      conversation.customerName,
      rating,
    );

    if (rating <= 2) {
      // Bad rating — ask for comment
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          flowSubState: 'SURVEY_COMMENT',
          flowMetadata: JSON.stringify({ ...surveyMeta, surveyId: survey.id }),
        },
      });
      await this.sendText(ctx, TEMPLATES.surveyAskComment);
      return 'ORDER_CONFIRMED';
    }

    // Good/neutral rating — thank and maybe ask broadcast opt-in
    if (rating >= 4) {
      await this.sendText(ctx, TEMPLATES.surveyThanksGood);
    } else {
      await this.sendText(ctx, TEMPLATES.surveyThanksNeutral);
    }

    return this.tryAskBroadcastOptIn(ctx);
  }

  /**
   * Handle survey comment (free text after bad rating)
   */
  private async handleSurveyComment(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation } = ctx;
    const text = (ctx.message.text || '').trim();

    if (!text) {
      await this.sendText(ctx, 'Lutfen yazili mesaj gonderin.');
      return 'ORDER_CONFIRMED';
    }

    // Parse survey metadata
    let surveyMeta: any = {};
    try {
      surveyMeta = JSON.parse(conversation.flowMetadata || '{}');
    } catch { /* ignore */ }

    // Save comment
    if (surveyMeta.surveyId) {
      await surveyService.addComment(surveyMeta.surveyId, text);
    }

    // Thank and maybe ask broadcast opt-in
    await this.sendText(ctx, TEMPLATES.surveyThanksBad);

    return this.tryAskBroadcastOptIn(ctx);
  }

  // ==================== BROADCAST OPT-IN ====================

  /**
   * After survey completes, ask for broadcast opt-in if eligible.
   * If not eligible, just clear sub-state and stay in ORDER_CONFIRMED.
   */
  private async tryAskBroadcastOptIn(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation } = ctx;

    try {
      const { broadcastService } = await import('./broadcast.service');
      const shouldAsk = await broadcastService.askOptIn(
        tenantId, conversationId, conversation.customerPhone,
      );

      if (shouldAsk) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: 'BROADCAST_OPT_IN_ASKED', flowMetadata: null },
        });

        await whatsappService.sendInteractiveButtons(
          tenantId,
          conversationId,
          TEMPLATES.broadcastOptInAsk,
          TEMPLATES.broadcastOptInButtons.buttons,
        );
        return 'ORDER_CONFIRMED';
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to ask broadcast opt-in');
    }

    // Clear sub-state
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { flowSubState: null, flowMetadata: null },
    });
    return 'ORDER_CONFIRMED';
  }

  private async handleBroadcastOptInResponse(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation, payload } = ctx;
    const text = normalizeTr(ctx.message.text || '');
    const buttonId = payload.interactive?.buttonReply?.id;

    const accepted = buttonId === 'broadcast_yes' || this.matchesKeyword(text, CONFIRM_KEYWORDS);
    const rejected = buttonId === 'broadcast_no' || this.matchesKeyword(text, CANCEL_KEYWORDS);

    if (accepted || rejected) {
      try {
        const { broadcastService } = await import('./broadcast.service');
        await broadcastService.handleOptInResponse(tenantId, conversation.customerPhone, accepted);
      } catch (err) {
        logger.warn({ err }, 'Broadcast opt-in response failed');
      }

      if (accepted) {
        await this.sendText(ctx, TEMPLATES.broadcastOptInConfirmed);
      } else {
        await this.sendText(ctx, TEMPLATES.broadcastOptOutConfirmed);
      }

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { flowSubState: null, flowMetadata: null },
      });
      return 'ORDER_CONFIRMED';
    }

    // Unrecognized response — remind
    await this.sendText(ctx, 'Lutfen butonlardan birini secin.');
    return 'ORDER_CONFIRMED';
  }

  /**
   * AGENT_HANDOFF: Agent handoff state. Allow user to restart by sending a new message.
   * In a real scenario an agent would resolve this; for chatbot testing we auto-recover.
   */
  private async handleAgentHandoff(ctx: FlowContext): Promise<ConversationPhase> {
    const text = normalizeTr(ctx.message.text || '');

    // Any text message resets to IDLE and gets processed as a new interaction
    if (ctx.message.kind === 'TEXT' && text) {
      logger.info(
        { tenantId: ctx.tenantId, conversationId: ctx.conversationId },
        'Recovering from AGENT_HANDOFF - resetting to IDLE',
      );
      // Reset phase to IDLE first
      await inboxService.updateConversationPhase(ctx.tenantId, ctx.conversationId, 'IDLE', null);
      ctx.conversation.phase = 'IDLE';
      // Process the message as if we're in IDLE
      return this.handleIdle(ctx);
    }

    return 'AGENT_HANDOFF';
  }

  // ==================== PAYMENT HELPERS ====================

  private async handleCashPayment(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation } = ctx;
    const orderId = conversation.activeOrderId;

    if (!orderId) {
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    // Check if pickup order for correct payment location text
    const order = await this.getActiveOrder(ctx);
    const isPickup = order?.deliveryType === 'PICKUP';

    // Record cash payment
    await orderPaymentService.recordCashPayment(tenantId, orderId, conversationId);

    // Move to PENDING_CONFIRMATION (waiting for restaurant approval)
    const pendingOrder = await orderService.setPendingConfirmation(tenantId, orderId, {
      paymentMethod: 'CASH',
    });

    const locationText = isPickup ? 'Kasada nakit' : 'Kapida nakit';
    await this.sendText(
      ctx,
      `*Siparisiniz alindi!*\n\n` +
      `Siparis No: #${pendingOrder.orderNumber || 0}\n` +
      `Odeme: ${locationText}\n` +
      `Restoran onayiniz bekleniyor...`,
    );
    await inboxService.updateConversationPhase(tenantId, conversationId, 'ORDER_CONFIRMED', null);
    return 'ORDER_CONFIRMED';
  }

  private async handleCardDoorPayment(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation } = ctx;
    const orderId = conversation.activeOrderId;

    if (!orderId) {
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    // Check if pickup order for correct payment location text
    const order = await this.getActiveOrder(ctx);
    const isPickup = order?.deliveryType === 'PICKUP';

    // Record as cash-like payment (no online processing needed)
    await orderPaymentService.recordCashPayment(tenantId, orderId, conversationId);

    const pendingOrder = await orderService.setPendingConfirmation(tenantId, orderId, {
      paymentMethod: 'CREDIT_CARD',
    });

    const locationText = isPickup ? 'Kasada kredi karti' : 'Kapida kredi karti';
    await this.sendText(
      ctx,
      `*Siparisiniz alindi!*\n\n` +
      `Siparis No: #${pendingOrder.orderNumber || 0}\n` +
      `Odeme: ${locationText}\n` +
      `Restoran onayiniz bekleniyor...`,
    );
    await inboxService.updateConversationPhase(tenantId, conversationId, 'ORDER_CONFIRMED', null);
    return 'ORDER_CONFIRMED';
  }

  private async handleCardPayment(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation } = ctx;
    const orderId = conversation.activeOrderId;

    if (!orderId) {
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    try {
      const payment = await orderPaymentService.initiateCardPayment(
        tenantId,
        orderId,
        conversationId,
        conversation.customerPhone,
      );

      if (payment.checkoutFormUrl) {
        await this.sendText(ctx, TEMPLATES.paymentLinkSent(payment.checkoutFormUrl));
        return 'PAYMENT_PENDING';
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errMsg, tenantId, orderId }, 'Failed to create payment link');
      await this.sendText(ctx, `Odeme linki olusturulamadi: ${errMsg}\nNakit odemek icin "nakit" yazin.`);
      return 'PAYMENT_METHOD_SELECTION';
    }

    await this.sendText(ctx, 'Odeme linki olusturulamadi. Nakit odemek icin "nakit" yazin.');
    return 'PAYMENT_METHOD_SELECTION';
  }

  // ==================== ADDRESS COLLECTION (Adim 4b) ====================

  /**
   * ADDRESS_COLLECTION: Customer types their delivery address, then confirms.
   * Sub-state: if Order.deliveryAddress is null → waiting for address text,
   *            if set → waiting for confirmation (evet/hayir).
   */
  private async handleAddressCollection(ctx: FlowContext): Promise<ConversationPhase> {
    const { message, payload } = ctx;
    const raw = (message.text || '').trim();
    const text = normalizeTr(raw);
    const buttonId = payload.interactive?.buttonReply?.id;

    // Cancel at any point: a typed address such as "Silahtar Sok. No 4" used to
    // cancel the order via the 'sil' keyword, and "iptal edin" was later saved
    // as the address — isStepCancelIntent handles both.
    if (text && (await this.isStepCancelIntent(ctx, raw))) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    const order = await this.getActiveOrder(ctx);
    if (!order) {
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    // Must run before the address capture below, or the question becomes the address.
    const answered = await this.tryAnswerPaymentQuestion(ctx, raw, 'ADDRESS_COLLECTION');
    if (answered) return answered;

    // A pin at this step: the geo check wins over a written-address flag.
    if (message.kind === 'LOCATION' && payload.location?.latitude && payload.location?.longitude) {
      if (this.isTypedAddressOrder(order)) {
        await prisma.order.update({
          where: { id: order.id },
          data: { notes: this.stripTypedAddressNote(order.notes) },
        });
      }
      return this.processLocationPin(ctx);
    }

    if (!order.deliveryAddress) {
      // --- Sub-state: waiting for address text ---
      if (message.kind !== 'TEXT' || !text) {
        await this.sendText(ctx, 'Lutfen teslimat adresinizi metin olarak yazin.');
        return 'ADDRESS_COLLECTION';
      }
      if (isUndoLastChangeIntent(raw) === 'undo') {
        const undone = await this.handleMidFlowUndo(ctx, 'ADDRESS_COLLECTION', 'undo');
        if (undone) return undone;
      }
      if (classifyAddressText(raw).kind === 'directions') {
        await this.appendOrderNote(order, `Teslimat notu: ${raw}`);
        await this.sendText(ctx, `Teslimat notunuzu aldim.\n\n${TEMPLATES.addressRequest}`);
        return 'ADDRESS_COLLECTION';
      }
      // "tamam yaziyorum", "bir saniye", a question: the address is still coming.
      if (!this.isPlausibleAddressReply(raw)) {
        await this.sendText(ctx, TEMPLATES.addressRequest);
        return 'ADDRESS_COLLECTION';
      }
      const address = raw.substring(0, 400);
      await prisma.order.update({
        where: { id: order.id },
        data: { deliveryAddress: address },
      });

      // Ask for confirmation with buttons
      await this.sendText(ctx, TEMPLATES.addressConfirmation(address));
      const tmpl = TEMPLATES.addressConfirmButtons;
      await whatsappService.sendInteractiveButtons(
        ctx.tenantId, ctx.conversationId, tmpl.body, tmpl.buttons,
      );
      return 'ADDRESS_COLLECTION';
    } else {
      // --- Sub-state: waiting for confirmation (button or text) ---
      // Not the loose keyword match: "tamam ama daire 5" is a correction. But
      // "tamam dogru", "adres dogru", "Tamamdir" are a yes — isConfirmIntent alone
      // (only 'i' folded) missed them and the free-text branch below appended
      // "tamam dogru" to the address.
      if (
        buttonId === 'address_confirm' ||
        (!buttonId && (this.isConfirmIntent(deaccentTr(raw)) || isAddressConfirmReply(raw)))
      ) {
        if (this.isTypedAddressOrder(order)) {
          // A written address has no coordinates/store, which a SavedAddress
          // requires — skip the save prompt and go straight to payment.
          await prisma.conversation.update({
            where: { id: ctx.conversationId },
            data: { flowSubState: null },
          });
          await this.sendText(ctx, 'Adresinizi aldik. Simdi odeme yontemini secelim.');
          await this.sendPaymentButtons(ctx);
          return 'PAYMENT_METHOD_SELECTION';
        }
        // Address confirmed → ask if they want to save it
        await prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: { flowSubState: 'WAITING_SAVE_CONFIRM' },
        });
        const saveTmpl = TEMPLATES.askSaveAddressButtons;
        await whatsappService.sendInteractiveButtons(
          ctx.tenantId, ctx.conversationId, saveTmpl.body, saveTmpl.buttons,
        );
        return 'ADDRESS_SAVE_PROMPT';
      }

      if (
        buttonId === 'address_retry' ||
        this.matchesKeyword(text, EDIT_KEYWORDS) ||
        (!buttonId && isAddressRejectReply(raw))
      ) {
        // User wants to re-enter address
        await prisma.order.update({
          where: { id: order.id },
          data: { deliveryAddress: null },
        });
        await this.sendText(ctx, TEMPLATES.addressRetry);
        return 'ADDRESS_COLLECTION';
      }

      // Free text while the confirmation buttons are open: a delivery note, an
      // undo, or more address detail ("B blok daire 4") — never ignored.
      if (message.kind === 'TEXT' && raw && !buttonId && !textHasQuestionSignal(raw)) {
        if (isUndoLastChangeIntent(raw) === 'undo') {
          const undone = await this.handleMidFlowUndo(ctx, 'ADDRESS_COLLECTION', 'undo');
          if (undone) return undone;
        }
        const tmpl = TEMPLATES.addressConfirmButtons;
        if (classifyAddressText(raw).kind === 'directions') {
          await this.appendOrderNote(order, `Teslimat notu: ${raw}`);
          await this.sendText(ctx, 'Teslimat notunuzu aldim.');
          await whatsappService.sendInteractiveButtons(ctx.tenantId, ctx.conversationId, tmpl.body, tmpl.buttons);
          return 'ADDRESS_COLLECTION';
        }
        // Only real detail extends the address: a number, a street / site /
        // block word, or a longer description. A stored non-address reply
        // ("tamam yaziyorum") is replaced instead of extended.
        const detailCls = classifyAddressText(raw);
        const hasDetail =
          /\d/.test(raw) || detailCls.kind !== 'none' || detailCls.hasDetail || foldedWords(raw).length >= 3;
        if (hasDetail && !this.isChatter(raw) && !isAddressWaitReply(raw)) {
          const base = this.isPlausibleAddressReply(order.deliveryAddress || '') ? order.deliveryAddress : null;
          const updated = this.joinParked(base, raw);
          await prisma.order.update({ where: { id: order.id }, data: { deliveryAddress: updated } });
          await this.sendText(ctx, TEMPLATES.addressConfirmation(updated));
          await whatsappService.sendInteractiveButtons(ctx.tenantId, ctx.conversationId, tmpl.body, tmpl.buttons);
          return 'ADDRESS_COLLECTION';
        }
      }

      // Unrecognized → re-send buttons
      const tmpl = TEMPLATES.addressConfirmButtons;
      await whatsappService.sendInteractiveButtons(
        ctx.tenantId, ctx.conversationId, tmpl.body, tmpl.buttons,
      );
      return 'ADDRESS_COLLECTION';
    }
  }

  // ==================== ADDRESS SELECTION ====================

  /**
   * ADDRESS_SELECTION: Saved addresses list shown, waiting for selection.
   */
  private async handleAddressSelection(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, payload } = ctx;
    const raw = (message.text || '').trim();
    const text = normalizeTr(raw);

    // Handle list reply (interactive)
    const listReplyId = payload.interactive?.listReply?.id;

    const addAnswer = await this.interceptMidFlowAddAnswer(ctx, 'ADDRESS_SELECTION');
    if (addAnswer) return addAnswer;

    const undone = await this.interceptMidFlowUndo(ctx, 'ADDRESS_SELECTION');
    if (undone) return undone;

    // Cancel: short phrases plus everyday "iptal edin" / "vazgectim"
    if (await this.isStepCancelIntent(ctx, raw)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    const answered = await this.tryAnswerPaymentQuestion(ctx, raw, 'ADDRESS_SELECTION');
    if (answered) return answered;

    if (listReplyId === 'use_parked_address') {
      const order = await this.getActiveOrder(ctx);
      if (order?.deliveryAddress) {
        return this.acceptTypedAddress(ctx, order.deliveryAddress);
      }
      await whatsappService.sendLocationRequest(tenantId, conversationId, TEMPLATES.locationRequest);
      return 'LOCATION_REQUEST';
    }

    if (listReplyId === 'new_address') {
      // User wants to enter a new address
      await whatsappService.sendLocationRequest(
        tenantId,
        conversationId,
        TEMPLATES.locationRequest,
      );
      return 'LOCATION_REQUEST';
    }

    if (listReplyId?.startsWith('saved_addr_')) {
      const addressId = listReplyId.replace('saved_addr_', '');
      const savedAddr = await savedAddressService.getById(tenantId, addressId);

      if (!savedAddr) {
        await this.sendText(ctx, TEMPLATES.savedAddressInvalid);
        await whatsappService.sendLocationRequest(tenantId, conversationId, TEMPLATES.locationRequest);
        return 'LOCATION_REQUEST';
      }

      // Re-validate geo: store might be closed or out of range now
      const geoResult = await geoService.checkServiceArea(tenantId, {
        lat: savedAddr.lat,
        lng: savedAddr.lng,
      });
      await inboxService.updateConversationGeoCheck(tenantId, conversationId, geoResult, {
        lat: savedAddr.lat,
        lng: savedAddr.lng,
      });

      if (!geoResult.isWithinServiceArea) {
        // Same ways forward as an out-of-area pin (Gel Al / another pin / written address)
        return this.sendOutOfAreaOptions(ctx, geoResult, TEMPLATES.savedAddressOutOfArea(savedAddr.name));
      }

      // Check minimum basket
      const order = await this.getActiveOrder(ctx);
      if (order && geoResult.deliveryRule) {
        const orderTotal = Number(order.totalPrice);
        const minBasket = Number(geoResult.deliveryRule.minBasket);
        if (orderTotal < minBasket) {
          await this.sendText(ctx, TEMPLATES.locationMinBasketNotMet(minBasket, orderTotal));
          return 'ORDER_COLLECTING';
        }
      }

      // Set delivery address and store on order
      if (order) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            deliveryAddress: savedAddr.address,
            storeId: geoResult.nearestStore?.id || savedAddr.storeId,
            notes: this.stripTypedAddressNote(order.notes),
          },
        });
      }

      const storeName = geoResult.nearestStore?.name || 'En yakin sube';
      const deliveryFee = geoResult.deliveryRule ? Number(geoResult.deliveryRule.deliveryFee) : 0;
      await this.sendText(ctx, TEMPLATES.locationConfirmed(storeName, deliveryFee, geoResult.distance));

      // Skip address collection — go straight to payment
      await this.sendPaymentButtons(ctx);
      return 'PAYMENT_METHOD_SELECTION';
    }

    if (message.kind === 'TEXT' && raw && !listReplyId) {
      if (isLocationRefusal(raw)) {
        await this.sendText(ctx, TEMPLATES.typedAddressPrompt);
        return 'LOCATION_REQUEST';
      }

      const cls = classifyAddressText(raw);

      // Text fallback — might be typing "yeni" etc.
      if (text.includes('yeni') && cls.kind === 'none') {
        await whatsappService.sendLocationRequest(tenantId, conversationId, TEMPLATES.locationRequest);
        return 'LOCATION_REQUEST';
      }

      // Mid-flow cart edit while picking an address — explicit edits only
      const mid = await this.tryMidFlowAddition(ctx, 'ADDRESS_SELECTION');
      if (mid.nextPhase) return mid.nextPhase;
      if (mid.handled) {
        return this.proceedToAddressFlow(ctx);
      }

      if (cls.kind === 'full' || cls.kind === 'landmark') {
        return this.acceptTypedAddress(ctx, raw);
      }
    }

    // Unrecognized — resend list
    const current = await this.getActiveOrder(ctx);
    if (await this.sendSavedAddressList(ctx, current?.deliveryAddress ?? null)) {
      return 'ADDRESS_SELECTION';
    }
    await whatsappService.sendLocationRequest(tenantId, conversationId, TEMPLATES.locationRequest);
    return 'LOCATION_REQUEST';
  }

  // ==================== ADDRESS SAVE PROMPT ====================

  /**
   * ADDRESS_SAVE_PROMPT: Ask if customer wants to save the address, then collect name.
   */
  private async handleAddressSavePrompt(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, conversation, payload } = ctx;
    const text = normalizeTr(message.text || '');
    const buttonId = payload.interactive?.buttonReply?.id;

    // A payment question here must not be stored as the address name.
    const answered = await this.tryAnswerPaymentQuestion(ctx, message.text || '', 'ADDRESS_SAVE_PROMPT');
    if (answered) return answered;

    const subState = conversation.flowSubState || 'WAITING_SAVE_CONFIRM';

    if (subState === 'WAITING_SAVE_CONFIRM') {
      if (buttonId === 'save_address_yes' || this.matchesKeyword(text, CONFIRM_KEYWORDS)) {
        // User wants to save — ask for name with buttons
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: 'WAITING_ADDRESS_NAME' },
        });
        const nameTmpl = TEMPLATES.askAddressNameButtons;
        await whatsappService.sendInteractiveButtons(
          tenantId, conversationId, nameTmpl.body, nameTmpl.buttons,
        );
        return 'ADDRESS_SAVE_PROMPT';
      }

      if (buttonId === 'save_address_no' || this.matchesKeyword(text, CANCEL_KEYWORDS) || this.matchesKeyword(text, EDIT_KEYWORDS)) {
        // "hayir" or cancel — skip saving, go to payment
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: null },
        });
        await this.sendText(ctx, TEMPLATES.addressNotSaved);
        await this.sendPaymentButtons(ctx);
        return 'PAYMENT_METHOD_SELECTION';
      }

      // Unrecognized — re-send buttons
      const saveTmpl = TEMPLATES.askSaveAddressButtons;
      await whatsappService.sendInteractiveButtons(
        tenantId, conversationId, saveTmpl.body, saveTmpl.buttons,
      );
      return 'ADDRESS_SAVE_PROMPT';
    }

    if (subState === 'WAITING_ADDRESS_NAME') {
      // Handle button selections for address name
      let name = '';
      if (buttonId === 'addr_name_ev') {
        name = 'Ev';
      } else if (buttonId === 'addr_name_is') {
        name = 'Is';
      } else if (buttonId === 'addr_name_diger') {
        // "Diger" selected — ask to type a custom name
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: 'WAITING_ADDRESS_NAME_CUSTOM' },
        });
        await this.sendText(ctx, 'Adres icin bir isim yazin (ornek: _Annemin Evi_, _Ofis_):');
        return 'ADDRESS_SAVE_PROMPT';
      } else if (message.kind === 'TEXT' && text) {
        name = (message.text || '').trim();
      } else {
        const nameTmpl = TEMPLATES.askAddressNameButtons;
        await whatsappService.sendInteractiveButtons(
          tenantId, conversationId, nameTmpl.body, nameTmpl.buttons,
        );
        return 'ADDRESS_SAVE_PROMPT';
      }

      if (!name) {
        const nameTmpl = TEMPLATES.askAddressNameButtons;
        await whatsappService.sendInteractiveButtons(
          tenantId, conversationId, nameTmpl.body, nameTmpl.buttons,
        );
        return 'ADDRESS_SAVE_PROMPT';
      }

      return this.saveAddressAndProceed(ctx, name);
    }

    if (subState === 'WAITING_ADDRESS_NAME_CUSTOM') {
      if (message.kind !== 'TEXT' || !text) {
        await this.sendText(ctx, 'Lutfen adres icin bir isim yazin:');
        return 'ADDRESS_SAVE_PROMPT';
      }
      const customName = (message.text || '').trim();
      return this.saveAddressAndProceed(ctx, customName);
    }

    // Unknown sub-state — go to payment
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { flowSubState: null },
    });
    await this.sendPaymentButtons(ctx);
    return 'PAYMENT_METHOD_SELECTION';
  }

  // ==================== GEO HELPERS ====================

  private async processGeoResult(
    ctx: FlowContext,
    geoCheck: GeoCheckResult,
  ): Promise<ConversationPhase> {
    if (!geoCheck.isWithinServiceArea) {
      // Never a dead end: Gel Al, another pin, or a written address.
      return this.sendOutOfAreaOptions(ctx, geoCheck);
    }

    // Check minimum basket
    const order = await this.getActiveOrder(ctx);
    if (order && geoCheck.deliveryRule) {
      const orderTotal = Number(order.totalPrice);
      const minBasket = Number(geoCheck.deliveryRule.minBasket);

      if (orderTotal < minBasket) {
        await this.sendText(ctx, TEMPLATES.locationMinBasketNotMet(minBasket, orderTotal));
        return 'ORDER_COLLECTING';
      }
    }

    // A verified pin replaces an earlier written-address flag.
    if (order && this.isTypedAddressOrder(order)) {
      await prisma.order.update({
        where: { id: order.id },
        data: { notes: this.stripTypedAddressNote(order.notes) },
      });
    }

    // Location confirmed - show delivery info and payment buttons
    const storeName = geoCheck.nearestStore?.name || 'En yakin sube';
    const deliveryFee = geoCheck.deliveryRule ? Number(geoCheck.deliveryRule.deliveryFee) : 0;

    await this.sendText(ctx, TEMPLATES.locationConfirmed(storeName, deliveryFee, geoCheck.distance));

    // If the customer already gave an address earlier (before confirming), it
    // was parked on the order — bring it back here for confirmation instead of
    // asking them to type it again.
    if (order?.deliveryAddress) {
      await this.sendText(ctx, TEMPLATES.addressConfirmation(order.deliveryAddress));
      const tmpl = TEMPLATES.addressConfirmButtons;
      await whatsappService.sendInteractiveButtons(
        ctx.tenantId, ctx.conversationId, tmpl.body, tmpl.buttons,
      );
      return 'ADDRESS_COLLECTION';
    }

    // Ask for open text address before payment
    await this.sendText(ctx, TEMPLATES.addressRequest);

    return 'ADDRESS_COLLECTION';
  }

  // ==================== ADDITION VALIDATION ====================

  private async validateAdditionItems(
    ctx: FlowContext,
    draftOrder: any,
  ): Promise<string | null> {
    if (!draftOrder.parentOrderId) return null;

    const parentOrder = await prisma.order.findFirst({
      where: { id: draftOrder.parentOrderId, tenantId: ctx.tenantId },
      select: { status: true, orderNumber: true },
    });

    if (!parentOrder) return 'Ana siparis bulunamadi. Lutfen yeni siparis verin.';

    // DELIVERED or CANCELLED -> cannot add
    if (parentOrder.status === 'DELIVERED' || parentOrder.status === 'CANCELLED') {
      return TEMPLATES.additionNotAllowed(parentOrder.orderNumber || 0);
    }

    // READY -> only isReadyFood items allowed
    if (parentOrder.status === 'READY') {
      const itemMenuIds = draftOrder.items.map((i: any) => i.menuItemId);
      if (itemMenuIds.length === 0) return null;

      const menuItems = await prisma.menuItem.findMany({
        where: { id: { in: itemMenuIds }, tenantId: ctx.tenantId },
        select: { id: true, name: true, isReadyFood: true },
      });

      const nonReadyItems = menuItems.filter((mi) => !mi.isReadyFood);
      if (nonReadyItems.length > 0) {
        const names = nonReadyItems.map((i) => i.name).join(', ');
        return TEMPLATES.additionReadyFoodOnly(names);
      }
    }

    // CONFIRMED or PREPARING -> all items allowed
    return null;
  }

  // ==================== SMART FALLBACK (Adim 8) ====================

  /**
   * Fallback when the NLU produced no order action.
   *
   * Previously this dumped a "here is how you type an order" tutorial (the
   * 11x "Anlayamadim, eklemek istediginiz urunu..." defect). Now every such
   * message goes through the conversational answer layer, which sees the FULL
   * menu (with descriptions) and answers the actual question. A canned line is
   * only used when the model is unreachable.
   */
  private async sendSmartFallback(
    ctx: FlowContext,
    text: string,
    fallbackText?: string,
  ): Promise<void> {
    const rawText = (ctx.message.text || text || '').trim();

    // Pure greeting / thanks: short human reply, greeting template at most once
    // per conversation (see rule "Selamlama sablonu en fazla bir kez").
    const words = text.split(/\s+/).filter((w) => w.length > 1);
    if (words.length <= 3 && this.matchesKeyword(text, THANKS_KEYWORDS)) {
      await this.sendText(ctx, 'Rica ederim, afiyet olsun.');
      return;
    }
    if (words.length <= 3 && this.matchesKeyword(text, GREETING_KEYWORDS)) {
      await this.sendGreetingOnce(ctx, 'Buyurun, sizi dinliyorum.');
      return;
    }

    const answered = await this.answerConversationally(ctx, rawText);
    if (answered) return;

    // Model unreachable. If the extractor produced its own useful line
    // (a suggestion list, an option question), prefer it over a canned reply.
    if (fallbackText) {
      await this.sendText(ctx, fallbackText);
      return;
    }

    // Otherwise: polite, context-aware, never a raw error and never a
    // "type this" tutorial.
    const order = await this.getActiveOrder(ctx);
    if (order && order.items.length > 0) {
      await this.sendText(ctx, 'Bunu su an net cikaramadim. Siparisinize eklemek istediginiz baska bir sey var mi?');
    } else {
      await this.sendText(ctx, 'Bunu su an net cikaramadim. Bugun canin ne cekiyor, yardimci olayim?');
    }
  }

  // ==================== CONVERSATIONAL ANSWER LAYER ====================

  /**
   * Does this message also carry a question, on top of whatever order action
   * it performed? ("bi kola ekle, icinde seker var mi")
   *
   * Deliberately narrow: only an explicit question mark, a standalone Turkish
   * question particle (mi/mi/mu/mu — folded to mi/mu) or an unambiguous
   * question phrase counts. Bare "ne"/"kac" are NOT included, because
   * "2 kola kac tane" style order text would trip them and every ordinary
   * order turn would pay an extra LLM round-trip.
   */
  private hasQuestionSignal(rawText: string): boolean {
    return textHasQuestionSignal(rawText);
  }

  /**
   * The order action already happened and the cart was shown. If the SAME
   * message also asked something, answer that too — rule "aynı mesajda hem
   * ürün hem soru varsa ikisi de karşılanmalı".
   *
   * Gated by hasQuestionSignal so a plain "2 kola" order never pays the extra
   * 5-9s model call.
   */
  private async answerSideQuestion(ctx: FlowContext, rawText: string): Promise<void> {
    if (!this.hasQuestionSignal(rawText)) return;
    // Silent on failure: the cart summary has already been delivered, so an
    // extra apology line here would just be noise.
    await this.answerConversationally(ctx, rawText, { answerOnly: true });
  }

  /**
   * Ask the conversational answer layer (full menu + descriptions + cart +
   * recent turns) and send its reply. Returns true when something was sent.
   *
   * Handles the scope guard: general chit-chat gets ONE polite redirect per
   * conversation; the second attempt gets a single closing line and nothing
   * more is generated in that lane.
   *
   * `answerOnly` suppresses the off-topic redirect/closing lines. Used when an
   * order action ALREADY succeeded for this message: telling a customer who
   * just filled their cart "I am only the order assistant" would be absurd,
   * and it would burn an off-topic strike on a legitimate order turn.
   */
  private async answerConversationally(
    ctx: FlowContext,
    rawText: string,
    opts?: { answerOnly?: boolean },
  ): Promise<boolean> {
    if (!rawText || !conversationAnswerService.isAvailable()) return false;

    try {
      const strikes = await this.countOffTopicStrikes(ctx);
      const cart = await this.buildCartContext(ctx);

      const result = await conversationAnswerService.answer({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        userText: rawText,
        cart: cart.lines,
        cartTotal: cart.total,
        priceObjection: this.detectPriceObjection(normalizeTr(rawText)),
        offTopicStrikes: strikes,
      });

      if (!result) return false;

      // An order action already succeeded for this message — say nothing
      // rather than redirecting/closing the customer down.
      if (opts?.answerOnly && result.kind !== 'answer') return false;

      // Second off-topic attempt in the same conversation: stop producing.
      if (result.kind === 'closed' && strikes >= 2) {
        return true; // silence — the closing line was already spent
      }

      await this.sendText(ctx, result.text);
      return true;
    } catch (error) {
      logger.warn({ error, conversationId: ctx.conversationId }, 'Conversational answer failed');
      return false;
    }
  }

  /** Current draft cart as plain lines for the answer prompt. */
  private async buildCartContext(
    ctx: FlowContext,
  ): Promise<{ lines: CartLine[] | null; total: number | null }> {
    try {
      const order = await this.getDraftOrder(ctx);
      if (!order || order.items.length === 0) return { lines: null, total: null };
      return {
        lines: order.items.map((item: any) => ({
          name: item.menuItemName,
          qty: item.qty,
          unitPrice: Number(item.unitPrice),
          notes: item.notes,
        })),
        total: Number(order.totalPrice),
      };
    } catch {
      return { lines: null, total: null };
    }
  }

  /**
   * How many off-topic redirects were already sent in this conversation.
   * Counted from the outbound message history so it survives restarts and does
   * not fight with flowSubState/flowMetadata (which the order flow owns).
   */
  private async countOffTopicStrikes(ctx: FlowContext): Promise<number> {
    try {
      const [redirects, closings] = await Promise.all([
        prisma.message.count({
          where: {
            conversationId: ctx.conversationId,
            tenantId: ctx.tenantId,
            direction: 'OUT',
            text: { contains: OFF_TOPIC_FIRST_MARKER },
          },
        }),
        prisma.message.count({
          where: {
            conversationId: ctx.conversationId,
            tenantId: ctx.tenantId,
            direction: 'OUT',
            text: { contains: OFF_TOPIC_FINAL_MARKER },
          },
        }),
      ]);
      return redirects + closings;
    } catch {
      return 0;
    }
  }

  /**
   * Send the greeting template AT MOST ONCE per conversation. Every later
   * greeting-shaped message gets the short alternative instead — this is what
   * kills the 87x "Merhaba! Hosgeldiniz" spam.
   */
  private async sendGreetingOnce(ctx: FlowContext, alternative: string): Promise<void> {
    let alreadySent = false;
    try {
      const found = await prisma.message.findFirst({
        where: {
          conversationId: ctx.conversationId,
          tenantId: ctx.tenantId,
          direction: 'OUT',
          text: { contains: GREETING_MARKER },
        },
        select: { id: true },
      });
      alreadySent = !!found;
    } catch {
      alreadySent = false;
    }

    await this.sendText(ctx, alreadySent ? alternative : TEMPLATES.greeting);
  }

  // ==================== FLOW-ORDER GUARDS (payment / address) ====================

  /**
   * The order of the flow is fixed:
   *   cart -> CONFIRM -> delivery type -> [address] -> payment method -> [link]
   * A payment question or an address given before its turn is still answered
   * or kept — never ignored and never turned into a product.
   *
   * IMPORTANT: this NEVER short-circuits the order flow. It is called only in
   * pre-confirm phases and only decides whether an extra reply is sent;
   * products in the same message are still extracted by the NLU.
   * Returns true when something was sent.
   */
  private async sendPreConfirmNotice(
    ctx: FlowContext,
    _text: string,
    rawText: string,
    opts?: { skipOpenQuestion?: boolean },
  ): Promise<boolean> {
    const phase = (ctx.conversation.phase as ConversationPhase) || 'IDLE';
    const paymentPhase: ConversationPhase =
      phase === 'ORDER_COLLECTING' || phase === 'ORDER_REVIEW' ? phase : 'IDLE';
    if (await this.tryAnswerPaymentQuestion(ctx, rawText, paymentPhase)) return true;

    const cls = classifyAddressText(rawText);
    if (cls.kind === 'none' || cls.kind === 'vague') return false;
    // "1 Villa Pizza" can look like a site name: only a full street address
    // wins over a menu-name match.
    if (cls.kind !== 'full' && (await this.menuMatchInCurrentText(ctx, rawText))) return false;

    try {
      const order = await this.getDraftOrder(ctx);
      if (!order) {
        // A special request still waiting for its product ("Yarim mi Tam mi?"):
        // repeat THAT question, not a generic "what would you like to order?" —
        // the customer already said what they want (High Five, 12.09).
        const open = opts?.skipOpenQuestion
          ? null
          : await nluOrchestratorService.getOpenSpecialRequestQuestion(ctx.tenantId, ctx.conversationId);
        if (cls.kind === 'directions') {
          // Sepet yokken verilen kurye talimati kaybolmasin (High Five 12.09: "Konuma
          // geldiginizde cocuk cikip alacak"): saklanir, siparis onaylaninca nota yazilir.
          await this.pushPreDraftDeliveryNote(ctx.conversationId, rawText.trim());
        }
        const lead =
          cls.kind === 'directions'
            ? 'Teslimat notunuzu aldim, siparisinize ekleyecegim.'
            : 'Adresinizi teslimat adiminda alacagim.';
        await this.sendText(ctx, `${lead} ${open ?? 'Once ne siparis etmek istediginizi yazar misiniz?'}`);
        return true;
      }
      if (cls.kind === 'directions') {
        await this.appendOrderNote(order, `Teslimat notu: ${rawText.trim()}`);
        await this.sendText(ctx, 'Teslimat notunuzu aldim, teslimat adiminda kullanacagim.');
        return true;
      }
      // Do not lose the address: park it on the draft so the address step can
      // offer it back for confirmation.
      if (!order.deliveryAddress) {
        await prisma.order.update({
          where: { id: order.id },
          data: { deliveryAddress: rawText.trim().substring(0, 400) },
        });
      }
    } catch (error) {
      logger.warn({ error, conversationId: ctx.conversationId }, 'Failed to park early address');
    }
    await this.sendText(ctx, 'Adres bilginizi not aldim, teslimat adiminda kullanacagim.');
    return true;
  }

  /** Detects price pushback so the answer layer switches to the empathetic,
   *  no-bargaining tone (price stays fixed, a cheaper item may be suggested). */
  private detectPriceObjection(rawText: string): boolean {
    const text = deaccentTr(rawText);
    const phrases = [
      'pahali', 'tuzlu', 'indirim', 'ucuz', 'fazla degil mi', 'cok para',
      'uygun bir sey', 'butcem', 'hesapli', 'kampanya var mi',
    ];
    return phrases.some((p) => text.includes(p));
  }

  /**
   * Menu media (photos / PDF) should only be pushed for an actual "show me the
   * menu" request. A real question that merely contains the word "menude"
   * ("en ucuz ne var menude") deserves an answer, not a photo dump.
   */
  private isMenuMediaRequest(text: string): boolean {
    const words = deaccentTr(text).split(/\s+/).filter(Boolean);
    return words.length <= 3 && this.matchesKeyword(text, MENU_KEYWORDS);
  }

  // ==================== MIN BASKET WARNING (Adim 9) ====================

  /**
   * Adim 9: Erken minimum sepet uyarisi
   * Draft guncellendikten sonra tenant'in min sepet tutarini kontrol eder
   */
  private async checkMinBasketWarning(ctx: FlowContext, orderId: string): Promise<void> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { totalPrice: true, tenantId: true },
      });

      if (!order) return;

      // En dusuk minimum sepet tutarini bul
      const minBasketInfo = await this.getMinBasketInfo(ctx.tenantId);
      if (!minBasketInfo) return;

      const orderTotal = Number(order.totalPrice);
      if (orderTotal < minBasketInfo.minBasket) {
        await this.sendText(
          ctx,
          `Not: Minimum siparis tutari ${minBasketInfo.minBasket.toFixed(2)} TL. Mevcut sepetiniz: ${orderTotal.toFixed(2)} TL`,
        );
      }
    } catch (error) {
      // Sessiz hata - uyari gonderemezse problem degil
      logger.debug({ error }, 'Min basket check failed (non-critical)');
    }
  }

  /**
   * Get minimum basket amount from DeliveryRule
   */
  private async getMinBasketInfo(tenantId: string): Promise<{ minBasket: number } | null> {
    const rule = await prisma.deliveryRule.findFirst({
      where: {
        store: { tenantId, isActive: true },
      },
      orderBy: { minBasket: 'asc' },
      select: { minBasket: true },
    });

    if (!rule) return null;
    const minBasket = Number(rule.minBasket);
    return minBasket > 0 ? { minBasket } : null;
  }

  // ==================== SHARED HELPERS ====================

  private async sendText(ctx: FlowContext, text: string): Promise<void> {
    await whatsappService.sendText(ctx.tenantId, ctx.conversationId, text);
  }

  private formatWorkingHours(wh: any): string {
    const dayLabels: Record<string, string> = {
      mon: 'Pazartesi', tue: 'Sali', wed: 'Carsamba', thu: 'Persembe',
      fri: 'Cuma', sat: 'Cumartesi', sun: 'Pazar',
    };
    const closedDays: string[] = Array.isArray(wh.closed) ? wh.closed : [];
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    return days.map(d => {
      const s = wh[d];
      if (closedDays.includes(d) || s?.closed === true) return `${dayLabels[d]}: Kapali`;
      if (s?.allDay === true || (s?.open && s.open === s.close)) return `${dayLabels[d]}: 24 Saat Acik`;
      if (s?.open && s?.close) return `${dayLabels[d]}: ${s.open} - ${s.close}`;
      return `${dayLabels[d]}: -`;
    }).join('\n');
  }

  private getNextOpenDay(wh: any, currentDay: string): string {
    const dayLabels: Record<string, string> = {
      mon: 'Pazartesi', tue: 'Sali', wed: 'Carsamba', thu: 'Persembe',
      fri: 'Cuma', sat: 'Cumartesi', sun: 'Pazar',
    };
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const closedDays: string[] = Array.isArray(wh.closed) ? wh.closed : [];
    const startIdx = days.indexOf(currentDay);
    for (let i = 1; i <= 7; i++) {
      const nextDay = days[(startIdx + i) % 7];
      const s = wh[nextDay];
      if (closedDays.includes(nextDay) || s?.closed === true) continue;
      if (s?.allDay === true) return `Bir sonraki acilis: ${dayLabels[nextDay]} (24 saat acik)`;
      if (s?.open) return `Bir sonraki acilis: ${dayLabels[nextDay]} ${s.open}`;
    }
    return '';
  }

  private async sendOrderConfirmButtons(ctx: FlowContext, summaryText: string): Promise<void> {
    const tmpl = TEMPLATES.orderConfirmButtons;
    await whatsappService.sendInteractiveButtons(
      ctx.tenantId,
      ctx.conversationId,
      summaryText,
      tmpl.buttons,
    );
  }

  private async sendOptionSelectionList(ctx: FlowContext, selection: OptionSelectionRequest): Promise<void> {
    const rows = selection.options.map((o) => ({
      id: o.id,
      title: o.name.substring(0, 24),
      description: o.priceDelta > 0 ? `+${o.priceDelta} ₺` : undefined,
    }));

    await whatsappService.sendListMessage(
      ctx.tenantId,
      ctx.conversationId,
      `${selection.itemName}\n${selection.stepNumber}. ${selection.groupName} seçiminiz:`,
      'Seçenekler',
      [{ title: selection.groupName, rows }],
    );
  }

  private async sendPaymentButtons(ctx: FlowContext): Promise<void> {
    // Check if this is a pickup order to adjust button labels
    const order = await this.getActiveOrder(ctx);
    const isPickup = order?.deliveryType === 'PICKUP';

    if (isPickup) {
      // Pickup: kasada (at the counter)
      await whatsappService.sendInteractiveButtons(
        ctx.tenantId,
        ctx.conversationId,
        'Odeme yontemini secin:',
        [
          { id: 'pay_cash', title: 'Nakit (kasada)' },
          { id: 'pay_card_door', title: 'Kart (kasada)' },
          { id: 'pay_card_online', title: 'Online Kredi Karti' },
        ],
      );
    } else {
      // Delivery: kapida (at the door)
      const tmpl = TEMPLATES.paymentMethodButtons;
      await whatsappService.sendInteractiveButtons(
        ctx.tenantId,
        ctx.conversationId,
        tmpl.body,
        tmpl.buttons,
      );
    }
  }

  private async saveAddressAndProceed(ctx: FlowContext, name: string): Promise<ConversationPhase> {
    const { tenantId, conversationId, conversation } = ctx;

    const customerLat = conversation.customerLat;
    const customerLng = conversation.customerLng;
    const nearestStoreId = conversation.nearestStoreId;

    const order = await this.getActiveOrder(ctx);
    const address = order?.deliveryAddress || '';

    if (customerLat && customerLng && nearestStoreId && address && name) {
      await savedAddressService.create(tenantId, conversation.customerPhone, {
        name,
        address,
        lat: customerLat,
        lng: customerLng,
        storeId: nearestStoreId,
      });
      await this.sendText(ctx, TEMPLATES.addressSaved(name));
    } else {
      logger.warn({ tenantId, conversationId }, 'Missing geo data for address save');
      await this.sendText(ctx, TEMPLATES.addressNotSaved);
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { flowSubState: null },
    });
    await this.sendPaymentButtons(ctx);
    return 'PAYMENT_METHOD_SELECTION';
  }

  private async getActiveOrder(ctx: FlowContext) {
    const orderId = ctx.conversation.activeOrderId;
    if (!orderId) return null;

    return prisma.order.findFirst({
      where: { id: orderId, tenantId: ctx.tenantId, status: 'DRAFT' },
      include: { items: true },
    });
  }

  /**
   * Current draft order, looked up by conversation rather than by the possibly
   * stale activeOrderId snapshot on ctx.conversation. Used by the answer layer
   * and the flow-order guards, which run right after the NLU may have created
   * or replaced the draft in this same turn.
   */
  private async getDraftOrder(ctx: FlowContext) {
    const byId = await this.getActiveOrder(ctx);
    if (byId) return byId;

    return prisma.order.findFirst({
      where: { tenantId: ctx.tenantId, conversationId: ctx.conversationId, status: 'DRAFT' },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  /**
   * Seamless addition: transfer draft items to active order, handle payment delta
   */
  private async handleSeamlessAddition(
    ctx: FlowContext,
    activeOrder: any,
    draftOrderId: string,
  ): Promise<ConversationPhase> {
    const { tenantId, conversationId } = ctx;

    const draft = await prisma.order.findFirst({
      where: { id: draftOrderId, tenantId },
      include: { items: true },
    });

    if (!draft || draft.items.length === 0) {
      // CATCH-ALL FIX: nothing to add is not a reason to greet again.
      if (!(await this.answerConversationally(ctx, ctx.message.text || ''))) {
        await this.sendText(ctx, 'Siparisinize eklenecek bir sey bulamadim. Ne eklemek istersiniz?');
      }
      return 'IDLE';
    }

    // Validate: READY status only allows isReadyFood items
    if (activeOrder.status === 'READY') {
      const itemMenuIds = draft.items.map((i: any) => i.menuItemId);
      const menuItems = await prisma.menuItem.findMany({
        where: { id: { in: itemMenuIds }, tenantId },
        select: { id: true, name: true, isReadyFood: true },
      });
      const nonReadyItems = menuItems.filter((mi) => !mi.isReadyFood);
      if (nonReadyItems.length > 0) {
        const names = nonReadyItems.map((i) => i.name).join(', ');
        await this.sendText(ctx, TEMPLATES.additionReadyFoodOnly(names));
        await prisma.orderItem.deleteMany({ where: { orderId: draftOrderId } });
        await prisma.order.delete({ where: { id: draftOrderId } });
        return 'IDLE';
      }
    }

    const itemsToAdd = draft.items.map((item: any) => ({
      menuItemId: item.menuItemId,
      menuItemName: item.menuItemName,
      qty: item.qty,
      unitPrice: Number(item.unitPrice),
      optionsJson: item.optionsJson,
      extrasJson: item.extrasJson,
      notes: item.notes,
    }));

    const additionTotal = itemsToAdd.reduce(
      (sum, i) => sum + i.unitPrice * i.qty, 0
    );

    // Add items to the active order
    const updatedOrder = await orderService.addItemsToOrder(
      tenantId, activeOrder.id, itemsToAdd
    );

    // Clean up draft
    await prisma.orderItem.deleteMany({ where: { orderId: draftOrderId } });
    await prisma.order.delete({ where: { id: draftOrderId } });

    const addedItemsSummary = itemsToAdd
      .map(i => `${i.qty}x ${i.menuItemName}`)
      .join(', ');

    // Check if original payment was online credit card
    const wasOnline = await this.wasOriginalPaymentOnline(tenantId, activeOrder.id);

    if (wasOnline) {
      try {
        const payment = await orderPaymentService.initiateAdditionPayment(
          tenantId, activeOrder.id, conversationId,
          ctx.conversation.customerPhone,
          additionTotal,
          itemsToAdd.map(i => ({ menuItemName: i.menuItemName, qty: i.qty, unitPrice: i.unitPrice })),
        );
        await this.sendText(ctx, TEMPLATES.seamlessAdditionPaymentNeeded(
          activeOrder.orderNumber || 0,
          addedItemsSummary,
          additionTotal,
          payment.checkoutFormUrl || '',
          updatedOrder.totalPrice,
        ));
      } catch (err) {
        logger.warn({ err, tenantId, orderId: activeOrder.id }, 'Addition payment failed, notifying without payment link');
        await this.sendText(ctx, TEMPLATES.seamlessAdditionConfirmed(
          activeOrder.orderNumber || 0,
          addedItemsSummary,
          additionTotal,
          updatedOrder.totalPrice,
        ));
      }
    } else {
      await this.sendText(ctx, TEMPLATES.seamlessAdditionConfirmed(
        activeOrder.orderNumber || 0,
        addedItemsSummary,
        additionTotal,
        updatedOrder.totalPrice,
      ));
    }

    await inboxService.updateConversationPhase(
      tenantId, conversationId, 'ORDER_CONFIRMED', null,
    );
    return 'ORDER_CONFIRMED';
  }

  /**
   * Payment change: customer wants to switch from cash/card-at-door to online payment
   */
  private async handlePaymentChangeRequest(
    ctx: FlowContext,
    activeOrder: any,
  ): Promise<ConversationPhase> {
    const { tenantId, conversationId } = ctx;

    // Already paid online — nothing to change
    const wasOnline = await this.wasOriginalPaymentOnline(tenantId, activeOrder.id);
    if (wasOnline) {
      await this.sendText(ctx, 'Siparisiniz zaten online odeme ile onaylandi.');
      return 'ORDER_CONFIRMED';
    }

    try {
      const payment = await orderPaymentService.initiateCardPayment(
        tenantId,
        activeOrder.id,
        conversationId,
        ctx.conversation.customerPhone,
      );

      if (payment.checkoutFormUrl) {
        const total = Number(activeOrder.totalPrice);
        await this.sendText(
          ctx,
          TEMPLATES.paymentChangeLinkSent(
            activeOrder.orderNumber || 0,
            total,
            payment.checkoutFormUrl,
          ),
        );

        // Mark sub-state so handleOrderConfirmed knows we're waiting for payment
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: 'PAYMENT_CHANGE_PENDING' },
        });
        await inboxService.updateConversationPhase(
          tenantId, conversationId, 'ORDER_CONFIRMED', activeOrder.id,
        );
        return 'ORDER_CONFIRMED';
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: errMsg, tenantId, orderId: activeOrder.id }, 'Payment change link creation failed');
    }

    await this.sendText(ctx, 'Online odeme linki olusturulamadi. Mevcut odeme yonteminiz gecerli olmaya devam edecektir.');
    return 'ORDER_CONFIRMED';
  }

  private async wasOriginalPaymentOnline(tenantId: string, orderId: string): Promise<boolean> {
    const payment = await prisma.orderPayment.findFirst({
      where: { tenantId, orderId, method: 'CREDIT_CARD', status: 'SUCCESS' },
    });
    return !!payment;
  }

  /**
   * Mid-flow cart edit while the customer is on a post-confirm step
   * (DELIVERY_TYPE_SELECTION, LOCATION_REQUEST, ADDRESS_SELECTION,
   * PAYMENT_METHOD_SELECTION).
   *
   * Only an EXPLICIT edit that names a menu item reaches the NLU. Everything
   * else (addresses, directions, complaints, payment questions) is handled by
   * the step itself: sending those to the NLU added a "2'li Pizza Menu" for
   * "Hayalim kent e gidecek" and again for "Yanlis oldu" (High Five, 30.08).
   * A real change is recorded so "geri al" / "yanlis oldu" can undo it.
   */
  private async tryMidFlowAddition(
    ctx: FlowContext,
    phase: ConversationPhase,
  ): Promise<{ handled: boolean; nextPhase?: ConversationPhase }> {
    const { tenantId, conversationId, message, payload } = ctx;
    const raw = (message.text || '').trim();
    if (message.kind !== 'TEXT' || !raw || !message.id) return { handled: false };
    if (payload.interactive?.buttonReply?.id || payload.interactive?.listReply?.id) return { handled: false };

    const match = await this.findMenuMatch(ctx, raw);
    if (!isExplicitMidFlowEdit(raw, match.matched)) {
      // A product named without clear add wording: ask. Never add it silently,
      // and never drop it and re-send the step prompt as if nothing was said.
      if (match.name && isMidFlowItemMention(raw, match.matched)) {
        await this.writeFlowMeta(conversationId, {
          pendingMidFlowAdd: { text: raw.substring(0, 300), phase, at: new Date().toISOString() },
        });
        await whatsappService.sendInteractiveButtons(
          tenantId,
          conversationId,
          TEMPLATES.midFlowAddAsk(match.name),
          TEMPLATES.midFlowAddButtons,
        );
        return { handled: true, nextPhase: phase };
      }
      logger.info({ tenantId, conversationId, phase, menuMatch: match.matched }, 'Mid-flow text not treated as order edit');
      return { handled: false };
    }
    return this.runMidFlowEdit(ctx, phase, raw);
  }

  /** Run an explicit cart edit through the NLU after the order was confirmed (recorded for undo). */
  private async runMidFlowEdit(
    ctx: FlowContext,
    phase: ConversationPhase,
    raw: string,
  ): Promise<{ handled: boolean; nextPhase?: ConversationPhase }> {
    const { tenantId, conversationId, message } = ctx;

    // Capture everything about the cart BEFORE the NLU runs — nothing read from
    // `beforeOrder` afterwards may be trusted to still describe the old cart.
    const beforeOrder = await this.getDraftOrder(ctx);
    const before = beforeOrder ? this.snapshotCart(beforeOrder) : [];
    const beforeSig = beforeOrder ? this.cartSignature(before, beforeOrder.notes) : '';
    const beforeTotal = beforeOrder ? Number(beforeOrder.totalPrice) : 0;
    const beforeNotes: string | null = beforeOrder?.notes ?? null;

    const result = await nluOrchestratorService.processMessage(
      tenantId, conversationId, message.id, normalizeTr(raw),
    );
    // LLM unavailable: the step re-prompts itself — never go silent here.
    if (result.needsAgentHandoff) return { handled: false };

    const afterOrder = result.draftOrderId
      ? await prisma.order.findFirst({
          where: { id: result.draftOrderId, tenantId, status: 'DRAFT' },
          include: { items: true },
        })
      : await this.getDraftOrder(ctx);

    // The customer is past review: an NLU pass must never silently empty the order.
    if (beforeOrder && before.length > 0 && (!afterOrder || afterOrder.items.length === 0)) {
      const restored = await this.recreateDraft(ctx, { ...beforeOrder, totalPrice: beforeTotal, notes: beforeNotes }, before, phase);
      logger.warn({ tenantId, conversationId, phase }, 'Mid-flow NLU emptied the cart — draft restored');
      await this.sendText(ctx, `Hangi urunu cikaralim? Lutfen urun adini yazin.\n\n${this.buildOrderSummary(restored)}`);
      return { handled: true };
    }

    // A newly named bundle with required options: run the option list. The old
    // code dropped it and left a bundle without options in the cart.
    if (result.pendingOptionSelection && result.draftOrderId) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { flowSubState: 'OPTION_SELECTION', activeOrderId: result.draftOrderId },
      });
      ctx.conversation.activeOrderId = result.draftOrderId;
      await this.sendOptionSelectionList(ctx, result.pendingOptionSelection);
      return { handled: true, nextPhase: 'ORDER_COLLECTING' };
    }

    // A real change (not `itemsExtracted`, which is also true for keep-only extractions)
    if (afterOrder && result.draftOrderId && result.confirmationMessage) {
      // createDraftOrder recomputes the total from the lines, which silently
      // dropped a pickup discount granted earlier.
      if (afterOrder.discountPercent && afterOrder.discountPercent > 0) {
        const subtotal = afterOrder.items.reduce((s: number, i: any) => s + Number(i.unitPrice) * i.qty, 0);
        const discountAmount = Math.round(subtotal * afterOrder.discountPercent) / 100;
        await prisma.order.update({
          where: { id: afterOrder.id },
          data: { totalPrice: subtotal - discountAmount, discountAmount },
        });
        (afterOrder as any).totalPrice = subtotal - discountAmount;
      }

      const afterSig = this.cartSignature(this.snapshotCart(afterOrder), afterOrder.notes);
      if (beforeOrder && afterOrder.id === beforeOrder.id && afterSig !== beforeSig) {
        await this.pushMidFlowChange(conversationId, {
          v: 1,
          orderId: afterOrder.id,
          phase,
          messageId: message.id,
          at: new Date().toISOString(),
          before,
          beforeTotal,
          beforeNotes,
          afterSignature: afterSig,
        });
      } else if (beforeOrder && afterOrder.id !== beforeOrder.id) {
        logger.warn(
          { tenantId, conversationId, before: beforeOrder.id, after: afterOrder.id },
          'Mid-flow edit touched a different draft — not recorded for undo',
        );
      }
      if (ctx.conversation.activeOrderId !== afterOrder.id) {
        await inboxService.updateConversationPhase(tenantId, conversationId, phase, afterOrder.id);
        ctx.conversation.activeOrderId = afterOrder.id;
      }
      await this.sendText(
        ctx,
        `Guncellendi! Guncel siparisiniz:\n\n${this.buildOrderSummary(afterOrder)}\n\n${TEMPLATES.midFlowUndoHint}`,
      );
      return { handled: true };
    }

    if (result.clarificationQuestion && !result.weakClarification) {
      await this.sendText(ctx, result.clarificationQuestion);
      return { handled: true };
    }

    return { handled: false };
  }

  /**
   * Answer to "X siparisinize eklensin mi?": the buttons, or a bare evet/hayir
   * while that question is open. Returns null when the message is not an answer.
   */
  private async interceptMidFlowAddAnswer(ctx: FlowContext, phase: ConversationPhase): Promise<ConversationPhase | null> {
    const { message, payload, conversationId } = ctx;
    const buttonId = payload.interactive?.buttonReply?.id;
    let answer: 'yes' | 'no' | null = buttonId === 'mid_add_yes' ? 'yes' : buttonId === 'mid_add_no' ? 'no' : null;
    if (!answer) {
      if (message.kind !== 'TEXT' || buttonId || payload.interactive?.listReply?.id) return null;
      const ws = foldedWords(message.text || '');
      if (ws.length === 0 || ws.length > 2) return null;
      if (ws.every((w) => ['evet', 'ekle', 'ekleyin', 'olur', 'tamam', 'lutfen'].includes(w))) answer = 'yes';
      else if (ws.every((w) => ['hayir', 'istemiyorum', 'eklemeyin', 'gerek', 'yok'].includes(w))) answer = 'no';
      else return null;
    }

    const meta = await this.readFlowMeta(conversationId);
    const pending = meta.pendingMidFlowAdd;
    const fresh =
      !!pending && typeof pending.text === 'string' && Date.now() - Date.parse(pending.at) < MID_FLOW_UNDO_TTL_MS;
    if (!fresh) {
      // A plain "evet" with no open question belongs to the step itself.
      if (!buttonId) return null;
      if (pending) await this.writeFlowMeta(conversationId, { pendingMidFlowAdd: undefined });
      return this.repromptCurrentStep(ctx, phase);
    }
    // Yazili "tamam/olur/evet" yalniz sorunun SORULDUGU adimda cevaptir. Musteri
    // soruyu gecip pin/adres/odeme adimina ilerlediyse sonraki "tamam" o adimin
    // cevabidir; eskiden 30 dk icindeki her "tamam" urunu sessizce ekliyordu.
    if (!buttonId && pending.phase && pending.phase !== phase) {
      await this.writeFlowMeta(conversationId, { pendingMidFlowAdd: undefined });
      return null;
    }
    await this.writeFlowMeta(conversationId, { pendingMidFlowAdd: undefined });

    if (answer === 'no') {
      await this.sendText(ctx, TEMPLATES.midFlowAddDeclined);
      return this.repromptCurrentStep(ctx, phase);
    }
    const mid = await this.runMidFlowEdit(ctx, phase, pending.text);
    if (mid.nextPhase) return mid.nextPhase;
    if (!mid.handled) {
      await this.sendText(ctx, 'Bu urunu siparisinize ekleyemedim. Eklemek istediginiz urunun adini yazar misiniz?');
    }
    return this.repromptCurrentStep(ctx, phase);
  }

  /**
   * A bundle with required options: interactive list + OPTION_SELECTION, then
   * answer a payment question from the SAME message. "2'li pizza menu istiyorum.
   * IBAN ve odeyecegim miktari yazar misiniz" got only the list (High Five, 30.08).
   */
  private async startOptionSelection(
    ctx: FlowContext,
    result: { draftOrderId?: string; pendingOptionSelection?: OptionSelectionRequest },
  ): Promise<void> {
    if (!result.pendingOptionSelection) return;
    const activeOrderId = result.draftOrderId || ctx.conversation.activeOrderId;
    await prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { flowSubState: 'OPTION_SELECTION', activeOrderId },
    });
    ctx.conversation.activeOrderId = activeOrderId;
    ctx.conversation.flowSubState = 'OPTION_SELECTION';
    await this.sendOptionSelectionList(ctx, result.pendingOptionSelection);
    await this.tryAnswerPaymentQuestion(ctx, ctx.message.text || '', 'ORDER_COLLECTING');
  }

  /** Re-send the option list for the bundle line that still misses a required option. */
  private async resendOptionSelectionList(ctx: FlowContext): Promise<boolean> {
    try {
      const orderId = ctx.conversation.activeOrderId;
      if (!orderId) return false;
      const orderItem = await prisma.orderItem.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
      });
      if (!orderItem) return false;
      const menuItem = await prisma.menuItem.findUnique({
        where: { id: orderItem.menuItemId },
        include: { optionGroups: { include: { group: { include: { options: true } } } } },
      });
      if (!menuItem) return false;
      const current = (orderItem.optionsJson as any[]) || [];
      for (const og of menuItem.optionGroups) {
        if (!og.group.required) continue;
        const selected = current.filter((co: any) => co.groupName === og.group.name).length;
        if (selected < (og.group.minSelect || 1)) {
          await this.sendOptionSelectionList(ctx, {
            itemName: menuItem.name,
            groupName: og.group.name.replace(/ \(\d+x\)/, ''),
            stepNumber: selected + 1,
            options: og.group.options.map((o) => ({
              id: `opt_${o.name.substring(0, 20).replace(/\s/g, '_')}`,
              name: o.name,
              priceDelta: Number(o.priceDelta),
            })),
          });
          return true;
        }
      }
      return false;
    } catch (error) {
      logger.warn({ error, conversationId: ctx.conversationId }, 'Failed to re-send option list');
      return false;
    }
  }

  // ==================== MID-FLOW UNDO ====================

  private snapshotCart(order: any): CartSnapshotLine[] {
    return (order.items || []).map((i: any) => ({
      menuItemId: i.menuItemId,
      menuItemName: i.menuItemName,
      qty: i.qty,
      unitPrice: Number(i.unitPrice),
      optionsJson: i.optionsJson ?? null,
      extrasJson: i.extrasJson ?? null,
      notes: i.notes ?? null,
    }));
  }

  /**
   * Content signature of a cart. Row ids and timestamps are excluded on purpose
   * (they change on every NLU pass), and so is the written-address staff flag.
   */
  private cartSignature(lines: CartSnapshotLine[], orderNotes: string | null | undefined): string {
    const optKey = (o: any) =>
      Array.isArray(o) ? o.map((x: any) => `${x.groupName}:${x.optionName}`).sort().join('|') : '';
    return (
      lines
        .map((l) => `${l.menuItemId}|${optKey(l.optionsJson)}|${l.qty}|${l.unitPrice.toFixed(2)}|${l.notes || ''}|${JSON.stringify(l.extrasJson ?? null)}`)
        .sort()
        .join('\n') + `#${this.stripTypedAddressNote(orderNotes) || ''}`
    );
  }

  /** Fresh read — ctx.conversation.flowMetadata is a turn-start snapshot. */
  private async readFlowMeta(conversationId: string): Promise<Record<string, any>> {
    try {
      const c = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { flowMetadata: true },
      });
      const parsed = JSON.parse(c?.flowMetadata || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  /** Merge into flowMetadata; other flows' keys (inactivity, parent order...) are preserved. */
  private async writeFlowMeta(conversationId: string, patch: Record<string, unknown>): Promise<void> {
    const meta: Record<string, unknown> = { ...(await this.readFlowMeta(conversationId)), ...patch };
    for (const k of Object.keys(meta)) {
      const v = meta[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0)) delete meta[k];
    }
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { flowMetadata: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null },
    });
  }

  /** Sepet olusmadan gelen teslimat talimatlari (en fazla 3, 2 saat saklanir). */
  private async pushPreDraftDeliveryNote(conversationId: string, note: string): Promise<void> {
    const ttlMs = 2 * 60 * 60 * 1000;
    try {
      const meta = await this.readFlowMeta(conversationId);
      const list = (Array.isArray(meta.preDraftDeliveryNotes) ? meta.preDraftDeliveryNotes : []).filter(
        (n: any) => n && typeof n.text === 'string' && Date.now() - Date.parse(n.at) < ttlMs,
      );
      const text = note.substring(0, 200);
      if (!list.some((n: any) => n.text === text)) list.push({ text, at: new Date().toISOString() });
      await this.writeFlowMeta(conversationId, { preDraftDeliveryNotes: list.slice(-3) });
    } catch (error) {
      logger.warn({ error, conversationId }, 'Failed to store pre-draft delivery note');
    }
  }

  /** Saklanan talimatlari taslak siparise "Teslimat notu:" olarak yazar ve temizler. */
  private async applyPreDraftDeliveryNotes(ctx: FlowContext, order: any): Promise<void> {
    const ttlMs = 2 * 60 * 60 * 1000;
    try {
      const meta = await this.readFlowMeta(ctx.conversationId);
      if (!Array.isArray(meta.preDraftDeliveryNotes)) return;
      const list = meta.preDraftDeliveryNotes.filter(
        (n: any) => n && typeof n.text === 'string' && Date.now() - Date.parse(n.at) < ttlMs,
      );
      await this.writeFlowMeta(ctx.conversationId, { preDraftDeliveryNotes: undefined });
      for (const n of list) {
        if (!String(order?.notes || '').includes(n.text)) {
          await this.appendOrderNote(order, `Teslimat notu: ${n.text}`);
        }
      }
    } catch (error) {
      logger.warn({ error, conversationId: ctx.conversationId }, 'Failed to apply pre-draft delivery notes');
    }
  }

  private async pushMidFlowChange(conversationId: string, rec: MidFlowChangeRecord): Promise<void> {
    try {
      const meta = await this.readFlowMeta(conversationId);
      const list: MidFlowChangeRecord[] = (Array.isArray(meta.midFlowChanges) ? meta.midFlowChanges : []).filter(
        (r: MidFlowChangeRecord) => r && r.orderId === rec.orderId && Date.now() - Date.parse(r.at) < MID_FLOW_UNDO_TTL_MS,
      );
      list.push(rec);
      await this.writeFlowMeta(conversationId, { midFlowChanges: list.slice(-MID_FLOW_UNDO_MAX) });
    } catch (error) {
      logger.warn({ error, conversationId }, 'Failed to record mid-flow change');
    }
  }

  private async interceptMidFlowUndo(ctx: FlowContext, phase: ConversationPhase): Promise<ConversationPhase | null> {
    const { message, payload } = ctx;
    if (message.kind !== 'TEXT' || payload.interactive?.buttonReply?.id || payload.interactive?.listReply?.id) {
      return null;
    }
    const kind = isUndoLastChangeIntent(message.text || '');
    if (!kind) return null;
    return this.handleMidFlowUndo(ctx, phase, kind);
  }

  /**
   * Undo the last recorded mid-flow cart change. Returns null when the message
   * is not handled ('soft' with no change right before it → the caller's
   * normal branches run). Never runs the NLU, never cancels the order.
   */
  private async handleMidFlowUndo(
    ctx: FlowContext,
    phase: ConversationPhase,
    kind: 'undo' | 'soft',
  ): Promise<ConversationPhase | null> {
    const { tenantId, conversationId, message } = ctx;
    const draft = await this.getActiveOrder(ctx);
    if (!draft || draft.items.length === 0) {
      if (kind === 'soft') return null;
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    const meta = await this.readFlowMeta(conversationId);
    const all: MidFlowChangeRecord[] = Array.isArray(meta.midFlowChanges) ? meta.midFlowChanges : [];
    const live = all.filter(
      (r) => r && r.orderId === draft.id && Date.now() - Date.parse(r.at) < MID_FLOW_UNDO_TTL_MS,
    );
    const rec = live[live.length - 1];

    if (kind === 'soft') {
      // A bare "istemiyorum" only undoes a change made by the immediately previous message.
      if (!rec) return null;
      const prevIn = await prisma.message.findFirst({
        where: { conversationId, tenantId, direction: 'IN', id: { not: message.id } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!prevIn || prevIn.id !== rec.messageId) return null;
    }

    const currentSig = this.cartSignature(this.snapshotCart(draft), draft.notes);
    if (!rec || rec.before.length === 0 || currentSig !== rec.afterSignature) {
      if (live.length !== all.length) await this.writeFlowMeta(conversationId, { midFlowChanges: live });
      // Nothing we can safely revert (no recent change, or the cart changed
      // since): show the cart and ask.
      await this.sendText(ctx, TEMPLATES.midFlowUndoNothing(this.buildOrderSummary(draft)));
      return this.repromptCurrentStep(ctx, phase);
    }

    // Keep a written-address flag added after the change.
    const flagPart = (draft.notes || '').split(' | ').find((p) => p.startsWith(TYPED_ADDRESS_NOTE));
    const baseNotes = this.stripTypedAddressNote(rec.beforeNotes);
    const notes = flagPart ? (baseNotes ? `${flagPart} | ${baseNotes}` : flagPart) : baseNotes;

    await prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId: draft.id } });
      await tx.order.update({
        where: { id: draft.id },
        data: {
          // Restoring the stored total also restores a pickup discount.
          totalPrice: rec.beforeTotal,
          notes,
          items: {
            create: rec.before.map((l) => ({
              menuItemId: l.menuItemId,
              menuItemName: l.menuItemName,
              qty: l.qty,
              unitPrice: l.unitPrice,
              optionsJson: l.optionsJson ?? undefined,
              extrasJson: l.extrasJson ?? undefined,
              notes: l.notes,
            })),
          },
        },
      });
    });

    const remaining = live.slice(0, -1);
    await this.writeFlowMeta(conversationId, { midFlowChanges: remaining });
    logger.info(
      { tenantId, conversationId, orderId: draft.id, sourceMessageId: rec.messageId, phase },
      'Mid-flow change undone',
    );

    const restored = await this.getActiveOrder(ctx);
    let reply = TEMPLATES.midFlowUndoDone(this.buildOrderSummary(restored || draft), remaining.length > 0);
    if (kind === 'soft') reply += '\n\nSiparisin tamamini iptal etmek isterseniz *iptal* yazin.';
    await this.sendText(ctx, reply);
    return this.repromptCurrentStep(ctx, phase);
  }

  /** Recreate a draft the NLU deleted, pointing the conversation at it. */
  private async recreateDraft(ctx: FlowContext, source: any, lines: CartSnapshotLine[], phase: ConversationPhase) {
    const restored = await prisma.order.create({
      data: {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        customerPhone: ctx.conversation.customerPhone,
        status: 'DRAFT',
        totalPrice: Number(source.totalPrice),
        notes: source.notes ?? null,
        deliveryType: source.deliveryType ?? null,
        deliveryAddress: source.deliveryAddress ?? null,
        discountPercent: source.discountPercent ?? null,
        discountAmount: source.discountAmount ?? null,
        storeId: source.storeId ?? null,
        items: {
          // `tenantId` / `sortOrder` are not OrderItem columns (see handleOrderReview)
          create: lines.map((l) => ({
            menuItemId: l.menuItemId,
            menuItemName: l.menuItemName,
            qty: l.qty,
            unitPrice: l.unitPrice,
            optionsJson: l.optionsJson ?? undefined,
            extrasJson: l.extrasJson ?? undefined,
            notes: l.notes,
          })),
        },
      },
      include: { items: true },
    });
    await inboxService.updateConversationPhase(ctx.tenantId, ctx.conversationId, phase, restored.id);
    ctx.conversation.activeOrderId = restored.id;
    return restored;
  }

  /** Re-send the prompt of the step the customer is on. */
  private async repromptCurrentStep(ctx: FlowContext, phase: ConversationPhase): Promise<ConversationPhase> {
    const { tenantId, conversationId } = ctx;
    switch (phase) {
      case 'DELIVERY_TYPE_SELECTION':
        return this.proceedToDeliveryTypeSelection(ctx);
      case 'LOCATION_REQUEST':
        await whatsappService.sendLocationRequest(tenantId, conversationId, TEMPLATES.locationRequest);
        return 'LOCATION_REQUEST';
      case 'ADDRESS_SELECTION': {
        const order = await this.getActiveOrder(ctx);
        if (await this.sendSavedAddressList(ctx, order?.deliveryAddress ?? null)) return 'ADDRESS_SELECTION';
        await whatsappService.sendLocationRequest(tenantId, conversationId, TEMPLATES.locationRequest);
        return 'LOCATION_REQUEST';
      }
      case 'ADDRESS_COLLECTION': {
        const order = await this.getActiveOrder(ctx);
        if (order?.deliveryAddress) {
          const tmpl = TEMPLATES.addressConfirmButtons;
          await whatsappService.sendInteractiveButtons(tenantId, conversationId, tmpl.body, tmpl.buttons);
        } else {
          await this.sendText(ctx, TEMPLATES.addressRequest);
        }
        return 'ADDRESS_COLLECTION';
      }
      case 'ADDRESS_SAVE_PROMPT': {
        const sub = ctx.conversation.flowSubState || 'WAITING_SAVE_CONFIRM';
        if (sub === 'WAITING_ADDRESS_NAME_CUSTOM') {
          await this.sendText(ctx, 'Lutfen adres icin bir isim yazin:');
        } else {
          const tmpl = sub === 'WAITING_ADDRESS_NAME' ? TEMPLATES.askAddressNameButtons : TEMPLATES.askSaveAddressButtons;
          await whatsappService.sendInteractiveButtons(tenantId, conversationId, tmpl.body, tmpl.buttons);
        }
        return 'ADDRESS_SAVE_PROMPT';
      }
      case 'PAYMENT_METHOD_SELECTION':
        await this.sendPaymentButtons(ctx);
        return 'PAYMENT_METHOD_SELECTION';
      case 'PAYMENT_PENDING': {
        const orderId = ctx.conversation.activeOrderId;
        const pending = orderId ? await orderPaymentService.getPendingPayment(tenantId, orderId) : null;
        if (pending?.checkoutFormUrl) {
          await this.sendText(ctx, TEMPLATES.reminderPayment(pending.checkoutFormUrl));
          return 'PAYMENT_PENDING';
        }
        await this.sendPaymentButtons(ctx);
        return 'PAYMENT_METHOD_SELECTION';
      }
      default:
        return phase;
    }
  }

  // ==================== WRITTEN ADDRESS / OUT OF AREA ====================

  /**
   * Did the text name a menu item? Fresh candidate search for THIS text only
   * (no carried-over context candidates).
   */
  private async menuMatchInCurrentText(ctx: FlowContext, rawText: string): Promise<boolean> {
    return (await this.findMenuMatch(ctx, rawText)).matched;
  }

  /** Strong menu match in THIS text (score >= 0.5 or a whole-word name/synonym) and the product's name. */
  private async findMenuMatch(ctx: FlowContext, rawText: string): Promise<{ matched: boolean; name: string | null }> {
    try {
      const cands = await menuCandidateService.findCandidates(ctx.tenantId, rawText);
      const best = cands.slice().sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 0.5) return { matched: true, name: best.name };
      const named = cands.find((c) => mentionsMenuItemName([c.name], c.synonymsMatched || [], rawText));
      return named ? { matched: true, name: named.name } : { matched: false, name: null };
    } catch {
      return { matched: false, name: null };
    }
  }

  /**
   * Payment questions are answered in ANY phase — they must never be saved as
   * an address, submitted as a cash order, or sent to the NLU.
   * Returns the phase to stay in, or null when the text is not a payment question.
   */
  private async tryAnswerPaymentQuestion(
    ctx: FlowContext,
    rawText: string,
    phase: ConversationPhase,
    confirmedOrder?: { orderNumber: number | null; totalPrice: unknown; paymentMethod: string | null } | null,
  ): Promise<ConversationPhase | null> {
    const { message, payload } = ctx;
    if (!rawText || message.kind !== 'TEXT') return null;
    if (payload.interactive?.buttonReply?.id || payload.interactive?.listReply?.id) return null;
    const q = isPaymentQuestion(rawText);
    if (!q.asked) return null;
    // At the payment step "nakit" / "kapida kart" still select a method; only a real question is answered.
    if (
      (phase === 'PAYMENT_METHOD_SELECTION' || phase === 'PAYMENT_PENDING') &&
      !q.bankTransfer && !q.amount && !textHasQuestionSignal(rawText)
    ) {
      return null;
    }

    try {
      if (confirmedOrder) {
        await this.sendText(
          ctx,
          TEMPLATES.paymentInfoConfirmed(
            confirmedOrder.orderNumber || 0,
            Number(confirmedOrder.totalPrice),
            confirmedOrder.paymentMethod,
            q.bankTransfer,
          ),
        );
        return phase;
      }

      const order = await this.getDraftOrder(ctx);
      const hasCart = !!order && order.items.length > 0;
      const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { iyzicoApiKey: true, iyzicoSecretKey: true },
      });
      const isPickup = order?.deliveryType === 'PICKUP';
      let deliveryFee: number | null = null;
      let feeIsEstimate = false;
      if (order && hasCart && !isPickup) {
        const geo = order.deliveryType === 'DELIVERY' && !this.isTypedAddressOrder(order)
          ? await this.getFreshGeoCheck(ctx)
          : null;
        if (geo?.isWithinServiceArea && geo.deliveryRule) {
          deliveryFee = Number(geo.deliveryRule.deliveryFee);
        } else {
          deliveryFee = (await geoService.getTypedAddressTerms(ctx.tenantId, null)).deliveryFee;
          feeIsEstimate = true;
        }
      }
      const preConfirm = phase === 'IDLE' || phase === 'ORDER_COLLECTING' || phase === 'ORDER_REVIEW';
      await this.sendText(
        ctx,
        TEMPLATES.paymentInfo({
          subtotal: order && hasCart ? Number(order.totalPrice) : null,
          isPickup,
          deliveryFee,
          feeIsEstimate,
          // iyzico refuses to create a link without tenant keys
          onlineEnabled: !!(tenant?.iyzicoApiKey && tenant?.iyzicoSecretKey),
          bankTransferAsked: q.bankTransfer,
          preConfirm,
        }),
      );
      return preConfirm ? phase : this.repromptCurrentStep(ctx, phase);
    } catch (error) {
      logger.warn({ error, conversationId: ctx.conversationId }, 'Payment question answer failed');
      return null;
    }
  }

  /**
   * Continue the order with a WRITTEN address (no pin, or an out-of-area pin
   * the customer disputes). Staff verifies the area: the order carries a flag
   * note and the staff alert shows a warning.
   */
  private async acceptTypedAddress(
    ctx: FlowContext,
    addressText: string,
    opts?: { outOfAreaGeo?: GeoCheckResult | null },
  ): Promise<ConversationPhase> {
    const { tenantId, conversationId } = ctx;
    const order = await this.getActiveOrder(ctx);
    if (!order || order.items.length === 0) {
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    const address = this.joinParked(order.deliveryAddress, addressText);

    // An in-area pin for this order already exists (sent before Onayla): keep
    // it and confirm the address with it. Flagging the order and clearing the
    // coordinates threw away the exact spot the customer's "konuma gelince"
    // note refers to, and asked staff to verify an area the pin had verified.
    const pinGeo = await this.getFreshGeoCheck(ctx);
    if (pinGeo?.isWithinServiceArea && ctx.conversation.customerLat != null) {
      await prisma.order.update({
        where: { id: order.id },
        data: { deliveryType: 'DELIVERY', deliveryAddress: address },
      });
      return this.processGeoResult(ctx, pinGeo);
    }
    const oos = opts?.outOfAreaGeo ?? null;
    const terms = await geoService.getTypedAddressTerms(tenantId, oos?.nearestStore?.id ?? null);

    // Same rule as a pin: the smallest zone minimum still applies.
    const total = Number(order.totalPrice);
    if (terms.minBasket && total < terms.minBasket) {
      await prisma.order.update({ where: { id: order.id }, data: { deliveryAddress: address } });
      await this.sendText(ctx, TEMPLATES.locationMinBasketNotMet(terms.minBasket, total));
      return 'ORDER_COLLECTING';
    }

    // The flag goes FIRST so the 240-char note cap of later NLU merges cannot drop it.
    const flag =
      TYPED_ADDRESS_NOTE +
      (oos ? (oos.distance != null ? ` - paylasilan konum ${oos.distance.toFixed(1)} km (servis alani disi)` : ' - paylasilan konum servis alani disi') : '');
    const otherNotes = this.stripTypedAddressNote(order.notes);
    const notes = otherNotes ? `${flag} | ${otherNotes}` : flag;

    await prisma.order.update({
      where: { id: order.id },
      data: {
        deliveryType: 'DELIVERY',
        deliveryAddress: address,
        notes,
        ...(terms.store ? { storeId: terms.store.id } : {}),
      },
    });
    // Clear conversation geo data: a stale or out-of-area pin must not become
    // the staff map link, nor be saved as this address's coordinates.
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        nearestStoreId: terms.store?.id ?? null,
        isWithinService: null,
        geoCheckJson: Prisma.DbNull,
        customerLat: null,
        customerLng: null,
      },
    });
    Object.assign(ctx.conversation, {
      nearestStoreId: terms.store?.id ?? null,
      isWithinService: null,
      geoCheckJson: null,
      customerLat: null,
      customerLng: null,
    });

    logger.info(
      { tenantId, conversationId, orderId: order.id, outOfAreaPin: !!oos },
      'Written delivery address accepted (no verified pin)',
    );

    await this.sendText(ctx, TEMPLATES.typedAddressAccepted(address, terms.store?.name ?? null, terms.deliveryFee));
    const tmpl = TEMPLATES.addressConfirmButtons;
    await whatsappService.sendInteractiveButtons(tenantId, conversationId, tmpl.body, tmpl.buttons);
    return 'ADDRESS_COLLECTION';
  }

  private isTypedAddressOrder(order: { notes?: string | null } | null | undefined): boolean {
    return !!order?.notes && order.notes.includes(TYPED_ADDRESS_NOTE);
  }

  private stripTypedAddressNote(notes: string | null | undefined): string | null {
    // Shared with the orchestrator's summary (message-templates)
    return stripTypedAddressFlag(notes);
  }

  /** Append a delivery note to the order (deduplicated, ' | '-separated, never overwrites). */
  private async appendOrderNote(order: { id: string; notes: string | null }, note: string): Promise<void> {
    const n = note.trim().substring(0, 160);
    if (!n) return;
    const existing = order.notes || '';
    if (foldTr(existing).includes(foldTr(n))) return;
    const notes = existing ? `${existing} | ${n}` : n;
    await prisma.order.update({ where: { id: order.id }, data: { notes } });
    order.notes = notes;
  }

  private joinParked(previous: string | null | undefined, next: string): string {
    const prev = (previous || '').trim();
    const cur = (next || '').trim();
    if (!prev) return cur.substring(0, 400);
    if (!cur) return prev.substring(0, 400);
    const fp = foldTr(prev);
    const fc = foldTr(cur);
    if (fc.includes(fp)) return cur.substring(0, 400);
    if (fp.includes(fc)) return prev.substring(0, 400);
    return `${prev}, ${cur}`.substring(0, 400);
  }

  /** Filler replies ("tamam bir dakika", "tamam dogru", "kolay gelsin") are not an address. */
  private isChatter(rawText: string): boolean {
    const filler = new Set([
      'tamam', 'tamamdir', 'ok', 'okey', 'peki', 'olur', 'evet', 'hayir', 'tesekkurler', 'tesekkur', 'ederim',
      'sagol', 'sagolun', 'bekle', 'bekleyin', 'dakika', 'saniye', 'bir', 'hmm', 'anladim', 'simdi', 'hemen', 'bi',
      'dogru', 'guzel', 'super', 'harika', 'adres', 'adresim', 'bu', 'merhaba', 'selam', 'kolay', 'gelsin',
      'iyi', 'gunler', 'aksamlar', 'abi', 'hocam', 'efendim', 'ya', 'yok', 'aynen', 'tabi', 'tabii',
    ]);
    const ws = foldedWords(rawText);
    return ws.length > 0 && ws.every((w) => filler.has(w));
  }

  /**
   * Could this text be a written address? Not a question, filler, "wait, I am
   * typing", complaint, refusal, payment question, undo or cancel. Without this
   * "tamam yaziyorum" became the delivery address and reached staff.
   */
  private isPlausibleAddressReply(rawText: string): boolean {
    const raw = (rawText || '').trim();
    if (!raw || foldedWords(raw).length === 0) return false;
    if (textHasQuestionSignal(raw) || this.isChatter(raw) || isAddressWaitReply(raw)) return false;
    // Adres kaniti ("Camiye yakin Gul sokak no 3", "Acik adresim: Orhangazi Mah. ...")
    // sikayet/ret kelimelerinden ONCE gelir. Pin sonrasi adres adimi eskiden her
    // metni kabul ediyordu; "yakin", "acik adres" iceren tam adresi reddetmek o
    // normal akisi kiran bir gerilemeydi (dogrulama bulgusu, 14.09).
    if (hasAddressEvidence(raw) && !isPaymentQuestion(raw).asked) return true;
    if (isAreaComplaint(raw) || isConfusionAboutCart(raw) || isLocationRefusal(raw)) return false;
    if (isPaymentQuestion(raw).asked || isUndoLastChangeIntent(raw)) return false;
    return !this.isFullCancelIntent(raw);
  }

  /**
   * Cancel in the post-confirm steps. isFullCancelIntent only knows exact short
   * phrases, so "iptal edin", "siparisi iptal etmek istiyorum" or "vazgectim"
   * no longer cancelled — they were re-prompted or even saved as the address.
   * A word starting iptal/vazgec counts in a short text, unless it is an address
   * ("Vazgecmez Sok. 4"), a refusal or names a menu item ("kolayi iptal" is a removal).
   */
  private async isStepCancelIntent(ctx: FlowContext, rawText: string): Promise<boolean> {
    const raw = (rawText || '').trim();
    if (!raw || ctx.message.kind !== 'TEXT') return false;
    if (ctx.payload.interactive?.buttonReply?.id || ctx.payload.interactive?.listReply?.id) return false;
    if (this.isFullCancelIntent(raw)) return true;
    const ws = foldedWords(raw);
    if (ws.length === 0 || ws.length > 5) return false;
    if (!ws.some((w) => w.startsWith('iptal') || w.startsWith('vazgec'))) return false;
    if (classifyAddressText(raw).kind !== 'none') return false;
    if (isLocationRefusal(raw) || isPaymentQuestion(raw).asked) return false;
    return !(await this.menuMatchInCurrentText(ctx, raw));
  }

  /** Did we already ask for a written address for THIS order? (history marker, survives sub-state resets) */
  private async hasAskedForAddress(ctx: FlowContext, order: { createdAt?: Date | string } | null): Promise<boolean> {
    try {
      const found = await prisma.message.findFirst({
        where: {
          conversationId: ctx.conversationId,
          tenantId: ctx.tenantId,
          direction: 'OUT',
          text: { contains: ADDRESS_ASK_MARKER },
          ...(order?.createdAt ? { createdAt: { gte: new Date(order.createdAt) } } : {}),
        },
        select: { id: true },
      });
      return !!found;
    } catch {
      return false;
    }
  }

  /**
   * The stored geo check, only when it belongs to a pin sent for the CURRENT
   * order. geoCheckJson lives on the conversation (one per customer), so
   * without this a days-old out-of-area result would steer today's order.
   */
  private async getFreshGeoCheck(ctx: FlowContext): Promise<GeoCheckResult | null> {
    try {
      const geo = await inboxService.getConversationGeoCheck(ctx.tenantId, ctx.conversationId);
      if (!geo) return null;
      const lastPin = await prisma.message.findFirst({
        where: { conversationId: ctx.conversationId, tenantId: ctx.tenantId, direction: 'IN', kind: 'LOCATION' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (!lastPin) return null;
      const pinAt = new Date(lastPin.createdAt).getTime();
      const order = await this.getActiveOrder(ctx);
      if (order && pinAt >= new Date(order.createdAt).getTime()) return geo;
      // A pin sent shortly BEFORE this draft existed (while the customer was
      // still choosing, or while the old gate held the chat and the draft was
      // replayed later) belongs to this order too — unless an earlier order was
      // finalised after it (then the pin was that order's).
      if (Date.now() - pinAt > PRE_ORDER_PIN_MAX_AGE_MS) return null;
      const usedByEarlierOrder = await prisma.order.findFirst({
        where: {
          tenantId: ctx.tenantId,
          conversationId: ctx.conversationId,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          updatedAt: { gte: new Date(pinAt) },
          ...(order ? { id: { not: order.id } } : {}),
        },
        select: { id: true },
      });
      return usedByEarlierOrder ? null : geo;
    } catch {
      return null;
    }
  }

  private async getFreshOutOfAreaGeo(ctx: FlowContext): Promise<GeoCheckResult | null> {
    const geo = await this.getFreshGeoCheck(ctx);
    return geo && !geo.isWithinServiceArea ? geo : null;
  }

  /**
   * Distance worth quoting to the customer. Beyond ~3x the radius the pin is
   * almost always wrong (another city, a default GPS fix): "312.4 km" insults
   * the customer and invites the "size cok yakin" argument.
   */
  private meaningfulOosDistance(geo: GeoCheckResult): { distanceKm: number; radiusKm: number } | null {
    if (geo.isWithinServiceArea) return null;
    if (geo.reason && geo.reason !== 'OUT_OF_RADIUS') return null;
    const d = geo.distance;
    const r = geo.maxRadiusKm;
    if (typeof d !== 'number' || !Number.isFinite(d) || typeof r !== 'number' || !(r > 0)) return null;
    if (d <= r || d > Math.max(r * 3, 15)) return null;
    return { distanceKm: d, radiusKm: r };
  }

  /** Out-of-area pin: one message with the three ways forward (the cart is kept). */
  private async sendOutOfAreaOptions(ctx: FlowContext, geo: GeoCheckResult, lead?: string): Promise<ConversationPhase> {
    const { tenantId, conversationId } = ctx;
    if (geo.reason === 'NO_OPEN_STORE') {
      const activeStores = await prisma.store.count({ where: { tenantId, isActive: true } });
      if (activeStores > 0) {
        // Every branch is closed: pickup is impossible too.
        await this.sendText(ctx, TEMPLATES.storeClosed);
      } else {
        // No branch configured: a pin cannot be checked at all, a written address can.
        await this.sendText(ctx, TEMPLATES.typedAddressPrompt);
      }
      return 'LOCATION_REQUEST';
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { pickupDiscountPercent: true },
    });
    const dist = this.meaningfulOosDistance(geo);
    if (lead) await this.sendText(ctx, lead);
    await whatsappService.sendInteractiveButtons(
      tenantId,
      conversationId,
      TEMPLATES.locationOutOfService({
        distanceKm: dist?.distanceKm ?? null,
        radiusKm: dist?.radiusKm ?? null,
        pickupDiscountPercent: tenant?.pickupDiscountPercent ?? null,
      }),
      TEMPLATES.locationOutOfServiceButtons,
    );
    return 'LOCATION_REQUEST';
  }

  private async sendOutOfAreaComplaint(ctx: FlowContext, geo: GeoCheckResult): Promise<ConversationPhase> {
    const dist = this.meaningfulOosDistance(geo);
    await whatsappService.sendInteractiveButtons(
      ctx.tenantId,
      ctx.conversationId,
      TEMPLATES.outOfAreaComplaint({
        distanceKm: dist?.distanceKm ?? null,
        radiusKm: dist?.radiusKm ?? null,
        storeName: geo.nearestStore?.name ?? null,
        storePhone: geo.nearestStore?.phone ?? null,
      }),
      TEMPLATES.locationOutOfServiceButtons,
    );
    return 'LOCATION_REQUEST';
  }

  /** Gel Al (pickup). The discount is applied once — a second tap must not compound it. */
  private async switchToPickup(
    ctx: FlowContext,
    order: any,
    opts?: { fromOutOfArea?: boolean },
  ): Promise<ConversationPhase> {
    // `deliveryAddress: null` clears an address the customer may have typed
    // BEFORE confirming (the pre-confirm guard parks it on the draft). A
    // pickup order must never carry a delivery address onto the kitchen ticket.
    const updateData: any = {
      deliveryType: 'PICKUP',
      deliveryAddress: null,
      notes: this.stripTypedAddressNote(order.notes),
    };
    const prefix = opts?.fromOutOfArea ? 'Sepetiniz aynen korundu. ' : '';

    const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
    if (tenant?.pickupDiscountPercent && tenant.pickupDiscountPercent > 0 && !order.discountPercent) {
      const totalPrice = Number(order.totalPrice);
      const discountAmount = Math.round(totalPrice * tenant.pickupDiscountPercent) / 100;
      const newTotal = totalPrice - discountAmount;
      updateData.discountPercent = tenant.pickupDiscountPercent;
      updateData.discountAmount = discountAmount;
      updateData.totalPrice = newTotal;

      await prisma.order.update({ where: { id: order.id }, data: updateData });
      await this.sendText(
        ctx,
        `${prefix}Gel al secildi! %${tenant.pickupDiscountPercent} indirim uygulandı (${discountAmount.toFixed(2)} TL indirim). Yeni toplam: ${newTotal.toFixed(2)} TL`,
      );
    } else {
      await prisma.order.update({ where: { id: order.id }, data: updateData });
      await this.sendText(ctx, `${prefix}Gel al secildi!`);
    }

    // Skip address flow — go directly to payment
    await this.sendPaymentButtons(ctx);
    return 'PAYMENT_METHOD_SELECTION';
  }

  /**
   * A pin: use the geo check stored for THIS pin. whatsapp.service stores one on
   * receipt, but if that call failed geoCheckJson still holds the PREVIOUS
   * pin's result (and the test console stores none) — recompute then.
   */
  private async processLocationPin(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, payload } = ctx;
    const lat = payload.location!.latitude;
    const lng = payload.location!.longitude;
    const conv = await inboxService.getConversationRaw(tenantId, conversationId);
    let geoCheck = await inboxService.getConversationGeoCheck(tenantId, conversationId);
    if (!geoCheck || conv?.customerLat !== lat || conv?.customerLng !== lng) {
      geoCheck = await geoService.checkServiceArea(tenantId, { lat, lng });
      await inboxService.updateConversationGeoCheck(tenantId, conversationId, geoCheck, { lat, lng });
    }
    return this.processGeoResult(ctx, geoCheck);
  }

  /** Saved-address list (+ the address typed earlier as the first row). False when none are saved. */
  private async sendSavedAddressList(ctx: FlowContext, parkedAddress: string | null): Promise<boolean> {
    const savedAddresses = await savedAddressService.getByCustomerPhone(
      ctx.tenantId, ctx.conversation.customerPhone,
    );
    if (savedAddresses.length === 0) return false;

    // WhatsApp lists allow 10 rows: parked row + 8 saved + "Yeni Adres".
    const rows: Array<{ id: string; title: string; description: string }> = [];
    if (parkedAddress) {
      rows.push({
        id: 'use_parked_address',
        title: TEMPLATES.parkedAddressRowTitle,
        description: parkedAddress.substring(0, 72),
      });
    }
    for (const addr of savedAddresses.slice(0, parkedAddress ? 8 : 9)) {
      rows.push({
        id: `saved_addr_${addr.id}`,
        title: addr.name.substring(0, 24),
        description: addr.address.substring(0, 72),
      });
    }
    rows.push({
      id: 'new_address',
      title: TEMPLATES.newAddressRowTitle,
      description: TEMPLATES.newAddressRowDescription,
    });

    await whatsappService.sendListMessage(
      ctx.tenantId,
      ctx.conversationId,
      TEMPLATES.savedAddressListHeader,
      TEMPLATES.savedAddressListButton,
      [{ title: 'Adresler', rows }],
    );
    return true;
  }

  private async transcribeVoice(ctx: FlowContext): Promise<string | null> {
    const voiceId = (ctx.message.payloadJson as any)?.voiceId;
    if (!voiceId || !whisperService.isAvailable()) return null;
    try {
      return (await whisperService.transcribeVoiceMessage(ctx.tenantId, voiceId)) || null;
    } catch {
      return null;
    }
  }

  // ==================== LEGACY NEGATIVE-CONSTRAINT HOLD ====================

  /** The wording of the old gate's reply (fallback template or the Claude version). */
  private isConstraintGateReply(text: string): boolean {
    const t = foldTr(text);
    if (t.includes('ozel isteginizi not aldim')) return true;
    return t.includes('gorevli') && ['kontrol', 'onayla', 'donus'].some((w) => t.includes(w));
  }

  /**
   * A PENDING_AGENT status that ONLY the old gate produced: its reply is the
   * last bot message and no human acted since (no assignment, no staff reply,
   * no manual handoff). New bot replies never use this wording, so a status a
   * person sets later cannot match. Returns null for every real takeover.
   */
  private async findLegacyConstraintGateHold(ctx: FlowContext): Promise<LegacyGateHold | null> {
    const { tenantId, conversationId } = ctx;
    try {
      const assignment = await prisma.conversationAssignment.findUnique({ where: { conversationId } });
      if (assignment) return null;

      const gateReply = await prisma.message.findFirst({
        where: { conversationId, tenantId, direction: 'OUT', kind: 'TEXT', senderUserId: null },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, text: true },
      });
      if (!gateReply?.text || !this.isConstraintGateReply(gateReply.text)) return null;

      const humanAction = await prisma.message.findFirst({
        where: {
          conversationId,
          tenantId,
          direction: 'OUT',
          createdAt: { gt: gateReply.createdAt },
          OR: [{ senderUserId: { not: null } }, { kind: 'SYSTEM' }],
        },
        select: { id: true },
      });
      if (humanAction) return null;

      const heldMessage = await prisma.message.findFirst({
        where: { conversationId, tenantId, direction: 'IN', kind: 'TEXT', createdAt: { lt: gateReply.createdAt } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, text: true },
      });
      return { gateReplyAt: new Date(gateReply.createdAt), heldMessage };
    } catch (error) {
      // Cannot verify → stay silent (the safe side for a real takeover)
      logger.warn({ error, tenantId, conversationId }, 'Legacy gate hold check failed');
      return null;
    }
  }

  /**
   * Reopen a conversation the old gate parked. A fresh hold (<= 2h) replays
   * the held order message through the current pipeline (the request becomes an
   * order note); an older one restarts cleanly. Never silence.
   */
  private async resumeFromConstraintGateHold(
    ctx: FlowContext,
    hold: LegacyGateHold,
  ): Promise<{ handled: true } | { handled: false; phase: ConversationPhase }> {
    const { tenantId, conversationId, message } = ctx;

    // Race-safe: if a person changed the status meanwhile, stay out of it.
    const reopened = await prisma.conversation.updateMany({
      where: { id: conversationId, tenantId, status: 'PENDING_AGENT' },
      data: { status: 'OPEN' },
    });
    if (reopened.count === 0) {
      // Lost the race to a concurrent turn for the same chat. If THAT turn
      // reopened it, this message is processed normally — returning here
      // dropped it without any reply.
      const current = await inboxService.getConversationRaw(tenantId, conversationId);
      if (!current || current.status !== 'OPEN') return { handled: true };
      const lock = await prisma.conversationLock.findUnique({ where: { conversationId } });
      if (lock && (!lock.expiresAt || new Date(lock.expiresAt).getTime() > Date.now())) return { handled: true };
      Object.assign(ctx.conversation, current);
      return { handled: false, phase: (current.phase as ConversationPhase) || 'IDLE' };
    }
    ctx.conversation.status = 'OPEN';
    logger.info(
      { tenantId, conversationId, gateReplyAt: hold.gateReplyAt.toISOString() },
      'Resuming bot after legacy negative-constraint hold',
    );

    const phase = (ctx.conversation.phase as ConversationPhase) || 'IDLE';
    const fresh = Date.now() - hold.gateReplyAt.getTime() <= LEGACY_HOLD_REPLAY_MS;

    try {
      if (fresh && hold.heldMessage?.text && ['IDLE', 'ORDER_COLLECTING', 'ORDER_REVIEW'].includes(phase)) {
        const r = await nluOrchestratorService.processMessage(
          tenantId, conversationId, hold.heldMessage.id, hold.heldMessage.text,
        );
        let replayed = false;
        if (r.pendingOptionSelection && r.clarificationQuestion) {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { flowSubState: 'OPTION_SELECTION', activeOrderId: r.draftOrderId || ctx.conversation.activeOrderId },
          });
          await inboxService.updateConversationPhase(tenantId, conversationId, 'ORDER_COLLECTING');
          await this.sendText(ctx, 'Az once yazdiginiz siparise devam edelim.');
          await this.sendOptionSelectionList(ctx, r.pendingOptionSelection);
          replayed = true;
        } else if (r.draftOrderId && r.confirmationMessage) {
          await inboxService.updateConversationPhase(tenantId, conversationId, 'ORDER_REVIEW', r.draftOrderId);
          ctx.conversation.activeOrderId = r.draftOrderId;
          ctx.conversation.phase = 'ORDER_REVIEW';
          await this.sendText(ctx, 'Az once yazdiginiz siparisi ozel isteginizle birlikte hazirladim, kontrol edip onaylar misiniz?');
          await this.sendOrderConfirmButtons(ctx, r.confirmationMessage);
          await this.checkMinBasketWarning(ctx, r.draftOrderId);
          replayed = true;
        } else if (r.clarificationQuestion) {
          await inboxService.updateConversationPhase(tenantId, conversationId, 'ORDER_COLLECTING');
          ctx.conversation.phase = 'ORDER_COLLECTING';
          await this.sendText(ctx, r.clarificationQuestion);
          replayed = true;
        }

        if (replayed) {
          // Acknowledge what the customer sent while the bot was silent.
          if (message.kind === 'LOCATION') {
            // True now: getFreshGeoCheck accepts a pin sent before the replayed draft.
            await this.sendText(ctx, TEMPLATES.locationReceivedEarly);
          } else if (message.kind === 'TEXT' && message.text && message.id !== hold.heldMessage.id) {
            // The replay just asked the product question; do not repeat it.
            await this.sendPreConfirmNotice(ctx, normalizeTr(message.text), message.text, { skipOpenQuestion: true });
          }
          return { handled: true };
        }
      }

      if (fresh) {
        // Nothing to replay: continue in the current step with this message.
        return { handled: false, phase };
      }
    } catch (error) {
      logger.warn({ error, tenantId, conversationId }, 'Legacy hold replay failed, restarting conversation');
    }

    // Stale hold (or replay failed): start clean; do not revive a days-old cart.
    await prisma.order.updateMany({
      where: { tenantId, conversationId, status: 'DRAFT' },
      data: { status: 'CANCELLED' },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { phase: 'IDLE', activeOrderId: null, flowSubState: null, flowMetadata: null },
    });
    Object.assign(ctx.conversation, { phase: 'IDLE', activeOrderId: null, flowSubState: null, flowMetadata: null });
    return { handled: false, phase: 'IDLE' };
  }

  private async cancelActiveOrder(ctx: FlowContext): Promise<void> {
    const orderId = ctx.conversation.activeOrderId;
    if (!orderId) return;

    await prisma.order.updateMany({
      where: { id: orderId, tenantId: ctx.tenantId, status: 'DRAFT' },
      data: { status: 'CANCELLED' },
    });

    await inboxService.updateConversationPhase(ctx.tenantId, ctx.conversationId, 'IDLE', null);
  }

  private buildOrderSummary(order: any): string {
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
        price: Number(item.unitPrice),
        options,
        notes: item.notes || null,
      };
    });
    const total = Number(order.totalPrice);
    // The written-address flag is a staff instruction; the customer summary does not repeat it.
    return TEMPLATES.orderSummary(items, total, undefined, this.stripTypedAddressNote(order.notes));
  }

  /**
   * Keyword matching with word boundaries.
   *
   * The old implementation was a raw `text.includes(kw)`, which made every
   * message containing a keyword as a SUBSTRING take the wrong branch:
   *   - "fiyat ne 450 mi pahali ya" matched MENU_KEYWORDS via "fiyat" ...
   *     but so did "pahali" style messages via other keys,
   *   - "salata"/"saat" matched the greeting keyword "sa",
   *   - "eklemek" style words matched edit keywords.
   *
   * Now a keyword matches only at a word start (Turkish is agglutinative, so
   * "kartla", "nakitle", "iptal edelim" must still match), and very short
   * keywords ("sa") require an exact word.
   */
  private matchesKeyword(text: string, keywords: string[]): boolean {
    const folded = deaccentTr(text);
    const words = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return keywords.some((raw) => {
      const kw = deaccentTr(raw);
      if (!kw) return false;
      if (kw.includes(' ')) return folded.includes(kw);
      if (kw.length <= 2) return words.includes(kw);
      return words.some((w) => w.startsWith(kw));
    });
  }

  /**
   * Determine if user text is a genuine order confirmation intent.
   * Prevents false positives from ambiguous words like "olsun" (let it be),
   * "iyi" (good), "guzel" (nice) that appear in food notes/instructions
   * like "tuzu az olsun" (let the salt be low).
   */
  private isConfirmIntent(text: string): boolean {
    const words = text.split(/\s+/).filter(Boolean);

    // 4+ words → never a simple confirmation (too long)
    if (words.length >= 4) return false;

    // Single word → any confirm keyword is valid
    if (words.length === 1) {
      return CONFIRM_KEYWORDS.includes(words[0]);
    }

    // 2-3 words → only match "strong" (unambiguous) confirm keywords
    // Ambiguous keywords that can appear in food notes:
    //   "olsun" → "tuzu az olsun" (let the salt be low)
    //   "tamam"  → "tamam ama..." (ok but...)
    //   "iyi"    → "iyi pismiş olsun" (well cooked)
    //   "guzel"  → "guzel pisirin" (cook it nicely)
    const strongConfirmKeywords = [
      'evet', 'onayla', 'tamamla', 'onayliyorum',
      'harika', 'super', 'aynen', 'kesinlikle',
      'dogru', 'mukemmel', 'mükemmel',
    ];

    return strongConfirmKeywords.some((kw) => words.includes(kw));
  }

  /**
   * Send uploaded menu media (images/PDFs) to the customer.
   * Returns true if media was sent, false if no media uploaded.
   */
  private async sendMenuMedia(ctx: FlowContext): Promise<boolean> {
    const { menuMediaService } = await import('./menu-media.service');
    const media = await menuMediaService.getMediaForTenant(ctx.tenantId);

    if (media.length === 0) return false;

    await this.sendText(ctx, TEMPLATES.menuMediaIntro);

    for (const item of media) {
      if (item.type === 'IMAGE') {
        await whatsappService.sendImage(
          ctx.tenantId, ctx.conversationId,
          item.url, item.caption || undefined,
        );
      } else {
        await whatsappService.sendDocument(
          ctx.tenantId, ctx.conversationId,
          item.url, item.filename, item.caption || undefined,
        );
      }
    }

    await this.sendText(ctx, TEMPLATES.menuMediaFooter);
    return true;
  }

  /**
   * Checks if user text is a FULL order cancellation intent vs item-level removal.
   * "iptal", "siparis iptal", "siparisi iptal et", "vazgec" → full cancel
   * "salata iptal", "kolayi sil", "1 ayrani cikar", "bunun icinden X iptal" → item removal (NOT full cancel)
   */
  private isFullCancelIntent(rawText: string): boolean {
    // Fold Turkish accents: "siparişi iptal et" and "vazgeçtim" must match the
    // ASCII phrase lists below.
    const text = deaccentTr(rawText);
    const words = text.split(/\s+/).filter(Boolean);

    // Item-level indicators → definitely NOT a full cancel
    // Words that imply the user is referring to a specific item within the order
    const itemLevelIndicators = [
      'bunun', 'sunun', 'su', 'bu',          // "this", "that" (pointing to specific items)
      'icinden', 'icerisinden',               // "from within" (partial removal)
      'olani', 'olan', 'olanini',             // "the one that is" (specifying item)
      'tane', 'tanesini', 'tanesi',           // "piece" (specific qty)
      'birini', 'birisini',                   // "one of them"
    ];

    if (itemLevelIndicators.some(indicator => words.includes(indicator))) {
      return false;
    }

    // If text has 4+ words and contains a cancel keyword, it's likely item-level
    // (full cancel phrases are short: "iptal", "siparis iptal", "siparisi iptal et")
    if (words.length >= 4 && CANCEL_KEYWORDS.some(k => text.includes(k))) {
      return false;
    }

    // Pure cancel keywords (1-3 word phrases)
    const fullCancelPhrases = [
      'iptal', 'vazgec', 'istemiyorum', 'temizle',
      // everyday wording ("vazgeçtim" folds to vazgectim)
      'vazgectim', 'vazgectik', 'iptal edin', 'tamam iptal', 'artik istemiyorum',
      'siparisi istemiyorum', 'siparisimi istemiyorum', 'hicbirini istemiyorum',
      'siparisimi iptal', 'siparisimi iptal et', 'siparisimi iptal edin', 'siparisi iptal edin',
      'siparis iptal', 'siparisi iptal', 'siparisi iptal et',
      'siparis sil', 'hepsini iptal', 'hepsini sil',
      'tum siparisi iptal', 'her seyi iptal',
      'iptal et', 'iptal edelim', 'iptal ediyorum',
    ];

    // Check if text exactly matches a full cancel phrase
    if (fullCancelPhrases.includes(text)) return true;

    // If there's only one word and it's a cancel keyword, it's full cancel
    if (words.length === 1 && CANCEL_KEYWORDS.includes(words[0])) return true;

    // If the text starts with "siparis" + cancel keyword, it's full cancel
    if (words.length <= 3 && words[0] === 'siparis' && CANCEL_KEYWORDS.some(k => text.includes(k))) return true;
    if (words.length <= 3 && words[0] === 'siparisi' && CANCEL_KEYWORDS.some(k => text.includes(k))) return true;
    if (words.length <= 3 && words[0] === 'siparisimi' && CANCEL_KEYWORDS.some(k => text.includes(k))) return true;

    // Otherwise, likely item-level removal (e.g., "salata iptal", "1 kola sil")
    return false;
  }

  // ==================== EXTERNAL INTEGRATION HELPERS ====================

  /**
   * Send a status notification to customer via WhatsApp
   * Called by webhook route when POS sends status updates
   */
  async sendStatusNotification(
    tenantId: string,
    conversationId: string,
    message: string,
  ): Promise<void> {
    await whatsappService.sendText(tenantId, conversationId, message);
  }
}

export const conversationFlowService = new ConversationFlowService();
