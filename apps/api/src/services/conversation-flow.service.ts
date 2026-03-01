import prisma from '../db/prisma';
import { inboxService } from './inbox.service';
import { whatsappService } from './whatsapp.service';
import { nluOrchestratorService } from './nlu/orchestrator.service';
import { geoService } from './geo.service';
import { orderService } from './order.service';
import { orderPaymentService } from './order-payment.service';
import { savedAddressService } from './saved-address.service';
import { storeService } from './store.service';
import { upsellService } from './upsell.service';
import { surveyService } from './survey.service';
import { reorderService } from './reorder.service';
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
const REORDER_KEYWORDS = ['tekrar', 'favorilerim', 'favori', 'onceki', 'gene ayni', 'her zamanki'];
const BROADCAST_OPT_OUT_KEYWORDS = ['kampanya istemiyorum', 'bildirim kapat'];

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
        case 'ADDITION_PROMPT':
          nextPhase = await this.handleAdditionPrompt(ctx);
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

    // Reorder / Favorites
    if (this.matchesKeyword(text, REORDER_KEYWORDS)) {
      return this.handleReorderRequest(ctx);
    }

    // Check for active (non-draft) orders before NLU
    const activeParentOrder = await orderService.findActiveOrderForConversation(
      tenantId, conversationId
    );

    if (activeParentOrder && ['CONFIRMED', 'PREPARING', 'READY'].includes(activeParentOrder.status)) {
      // Ask if they want to add to existing or start new
      await whatsappService.sendInteractiveButtons(
        tenantId,
        conversationId,
        TEMPLATES.additionPrompt(activeParentOrder.orderNumber || 0),
        [
          { id: 'add_to_order', title: 'Ekleme Yap' },
          { id: 'new_order', title: 'Yeni Siparis' },
        ],
      );
      await inboxService.updateConversationPhase(
        tenantId, conversationId, 'ADDITION_PROMPT', activeParentOrder.id
      );
      return 'ADDITION_PROMPT';
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

  // ==================== ADDITION PROMPT ====================

  private async handleAdditionPrompt(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, conversationId, message, payload, conversation } = ctx;
    const text = normalizeTr(message.text || '');
    const buttonId = payload.interactive?.buttonReply?.id;

    // Cancel
    if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
      await inboxService.updateConversationPhase(tenantId, conversationId, 'IDLE', null);
      return 'IDLE';
    }

    // "Ekleme Yap" button or keyword
    const ADDITION_KEYWORDS = ['ekleme', 'ekle', 'evet'];
    if (buttonId === 'add_to_order' || ADDITION_KEYWORDS.some(k => text.includes(k))) {
      const parentOrderId = conversation.activeOrderId;
      if (!parentOrderId) {
        await this.sendText(ctx, TEMPLATES.orderEmpty);
        return 'IDLE';
      }

      // Create child draft order linked to parent
      const childDraft = await orderService.createAdditionDraft(
        tenantId, conversationId, parentOrderId
      );

      // Get parent order number for the message
      const parentOrder = await orderService.getOrder(tenantId, parentOrderId);

      await inboxService.updateConversationPhase(
        tenantId, conversationId, 'ORDER_COLLECTING', childDraft.id
      );

      await this.sendText(ctx, TEMPLATES.additionStarted(parentOrder.orderNumber || 0));
      return 'ORDER_COLLECTING';
    }

    // "Yeni Siparis" button or keyword
    const NEW_ORDER_KEYWORDS = ['yeni', 'hayir'];
    if (buttonId === 'new_order' || NEW_ORDER_KEYWORDS.some(k => text.includes(k))) {
      await inboxService.updateConversationPhase(tenantId, conversationId, 'IDLE', null);
      await this.sendText(ctx, TEMPLATES.newOrderPrompt);
      return 'IDLE';
    }

    // Unrecognized - resend buttons
    const parentOrderId = conversation.activeOrderId;
    if (parentOrderId) {
      const parentOrder = await orderService.getOrder(tenantId, parentOrderId);
      await whatsappService.sendInteractiveButtons(
        tenantId,
        conversationId,
        TEMPLATES.additionPrompt(parentOrder.orderNumber || 0),
        [
          { id: 'add_to_order', title: 'Ekleme Yap' },
          { id: 'new_order', title: 'Yeni Siparis' },
        ],
      );
    }
    return 'ADDITION_PROMPT';
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

    // Cancel — only full order cancel if text is purely a cancel keyword
    // "salata iptal" gibi urun+iptal ifadelerini NLU'ya gonder (urun cikarma)
    if (this.isFullCancelIntent(text)) {
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
    const { tenantId, conversationId, message, conversation, payload } = ctx;
    const text = normalizeTr(message.text || '');
    const buttonId = payload.interactive?.buttonReply?.id;

    // Handle UPSELL_OFFERED sub-state
    if (conversation.flowSubState === 'UPSELL_OFFERED') {
      return this.handleUpsellResponse(ctx, text, buttonId);
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

    // "X iptal" gibi urun cikarma ifadelerini NLU'ya gonder
    if (!this.isFullCancelIntent(text) && this.matchesKeyword(text, CANCEL_KEYWORDS)) {
      // Pass to NLU for item removal, then show updated summary
      const result = await nluOrchestratorService.processMessage(
        tenantId, conversationId, message.id, text,
      );
      if (result.confirmationMessage) {
        await this.sendText(ctx, result.confirmationMessage);
      }
      const order = await this.getActiveOrder(ctx);
      if (order && order.items.length > 0) {
        const summary = this.buildOrderSummary(order);
        await this.sendText(ctx, summary);
        return 'ORDER_REVIEW';
      }
      // All items removed
      await this.sendText(ctx, TEMPLATES.orderCancelled);
      return 'IDLE';
    }

    // Confirm -> try upsell, then ask for location
    if (this.matchesKeyword(text, CONFIRM_KEYWORDS)) {
      // Check if this is an addition order - skip location/address
      const order = await this.getActiveOrder(ctx);
      if (order?.parentOrderId) {
        // Validate items for addition
        const validationError = await this.validateAdditionItems(ctx, order);
        if (validationError) {
          await this.sendText(ctx, validationError);
          return 'ORDER_COLLECTING';
        }
        // Skip location & address -> go straight to payment
        await this.sendPaymentButtons(ctx);
        return 'PAYMENT_METHOD_SELECTION';
      }

      // Try upsell before proceeding to address/location
      if (order) {
        try {
          const suggestion = await upsellService.getSuggestion(
            tenantId,
            order.id,
            conversation.customerPhone,
            conversation.customerName,
          );

          if (suggestion) {
            // Store suggestion in flowSubState metadata
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

            // Send AI message + buttons
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
      }

      // No upsell -> proceed to address/location
      return this.proceedToAddressFlow(ctx);
    }

    // Edit -> back to collecting
    if (this.matchesKeyword(text, EDIT_KEYWORDS)) {
      await this.sendText(ctx, 'Siparisinizi degistirmek icin yeni urun yazin veya "iptal" yazin.');
      return 'ORDER_COLLECTING';
    }

    // Default: treat as new product — pass to NLU to add item
    const result = await nluOrchestratorService.processMessage(
      tenantId, conversationId, message.id, text,
    );
    if (result.confirmationMessage) {
      await this.sendText(ctx, result.confirmationMessage);
    }
    const order = await this.getActiveOrder(ctx);
    if (order && order.items.length > 0) {
      const summary = this.buildOrderSummary(order);
      await this.sendText(ctx, summary);
      return 'ORDER_REVIEW';
    }
    // NLU couldn't parse it
    await this.sendText(ctx, 'Onaylamak icin "evet", iptal icin "iptal" yazin.');
    return 'ORDER_REVIEW';
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

        await this.sendText(ctx, `✅ ${upsellMeta.upsellItemName} sepete eklendi!`);

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
      await this.sendText(ctx, 'Eklemek icin "evet", devam etmek icin "hayir" yazin.');
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
      await this.sendText(ctx, 'Baska urun eklemek icin yazin veya "evet" ile onaylayin.');

      return 'ORDER_COLLECTING';
    } catch (error) {
      logger.error({ error, tenantId, menuItemId }, 'Failed to add favorite to order');
      await this.sendText(ctx, 'Bu urun su anda musait degil. Baska bir urun denemek ister misiniz?');
      return 'IDLE';
    }
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

    // Text message during LOCATION_REQUEST — give contextual help
    // Check if previous geo check was out of service area
    const prevGeoCheck = await inboxService.getConversationGeoCheck(tenantId, conversationId);
    if (prevGeoCheck && !prevGeoCheck.isWithinServiceArea) {
      // Customer was told they're out of service area, they might be typing a text address
      await this.sendText(
        ctx,
        'Yazili adres kabul edemiyoruz, hizmet alanimizi kontrol etmemiz icin konum pininize ihtiyacimiz var.\n\n' +
        'Farkli bir konumdan gondermek icin:\n' +
        '📎 simgesine tiklayip > *Konum* secenegini kullanin.\n\n' +
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

    // No survey active — reset to IDLE and process as new order
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
    await this.sendText(ctx, 'Kampanya bildirimlerini almak ister misiniz? "evet" veya "hayir" yazin.');
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

  // ==================== ADDRESS COLLECTION (Adim 4b) ====================

  /**
   * ADDRESS_COLLECTION: Customer types their delivery address, then confirms.
   * Sub-state: if Order.deliveryAddress is null → waiting for address text,
   *            if set → waiting for confirmation (evet/hayir).
   */
  private async handleAddressCollection(ctx: FlowContext): Promise<ConversationPhase> {
    const { tenantId, message } = ctx;
    const text = normalizeTr(message.text || '');

    // Only accept TEXT messages
    if (message.kind !== 'TEXT' || !text) {
      await this.sendText(ctx, 'Lutfen teslimat adresinizi metin olarak yazin.');
      return 'ADDRESS_COLLECTION';
    }

    // Cancel at any point
    if (this.matchesKeyword(text, CANCEL_KEYWORDS)) {
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
      const address = (message.text || '').trim();
      await prisma.order.update({
        where: { id: order.id },
        data: { deliveryAddress: address },
      });

      // Ask for confirmation
      await this.sendText(ctx, TEMPLATES.addressConfirmation(address));
      return 'ADDRESS_COLLECTION';
    } else {
      // --- Sub-state: waiting for confirmation ---
      if (this.matchesKeyword(text, CONFIRM_KEYWORDS)) {
        // Address confirmed → ask if they want to save it
        await prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: { flowSubState: 'WAITING_SAVE_CONFIRM' },
        });
        await this.sendText(ctx, TEMPLATES.askSaveAddress);
        return 'ADDRESS_SAVE_PROMPT';
      }

      if (this.matchesKeyword(text, EDIT_KEYWORDS)) {
        // User wants to re-enter address
        await prisma.order.update({
          where: { id: order.id },
          data: { deliveryAddress: null },
        });
        await this.sendText(ctx, TEMPLATES.addressRetry);
        return 'ADDRESS_COLLECTION';
      }

      // Unrecognized → remind
      await this.sendText(ctx, 'Lutfen *"evet"* ile onaylayin veya *"hayir"* yazarak adresinizi tekrar girin.');
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
    const { tenantId, conversationId, message, conversation } = ctx;
    const text = normalizeTr(message.text || '');

    if (message.kind !== 'TEXT' || !text) {
      return 'ADDRESS_SAVE_PROMPT';
    }

    const subState = conversation.flowSubState || 'WAITING_SAVE_CONFIRM';

    if (subState === 'WAITING_SAVE_CONFIRM') {
      if (this.matchesKeyword(text, CONFIRM_KEYWORDS)) {
        // User wants to save — ask for name
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { flowSubState: 'WAITING_ADDRESS_NAME' },
        });
        await this.sendText(ctx, TEMPLATES.askAddressName);
        return 'ADDRESS_SAVE_PROMPT';
      }

      // "hayir" or cancel — skip saving, go to payment
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { flowSubState: null },
      });
      await this.sendText(ctx, TEMPLATES.addressNotSaved);
      await this.sendPaymentButtons(ctx);
      return 'PAYMENT_METHOD_SELECTION';
    }

    if (subState === 'WAITING_ADDRESS_NAME') {
      const name = (message.text || '').trim();

      // Get customer location and store from conversation's geo check
      const customerLat = conversation.customerLat;
      const customerLng = conversation.customerLng;
      const nearestStoreId = conversation.nearestStoreId;

      // Get delivery address from active order
      const order = await this.getActiveOrder(ctx);
      const address = order?.deliveryAddress || '';

      if (customerLat && customerLng && nearestStoreId && address) {
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

      // Clear sub-state and proceed to payment
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { flowSubState: null },
      });
      await this.sendPaymentButtons(ctx);
      return 'PAYMENT_METHOD_SELECTION';
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

  /**
   * Checks if user text is a FULL order cancellation intent vs item-level removal.
   * "iptal", "siparis iptal", "siparisi iptal et", "vazgec" → full cancel
   * "salata iptal", "kolayi sil", "1 ayrani cikar" → item removal (NOT full cancel)
   */
  private isFullCancelIntent(text: string): boolean {
    const words = text.split(/\s+/).filter(Boolean);
    // Pure cancel keywords (1-2 word phrases)
    const fullCancelPhrases = [
      'iptal', 'vazgec', 'istemiyorum', 'temizle',
      'siparis iptal', 'siparisi iptal', 'siparisi iptal et',
      'siparis sil', 'hepsini iptal', 'hepsini sil',
      'tum siparisi iptal', 'her seyi iptal',
    ];

    // Check if text exactly matches or is very close to a full cancel phrase
    if (fullCancelPhrases.includes(text)) return true;

    // If there's only one word and it's a cancel keyword, it's full cancel
    if (words.length === 1 && CANCEL_KEYWORDS.includes(words[0])) return true;

    // If the text starts with "siparis" + cancel keyword, it's full cancel
    if (words.length <= 3 && words[0] === 'siparis' && CANCEL_KEYWORDS.some(k => text.includes(k))) return true;
    if (words.length <= 3 && words[0] === 'siparisi' && CANCEL_KEYWORDS.some(k => text.includes(k))) return true;

    // Otherwise, likely item-level removal (e.g., "salata iptal", "1 kola sil")
    return false;
  }
}

export const conversationFlowService = new ConversationFlowService();
