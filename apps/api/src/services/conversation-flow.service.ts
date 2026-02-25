import prisma from '../db/prisma';
import { inboxService } from './inbox.service';
import { whatsappService } from './whatsapp.service';
import { nluOrchestratorService } from './nlu/orchestrator.service';
import { geoService } from './geo.service';
import { orderService } from './order.service';
import { orderPaymentService } from './order-payment.service';
import { TEMPLATES } from './message-templates';
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

// Keywords for user intent detection
const CONFIRM_KEYWORDS = ['evet', 'onayla', 'tamam', 'olsun', 'tamamla', 'onayliyorum'];
const CANCEL_KEYWORDS = ['iptal', 'vazgec', 'istemiyorum', 'sil', 'temizle'];
const EDIT_KEYWORDS = ['hayir', 'degistir', 'degis', 'ekle', 'cikar'];
const MENU_KEYWORDS = ['menu', 'men\u00fc', 'neler var', 'fiyat', 'liste'];
const CASH_KEYWORDS = ['nakit', 'kapida', 'kap\u0131da'];
const CARD_KEYWORDS = ['kart', 'kredi'];
const GREETING_KEYWORDS = ['merhaba', 'selam', 'iyi gunler', 'iyi g\u00fcnler', 'nasilsiniz', 'nas\u0131ls\u0131n\u0131z', 'hey', 'sa'];
const THANKS_KEYWORDS = ['tesekkur', 'te\u015fekk\u00fcr', 'sagol', 'sa\u011fol', 'eyvallah'];
const HELP_KEYWORDS = ['yardim', 'yard\u0131m', 'nasil', 'nas\u0131l', 'ne yapabilirim'];

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

    logger.info(
      { tenantId, conversationId, phase: currentPhase, messageKind: message.kind },
      'Flow service handling message',
    );

    try {
      // Global reset command - works in any phase
      const RESET_KEYWORDS = ['sifirla', 'sıfırla', 'reset', 'bastan', 'baştan'];
      const normalizedText = normalizeTr(ctx.message.text || '');
      if (currentPhase !== 'IDLE' && RESET_KEYWORDS.some(k => normalizedText.includes(k))) {
        logger.info({ tenantId, conversationId, phase: currentPhase }, 'User requested conversation reset');
        await this.cancelActiveOrder(ctx);
        // Always force phase to IDLE (cancelActiveOrder may skip if no active order)
        await inboxService.updateConversationPhase(tenantId, conversationId, 'IDLE', null);
        await this.sendText(ctx, '🔄 Konuşma sıfırlandı. Yeni sipariş vermek için menüden seçim yapabilirsiniz.\n\n📋 *Menü* görmek için "menü" yazın.');
        return;
      }

      let nextPhase: ConversationPhase;

      switch (currentPhase) {
        case 'IDLE':
          nextPhase = await this.handleIdle(ctx);
          break;
        case 'ORDER_COLLECTING':
          nextPhase = await this.handleOrderCollecting(ctx);
          break;
        case 'ORDER_REVIEW':
          nextPhase = await this.handleOrderReview(ctx);
          break;
        case 'LOCATION_REQUEST':
          nextPhase = await this.handleLocationRequest(ctx);
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
      await this.sendText(ctx, 'Bir hata olustu. Lutfen tekrar deneyin.');
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
      // Move to PENDING_CONFIRMATION (waiting for restaurant approval)
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
      if (message.kind === 'IMAGE' || message.kind === 'VOICE') {
        await this.sendText(ctx, 'Gorsel/sesli mesaj isleyemiyorum. Siparis vermek icin urun adini yazin.');
      } else if (message.kind === 'LOCATION') {
        await this.sendText(ctx, 'Once siparis verin, sonra konum isteyecegiz. Siparis icin urun adini yazin.');
      } else {
        await this.sendText(ctx, TEMPLATES.greeting);
      }
      return 'IDLE';
    }

    // Menu request
    if (this.matchesKeyword(text, MENU_KEYWORDS)) {
      // Let NLU handle menu display
      const result = await nluOrchestratorService.processMessage(
        tenantId, conversationId, message.id, text,
      );
      if (result.confirmationMessage) {
        await this.sendText(ctx, result.confirmationMessage);
      }
      return 'IDLE';
    }

    // Try NLU extraction
    const result = await nluOrchestratorService.processMessage(
      tenantId, conversationId, message.id, text,
    );

    if (result.needsAgentHandoff) {
      await this.sendText(ctx, TEMPLATES.agentHandoff);
      return 'AGENT_HANDOFF';
    }

    if (result.draftOrderId) {
      // Items found, draft created - show summary and move to ORDER_COLLECTING
      await inboxService.updateConversationPhase(
        tenantId, conversationId, 'ORDER_COLLECTING', result.draftOrderId,
      );
      if (result.confirmationMessage) {
        await this.sendText(ctx, result.confirmationMessage);
      }
      // Adim 9: Erken minimum sepet uyarisi
      await this.checkMinBasketWarning(ctx, result.draftOrderId);
      return 'ORDER_COLLECTING';
    }

    if (result.clarificationQuestion) {
      await this.sendText(ctx, result.clarificationQuestion);
      return 'ORDER_COLLECTING';
    }

    if (!result.itemsExtracted) {
      await this.sendText(ctx, TEMPLATES.greeting);
      return 'IDLE';
    }

    return 'IDLE';
  }

  /**
   * ORDER_COLLECTING: Items being added to cart. Listen for more items or confirmation.
   */
  private async handleOrderCollecting(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, conversation } = ctx;
    const text = normalizeTr(message.text || '');

    // Adim 10: Faz-mesaj turu uyumsuzlugu
    if (message.kind === 'LOCATION') {
      await this.sendText(ctx, 'Once siparisi onaylayin, sonra konum isteyecegiz. Onaylamak icin "evet" yazin.');
      return 'ORDER_COLLECTING';
    }

    if (message.kind !== 'TEXT' || !text) {
      if (message.kind === 'IMAGE' || message.kind === 'VOICE') {
        await this.sendText(ctx, 'Gorsel/sesli mesaj isleyemiyorum. Urun adini yazarak siparis verebilirsiniz.');
      }
      return 'ORDER_COLLECTING';
    }

    // Cancel
    if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // Confirm order -> move to review (only if draft order exists with items)
    if (this.matchesKeyword(text, CONFIRM_KEYWORDS)) {
      const order = await this.getActiveOrder(ctx);
      if (order && order.items.length > 0) {
        const summary = this.buildOrderSummary(order);
        await this.sendText(ctx, summary);
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
      await this.sendText(ctx, result.confirmationMessage);
      // Adim 9: Erken minimum sepet uyarisi
      if (result.draftOrderId) {
        await this.checkMinBasketWarning(ctx, result.draftOrderId);
      }
    } else if (result.clarificationQuestion) {
      await this.sendText(ctx, result.clarificationQuestion);
    } else if (!result.itemsExtracted) {
      // Adim 8: Akilli fallback mesajlari
      await this.sendSmartFallback(ctx, text);
    }

    return 'ORDER_COLLECTING';
  }

  /**
   * ORDER_REVIEW: Order summary shown, waiting for customer yes/no/edit.
   */
  private async handleOrderReview(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message } = ctx;
    const text = normalizeTr(message.text || '');

    if (message.kind !== 'TEXT' || !text) {
      return 'ORDER_REVIEW';
    }

    // Cancel
    if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // Confirm -> ask for location
    if (this.matchesKeyword(text, CONFIRM_KEYWORDS)) {
      await whatsappService.sendLocationRequest(
        tenantId,
        conversationId,
        TEMPLATES.locationRequest,
      );
      return 'LOCATION_REQUEST';
    }

    // Edit -> back to collecting
    if (this.matchesKeyword(text, EDIT_KEYWORDS)) {
      await this.sendText(ctx, 'Siparisinizi degistirmek icin yeni urun yazin veya "iptal" yazin.');
      return 'ORDER_COLLECTING';
    }

    // Default: treat as edit intent, go back to collecting
    await this.sendText(ctx, 'Onaylamak icin "evet", iptal icin "iptal" yazin.');
    return 'ORDER_REVIEW';
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

    // Not a location message - remind user
    await this.sendText(ctx, TEMPLATES.reminderSendLocation);
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

    if (buttonId === 'pay_card' || this.matchesKeyword(text, CARD_KEYWORDS)) {
      return this.handleCardPayment(ctx);
    }

    // Cancel
    if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
      await this.cancelActiveOrder(ctx);
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
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
    await this.sendText(ctx, TEMPLATES.orderConfirmedNewOrder);
    // Reset to IDLE for new orders
    await inboxService.updateConversationPhase(ctx.tenantId, ctx.conversationId, 'IDLE', null);
    return 'IDLE';
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

    // Record cash payment
    await orderPaymentService.recordCashPayment(tenantId, orderId, conversationId);

    // Move to PENDING_CONFIRMATION (waiting for restaurant approval)
    const pendingOrder = await orderService.setPendingConfirmation(tenantId, orderId, {
      paymentMethod: 'CASH',
    });

    await this.sendText(ctx, TEMPLATES.cashConfirmed(pendingOrder.orderNumber || 0));
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
    await this.sendPaymentButtons(ctx);

    return 'PAYMENT_METHOD_SELECTION';
  }

  // ==================== SMART FALLBACK (Adim 8) ====================

  /**
   * Adim 8: Akilli fallback mesajlari
   * NLU sonuc donmediginde mesajin icerigi analiz edilerek uygun yanit secilir
   */
  private async sendSmartFallback(ctx: FlowContext, text: string): Promise<void> {
    // Selamlama kontrolu
    if (this.matchesKeyword(text, GREETING_KEYWORDS)) {
      const order = await this.getActiveOrder(ctx);
      if (order && order.items.length > 0) {
        await this.sendText(ctx, 'Merhaba! Siparisininize devam edebilirsiniz. Onaylamak icin "evet", urun eklemek icin urun adini yazin.');
      } else {
        await this.sendText(ctx, 'Merhaba! Siparis vermek icin urun adini yazabilirsiniz.');
      }
      return;
    }

    // Tesekkur kontrolu
    if (this.matchesKeyword(text, THANKS_KEYWORDS)) {
      const order = await this.getActiveOrder(ctx);
      if (order && order.items.length > 0) {
        await this.sendText(ctx, 'Rica ederim! Siparisi onaylamak icin "evet" yazin veya baska urun ekleyebilirsiniz.');
      } else {
        await this.sendText(ctx, 'Rica ederim! Siparis vermek isterseniz urun adini yazabilirsiniz.');
      }
      return;
    }

    // Yardim kontrolu
    if (this.matchesKeyword(text, HELP_KEYWORDS)) {
      await this.sendText(
        ctx,
        'Siparis vermek icin:\n' +
        '1. Urun adini yazin (orn: "1 Et Doner", "2 Kola")\n' +
        '2. Birden fazla urun ekleyebilirsiniz\n' +
        '3. Hazir olunca "evet" yazarak onaylayin\n' +
        '4. Menuyu gormek icin "menu" yazin',
      );
      return;
    }

    // Varsayilan fallback
    const order = await this.getActiveOrder(ctx);
    if (order && order.items.length > 0) {
      await this.sendText(
        ctx,
        'Anlayamadim. Urun eklemek icin urun adini yazin (orn: "1 Kola"), siparisi onaylamak icin "evet" yazin.',
      );
    } else {
      await this.sendText(
        ctx,
        'Anlayamadim, eklemek istediginiz urunu biraz daha acik yazar misiniz? Ornegin: "1 Kola", "Tavuk Doner" gibi.',
      );
    }
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

  private async sendPaymentButtons(ctx: FlowContext): Promise<void> {
    const tmpl = TEMPLATES.paymentMethodButtons;
    await whatsappService.sendInteractiveButtons(
      ctx.tenantId,
      ctx.conversationId,
      tmpl.body,
      tmpl.buttons,
    );
  }

  private async getActiveOrder(ctx: FlowContext) {
    const orderId = ctx.conversation.activeOrderId;
    if (!orderId) return null;

    return prisma.order.findFirst({
      where: { id: orderId, tenantId: ctx.tenantId, status: 'DRAFT' },
      include: { items: true },
    });
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
    return TEMPLATES.orderSummary(items, total);
  }

  private matchesKeyword(text: string, keywords: string[]): boolean {
    return keywords.some((kw) => text.includes(kw));
  }
}

export const conversationFlowService = new ConversationFlowService();
