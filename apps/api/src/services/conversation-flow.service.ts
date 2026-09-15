import prisma from '../db/prisma';
import { inboxService } from './inbox.service';
import { whatsappService } from './whatsapp.service';
import { nluOrchestratorService, OptionSelectionRequest } from './nlu/orchestrator.service';
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
import { TEMPLATES } from './message-templates';
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
  return normalizeTr(text)
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u');
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

interface FlowContext {
  tenantId: string;
  conversationId: string;
  conversation: any; // Raw Prisma conversation record
  message: MessageDto;
  payload: WhatsAppWebhookPayload;
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
    const currentPhase = (conversation.phase as ConversationPhase) || 'IDLE';

    // Agent takeover guard: if an agent has locked this conversation,
    // the bot stays completely silent. Only the agent responds via inbox.
    const lock = await prisma.conversationLock.findUnique({
      where: { conversationId },
    });
    if (lock || conversation.status === 'PENDING_AGENT') {
      logger.info(
        { tenantId, conversationId, hasLock: !!lock, status: conversation.status },
        'Bot silenced — conversation is handled by an agent',
      );
      return;
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
        await this.sendText(ctx, 'Konumunuzu aldim, teslimat adimida kullanacagiz. Once ne yemek istersiniz?');
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
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          flowSubState: 'OPTION_SELECTION',
          activeOrderId: result.draftOrderId || ctx.conversation.activeOrderId,
        },
      });
      await this.sendOptionSelectionList(ctx, result.pendingOptionSelection);
      return 'ORDER_COLLECTING';
    }

    if (result.draftOrderId && result.confirmationMessage) {
      await inboxService.updateConversationPhase(
        tenantId, conversationId, 'ORDER_REVIEW', result.draftOrderId,
      );
      await this.sendOrderConfirmButtons(ctx, result.confirmationMessage);
      await this.checkMinBasketWarning(ctx, result.draftOrderId);
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

      await this.sendText(ctx, 'Seçiminizi anlayamadım. Lütfen listeden bir seçenek seçin veya iptal etmek için "iptal" yazın.');
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

    // Adim 10: Faz-mesaj turu uyumsuzlugu
    if (message.kind === 'LOCATION') {
      await this.sendText(ctx, 'Once siparisi onaylayin, sonra konum isteyecegiz.');
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
    if (this.matchesKeyword(text, CONFIRM_KEYWORDS)) {
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

    // Handle confirm button
    if (buttonId === 'confirm_order' || this.isConfirmIntent(text)) {
      return this.handleOrderConfirm(ctx);
    }

    // Handle cancel button
    if (buttonId === 'cancel_order') {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    if (message.kind !== 'TEXT' || !text) {
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
    const { tenantId, conversationId, message, payload } = ctx;
    const text = normalizeTr(message.text || '');
    const buttonId = payload.interactive?.buttonReply?.id;

    const order = await this.getActiveOrder(ctx);
    if (!order || order.items.length === 0) {
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    // Cancel
    if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    const isPickup = buttonId === 'delivery_type_pickup' || this.isPickupIntent(text);
    const isDelivery = buttonId === 'delivery_type_delivery' || this.isDeliveryIntent(text);

    if (isPickup) {
      // Gel Al selected.
      // `deliveryAddress: null` clears an address the customer may have typed
      // BEFORE confirming (the pre-confirm guard parks it on the draft). A
      // pickup order must never carry a delivery address onto the kitchen
      // ticket. In the normal pickup flow this column is already null, so the
      // reset is a no-op.
      const updateData: any = { deliveryType: 'PICKUP', deliveryAddress: null };

      // Apply pickup discount if configured
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant?.pickupDiscountPercent && tenant.pickupDiscountPercent > 0) {
        const totalPrice = Number(order.totalPrice);
        const discountAmount = Math.round(totalPrice * tenant.pickupDiscountPercent) / 100;
        const newTotal = totalPrice - discountAmount;
        updateData.discountPercent = tenant.pickupDiscountPercent;
        updateData.discountAmount = discountAmount;
        updateData.totalPrice = newTotal;

        await prisma.order.update({ where: { id: order.id }, data: updateData });
        await this.sendText(
          ctx,
          `Gel al secildi! %${tenant.pickupDiscountPercent} indirim uygulandı (${discountAmount.toFixed(2)} TL indirim). Yeni toplam: ${newTotal.toFixed(2)} TL`,
        );
      } else {
        await prisma.order.update({ where: { id: order.id }, data: updateData });
        await this.sendText(ctx, 'Gel al secildi!');
      }

      // Skip address flow — go directly to payment
      await this.sendPaymentButtons(ctx);
      return 'PAYMENT_METHOD_SELECTION';
    }

    if (isDelivery) {
      // Paket Servis selected
      await prisma.order.update({
        where: { id: order.id },
        data: { deliveryType: 'DELIVERY' },
      });
      // Continue to address flow
      return this.proceedToAddressFlow(ctx);
    }

    // Mid-flow addition: customer wants to add more items
    if (text) {
      const added = await this.tryMidFlowAddition(ctx, text);
      if (added) {
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
    const { tenantId, conversationId, conversation } = ctx;

    // Check for saved addresses before requesting location
    const savedAddresses = await savedAddressService.getByCustomerPhone(
      tenantId, conversation.customerPhone,
    );

    if (savedAddresses.length > 0) {
      const rows = savedAddresses.map((addr) => ({
        id: `saved_addr_${addr.id}`,
        title: addr.name.substring(0, 24),
        description: addr.address.substring(0, 72),
      }));
      rows.push({
        id: 'new_address',
        title: TEMPLATES.newAddressRowTitle,
        description: TEMPLATES.newAddressRowDescription,
      });

      await whatsappService.sendListMessage(
        tenantId,
        conversationId,
        TEMPLATES.savedAddressListHeader,
        TEMPLATES.savedAddressListButton,
        [{ title: 'Adresler', rows }],
      );
      return 'ADDRESS_SELECTION';
    }

    await whatsappService.sendLocationRequest(
      tenantId,
      conversationId,
      TEMPLATES.locationRequest,
    );
    return 'LOCATION_REQUEST';
  }

  /**
   * LOCATION_REQUEST: Waiting for customer to send location pin.
   */
  private async handleLocationRequest(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, payload } = ctx;

    // Location message received
    if (message.kind === 'LOCATION' && payload.location?.latitude && payload.location?.longitude) {
      // Geo check was already done in whatsapp.service.ts (stored in conversation)
      const geoCheck = await inboxService.getConversationGeoCheck(tenantId, conversationId);

      if (!geoCheck) {
        // Fallback: run geo check here
        const result = await geoService.checkServiceArea(tenantId, {
          lat: payload.location.latitude,
          lng: payload.location.longitude,
        });
        await inboxService.updateConversationGeoCheck(tenantId, conversationId, result);
        return this.processGeoResult(ctx, result);
      }

      return this.processGeoResult(ctx, geoCheck);
    }

    // Cancel
    const text = normalizeTr(message.text || '');
    if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // Adim 10: IMAGE gonderdiyse konum hatirlatmasi
    if (message.kind === 'IMAGE') {
      await this.sendText(ctx, 'Gorsel degil, konum pininizi gonderin. WhatsApp\'ta ek ikonundan "Konum" secenegini kullanin.');
      return 'LOCATION_REQUEST';
    }

    // Mid-flow addition: customer wants to add more items while sending location
    if (text) {
      const added = await this.tryMidFlowAddition(ctx, text);
      if (added) {
        await this.sendText(ctx, TEMPLATES.reminderSendLocation);
        return 'LOCATION_REQUEST';
      }
    }

    // Text message during LOCATION_REQUEST — give contextual help
    // Check if previous geo check was out of service area
    const prevGeoCheck = await inboxService.getConversationGeoCheck(tenantId, conversationId);
    if (prevGeoCheck && !prevGeoCheck.isWithinServiceArea) {
      // Customer was told they're out of service area, they might be typing a text address
      await this.sendText(
        ctx,
        'Yazili adres kabul edemiyoruz, hizmet alanimizi kontrol etmemiz icin konum pininize ihtiyacimiz var.\n\n' +
        'Farkli bir konumdan gondermek icin:\n' +
        'simgesine tiklayip > *Konum* secenegini kullanin.\n\n' +
        'Siparisi iptal etmek icin "iptal" yazin.',
      );
    } else {
      await this.sendText(ctx, TEMPLATES.reminderSendLocation);
    }
    return 'LOCATION_REQUEST';
  }

  /**
   * PAYMENT_METHOD_SELECTION: Buttons sent, waiting for Nakit/Kart selection.
   */
  private async handlePaymentMethodSelection(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, payload, conversation } = ctx;
    const text = normalizeTr(message.text || '');

    // Interactive button reply
    const buttonId = payload.interactive?.buttonReply?.id;

    if (buttonId === 'pay_cash' || this.matchesKeyword(text, CASH_KEYWORDS)) {
      return this.handleCashPayment(ctx);
    }

    if (buttonId === 'pay_card_door') {
      return this.handleCardDoorPayment(ctx);
    }

    if (buttonId === 'pay_card_online' || buttonId === 'pay_card' || this.matchesKeyword(text, CARD_KEYWORDS)) {
      return this.handleCardPayment(ctx);
    }

    // Cancel
    if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // Mid-flow addition: customer wants to add more items before paying
    if (text) {
      const added = await this.tryMidFlowAddition(ctx, text);
      if (added) {
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

    // Switch to cash
    if (this.matchesKeyword(text, CASH_KEYWORDS)) {
      return this.handleCashPayment(ctx);
    }

    // Retry card payment
    if (this.matchesKeyword(text, CARD_KEYWORDS)) {
      return this.handleCardPayment(ctx);
    }

    // Cancel
    if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
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
    const { tenantId, message, payload } = ctx;
    const text = normalizeTr(message.text || '');
    const buttonId = payload.interactive?.buttonReply?.id;

    // Cancel at any point
    if (text && this.matchesKeyword(text, CANCEL_KEYWORDS)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    const order = await this.getActiveOrder(ctx);
    if (!order) {
      await this.sendText(ctx, TEMPLATES.orderEmpty);
      return 'IDLE';
    }

    if (!order.deliveryAddress) {
      // --- Sub-state: waiting for address text ---
      if (message.kind !== 'TEXT' || !text) {
        await this.sendText(ctx, 'Lutfen teslimat adresinizi metin olarak yazin.');
        return 'ADDRESS_COLLECTION';
      }
      const address = (message.text || '').trim();
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
      if (buttonId === 'address_confirm' || this.matchesKeyword(text, CONFIRM_KEYWORDS)) {
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

      if (buttonId === 'address_retry' || this.matchesKeyword(text, EDIT_KEYWORDS)) {
        // User wants to re-enter address
        await prisma.order.update({
          where: { id: order.id },
          data: { deliveryAddress: null },
        });
        await this.sendText(ctx, TEMPLATES.addressRetry);
        return 'ADDRESS_COLLECTION';
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
    const { tenantId, conversationId, message, payload, conversation } = ctx;
    const text = normalizeTr(message.text || '');

    // Cancel
    if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // Handle list reply (interactive)
    const listReplyId = payload.interactive?.listReply?.id;

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
        await this.sendText(ctx, TEMPLATES.savedAddressInvalid);
        await whatsappService.sendLocationRequest(tenantId, conversationId, TEMPLATES.locationRequest);
        return 'LOCATION_REQUEST';
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
          },
        });
      }

      const storeName = geoResult.nearestStore?.name || 'En yakin sube';
      const deliveryFee = geoResult.deliveryRule ? Number(geoResult.deliveryRule.deliveryFee) : 0;
      const distance = geoResult.distance || 0;
      await this.sendText(ctx, TEMPLATES.locationConfirmed(storeName, deliveryFee, distance));

      // Skip address collection — go straight to payment
      await this.sendPaymentButtons(ctx);
      return 'PAYMENT_METHOD_SELECTION';
    }

    // Text fallback — might be typing "yeni" etc.
    if (text.includes('yeni')) {
      await whatsappService.sendLocationRequest(tenantId, conversationId, TEMPLATES.locationRequest);
      return 'LOCATION_REQUEST';
    }

    // Mid-flow addition: customer wants to add more items while picking address
    if (message.kind === 'TEXT' && text) {
      const added = await this.tryMidFlowAddition(ctx, text);
      if (added) {
        return this.proceedToAddressFlow(ctx);
      }
    }

    // Unrecognized — resend list
    const savedAddresses = await savedAddressService.getByCustomerPhone(tenantId, conversation.customerPhone);
    const rows = savedAddresses.map((addr) => ({
      id: `saved_addr_${addr.id}`,
      title: addr.name.substring(0, 24),
      description: addr.address.substring(0, 72),
    }));
    rows.push({
      id: 'new_address',
      title: TEMPLATES.newAddressRowTitle,
      description: TEMPLATES.newAddressRowDescription,
    });
    await whatsappService.sendListMessage(
      tenantId, conversationId,
      TEMPLATES.savedAddressListHeader,
      TEMPLATES.savedAddressListButton,
      [{ title: 'Adresler', rows }],
    );
    return 'ADDRESS_SELECTION';
  }

  // ==================== ADDRESS SAVE PROMPT ====================

  /**
   * ADDRESS_SAVE_PROMPT: Ask if customer wants to save the address, then collect name.
   */
  private async handleAddressSavePrompt(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, conversation, payload } = ctx;
    const text = normalizeTr(message.text || '');
    const buttonId = payload.interactive?.buttonReply?.id;

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
    const { tenantId, conversationId, conversation } = ctx;

    if (!geoCheck.isWithinServiceArea) {
      await this.sendText(ctx, TEMPLATES.locationOutOfService(geoCheck.message));
      return 'LOCATION_REQUEST';
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

    // Location confirmed - show delivery info and payment buttons
    const storeName = geoCheck.nearestStore?.name || 'En yakin sube';
    const deliveryFee = geoCheck.deliveryRule ? Number(geoCheck.deliveryRule.deliveryFee) : 0;
    const distance = geoCheck.distance || 0;

    await this.sendText(ctx, TEMPLATES.locationConfirmed(storeName, deliveryFee, distance));

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
    if (!rawText) return false;
    if (rawText.includes('?')) return true;

    const folded = deaccentTr(rawText);
    const words = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.includes('mi') || words.includes('mu')) return true;

    const phrases = [
      'nedir', 'kac para', 'kac tl', 'kac lira', 'ne kadar', 'icinde ne',
      'neler var', 'fark ne', 'farki ne', 'hangisi', 'nasil', 'ne onerir',
      'ne kadar surer', 'kac dakika', 'vejetaryen', 'vejeteryan', 'glutensiz',
      'helal', 'acili',
    ];
    return phrases.some((p) => folded.includes(p));
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
   * Anything asked before its turn gets a single, honest sentence instead of a
   * confusing or wrong answer.
   *
   * Returns the notice to send, or null when the message is not an early
   * payment / address message.
   */
  private preConfirmNotice(rawText: string): 'payment' | 'address' | null {
    // ASCII only — the text is folded with deaccentTr above.
    const text = deaccentTr(rawText);
    const paymentPhrases = [
      'odeme linki', 'odeme link', 'link gonder', 'link atar', 'link at',
      'nasil odeyecegim', 'nasil odeyecem', 'nasil odiycem', 'nasil odenecek',
      'online odeme', 'kartla odeme', 'kredi karti ile',
      'iban', 'havale', 'papara',
    ];
    if (paymentPhrases.some((p) => text.includes(p))) return 'payment';
    return null;
  }

  /**
   * Conservative address detector.
   *
   * Requires either TWO street/neighbourhood tokens, or one plus an explicit
   * detail word ("no", "daire", "kat"). A bare digit is never enough, so an
   * order line for a product whose name happens to contain "sokak" is not
   * mistaken for an address, and "eve gelsin" never is either.
   */
  private detectEarlyAddress(rawText: string): string | null {
    const t = deaccentTr(rawText);
    const placeTokens = ['mah', 'cad', 'sok', 'bulvar', 'blv', 'apartman', 'site'];
    // Exact-word matches only: "kat" must not match "katkisiz".
    const detailTokens = ['no', 'nu', 'daire', 'kat', 'blok', 'apt'];

    const words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const placeCount = words.filter((w) => placeTokens.some((p) => w.startsWith(p))).length;
    if (placeCount === 0) return null;

    const hasDetailWord = words.some((w) => detailTokens.includes(w));
    if (placeCount < 2 && !hasDetailWord) return null;

    const address = rawText.trim();
    return address.length >= 10 ? address.substring(0, 400) : null;
  }

  /**
   * Applies the pre-confirmation guards for payment/address questions.
   * Returns true when a notice was sent.
   *
   * IMPORTANT: this NEVER short-circuits the order flow. It is called only in
   * pre-confirm phases and only decides whether an extra sentence is appended;
   * products in the same message are still extracted by the NLU.
   */
  private async sendPreConfirmNotice(ctx: FlowContext, text: string, rawText: string): Promise<boolean> {
    if (this.preConfirmNotice(text) === 'payment') {
      await this.sendText(ctx, 'Odeme islemi siparis onaylandiktan sonra tercihlerinize gore sekillenecek.');
      return true;
    }

    const address = this.detectEarlyAddress(rawText);
    if (address) {
      // Do not lose the address: park it on the draft order so the address step
      // can offer it back for confirmation. No follow-up detail (floor,
      // company) is asked before the order is confirmed.
      try {
        const order = await this.getDraftOrder(ctx);
        if (order && !order.deliveryAddress) {
          await prisma.order.update({
            where: { id: order.id },
            data: { deliveryAddress: address },
          });
        }
      } catch (error) {
        logger.warn({ error, conversationId: ctx.conversationId }, 'Failed to park early address');
      }
      await this.sendText(ctx, 'Adres bilgisi siparis onaylandiktan sonra alinacak.');
      return true;
    }

    return false;
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
   * Mid-flow addition: When customer sends an item request during ADDRESS_SELECTION,
   * LOCATION_REQUEST, or PAYMENT_METHOD_SELECTION, add items to draft and re-show flow.
   * Returns true if addition was handled, false if text was not a food item.
   */
  private async tryMidFlowAddition(ctx: FlowContext, text: string): Promise<boolean> {
    const { tenantId, conversationId, message } = ctx;

    if (!text || !message.id) return false;

    const result = await nluOrchestratorService.processMessage(
      tenantId, conversationId, message.id, text,
    );

    if (result.draftOrderId && result.itemsExtracted) {
      // Items were added to the existing draft order
      const order = await this.getActiveOrder(ctx);
      if (order && order.items.length > 0) {
        const summary = this.buildOrderSummary(order);
        await this.sendText(ctx, `Eklendi! Guncel siparisiniz:\n\n${summary}`);
      }
      return true;
    }

    if (result.clarificationQuestion) {
      await this.sendText(ctx, result.clarificationQuestion);
      return true;
    }

    return false;
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
    return TEMPLATES.orderSummary(items, total, undefined, order.notes);
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
