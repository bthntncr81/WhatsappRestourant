import prisma from '../db/prisma';
import { inboxService } from './inbox.service';
import { conversationFlowService } from './conversation-flow.service';
import { orderPaymentService } from './order-payment.service';
import { createLogger } from '../logger';
import { WhatsAppWebhookPayload } from '@whatres/shared';

const logger = createLogger();

/**
 * ChatbotService acts as a WhatsApp simulator for testing.
 * All messages go through the same conversation-flow.service.ts state machine
 * that real WhatsApp messages use.
 */
export class ChatbotService {
  /**
   * Process a message from the admin panel chatbot test interface.
   * Simulates a WhatsApp webhook by routing through conversation flow.
   */
  async processMessage(
    tenantId: string,
    userId: string,
    userMessage: string,
  ): Promise<{ reply: string; buttons?: Array<{ id: string; title: string }>; order?: unknown }> {
    const chatbotPhone = `chatbot-${userId}`;

    // Get or create conversation (same as WhatsApp incoming)
    const conversation = await inboxService.getOrCreateConversation(
      tenantId,
      chatbotPhone,
      'Chatbot Test User',
    );

    // Store incoming message
    const message = await inboxService.createMessage(
      tenantId,
      conversation.id,
      'IN',
      'TEXT',
      userMessage,
    );

    // Build simulated WhatsApp payload
    const payload: WhatsAppWebhookPayload = {
      from: chatbotPhone,
      fromName: 'Chatbot Test User',
      type: 'text',
      text: { body: userMessage },
    };

    // Check for interactive button simulation
    const lowerMessage = userMessage.toLowerCase().trim();
    if (lowerMessage === 'nakit' || lowerMessage === 'kapida' || lowerMessage === 'kapıda') {
      payload.interactive = { type: 'button_reply', buttonReply: { id: 'pay_cash', title: 'Nakit' } };
      payload.type = 'interactive';
    } else if (lowerMessage === 'kart' || lowerMessage === 'kredi karti' || lowerMessage === 'kredi kartı') {
      payload.interactive = { type: 'button_reply', buttonReply: { id: 'pay_card', title: 'Kredi Karti' } };
      payload.type = 'interactive';
    }

    // Route through conversation flow state machine (same as WhatsApp)
    await conversationFlowService.handleIncomingMessage(
      tenantId,
      conversation.id,
      message,
      payload,
    );

    // Collect bot responses that were created after the user's message
    const botResponses = await this.getRecentBotMessages(tenantId, conversation.id, message.createdAt);

    const reply = botResponses.length > 0
      ? botResponses.map((m) => m.text).join('\n\n')
      : 'Mesajiniz alindi.';

    // Extract interactive buttons from bot responses
    const buttons = this.extractButtons(botResponses, reply);

    return { reply, ...(buttons ? { buttons } : {}) };
  }

  /**
   * Simulate sending a location message (for testing geo flow)
   */
  async sendLocation(
    tenantId: string,
    userId: string,
    latitude: number,
    longitude: number,
  ): Promise<{ reply: string; buttons?: Array<{ id: string; title: string }> }> {
    const chatbotPhone = `chatbot-${userId}`;

    const conversation = await inboxService.getOrCreateConversation(
      tenantId,
      chatbotPhone,
      'Chatbot Test User',
    );

    // Store location message
    const message = await inboxService.createMessage(
      tenantId,
      conversation.id,
      'IN',
      'LOCATION',
      `Location: ${latitude}, ${longitude}`,
      { latitude, longitude },
    );

    // Build simulated WhatsApp location payload
    const payload: WhatsAppWebhookPayload = {
      from: chatbotPhone,
      fromName: 'Chatbot Test User',
      type: 'location',
      location: { latitude, longitude },
    };

    await conversationFlowService.handleIncomingMessage(
      tenantId,
      conversation.id,
      message,
      payload,
    );

    const botResponses = await this.getRecentBotMessages(tenantId, conversation.id, message.createdAt);

    const reply = botResponses.length > 0
      ? botResponses.map((m) => m.text).join('\n\n')
      : 'Konum alindi.';

    // Extract interactive buttons from bot responses
    const buttons = this.extractButtons(botResponses, reply);

    return { reply, ...(buttons ? { buttons } : {}) };
  }

  /**
   * Get recent outbound messages sent after a given timestamp
   */
  private async getRecentBotMessages(
    tenantId: string,
    conversationId: string,
    afterTimestamp: string,
  ): Promise<Array<{ text: string | null; payloadJson: any }>> {
    const messages = await prisma.message.findMany({
      where: {
        tenantId,
        conversationId,
        direction: 'OUT',
        createdAt: { gt: new Date(afterTimestamp) },
      },
      orderBy: { createdAt: 'asc' },
      select: { text: true, payloadJson: true },
    });

    return messages;
  }

  /**
   * Extract interactive buttons from bot responses.
   * Sources:
   * 1. payloadJson.interactive.buttons (from sendInteractiveButtons)
   * 2. Text patterns like "hangisini istersiniz: X mi, Y mi?"
   */
  private extractButtons(
    botResponses: Array<{ text: string | null; payloadJson: any }>,
    fullReply: string,
  ): Array<{ id: string; title: string }> | undefined {
    // 1. Check payloadJson for interactive buttons
    for (const msg of botResponses) {
      const payload = msg.payloadJson as any;
      if (payload?.interactive?.buttons && Array.isArray(payload.interactive.buttons)) {
        return payload.interactive.buttons;
      }
    }

    // 2. Parse clarification questions for button choices
    // Pattern: "hangisini istersiniz: Et Döner mi, Tavuk Döner mi?"
    const hangisiMatch = fullReply.match(/hangisini istersiniz[:\s]+(.+?)(?:\?|$)/i);
    if (hangisiMatch) {
      const choiceStr = hangisiMatch[1];
      // Split by ", " or " mi, " or " mı, " patterns
      const choices = choiceStr
        .split(/,\s*/)
        .map(c => c.replace(/\s*m[iıuü]\s*$/i, '').trim())
        .filter(c => c.length > 0);

      if (choices.length >= 2) {
        return choices.map((c, i) => ({ id: `choice_${i}`, title: c }));
      }
    }

    // 3. Pattern: "Onaylamak icin "evet"" → show evet/iptal buttons when in ORDER_REVIEW
    if (fullReply.includes('Onaylamak icin') && fullReply.includes('"evet"')) {
      return [
        { id: 'confirm', title: 'Evet, Onayla' },
        { id: 'cancel', title: 'İptal' },
      ];
    }

    return undefined;
  }

  // ==================== PAYMENT SIMULATION (TEST ONLY) ====================

  /**
   * Simulate iyzico payment callback for chatbot testing.
   * In production, iyzico calls POST /api/payments/callback/iyzico
   * but localhost is unreachable from iyzico servers.
   */
  async simulatePayment(
    tenantId: string,
    userId: string,
    success: boolean = true,
  ): Promise<{ reply: string; buttons?: Array<{ id: string; title: string }> }> {
    const chatbotPhone = `chatbot-${userId}`;

    const conversation = await prisma.conversation.findFirst({
      where: { tenantId, customerPhone: chatbotPhone },
    });

    if (!conversation) {
      return { reply: 'Aktif siparis bulunamadi.' };
    }

    if (conversation.phase !== 'PAYMENT_PENDING') {
      return { reply: `Odeme beklemiyor. Mevcut asama: ${conversation.phase}` };
    }

    const orderId = conversation.activeOrderId;
    if (!orderId) {
      return { reply: 'Aktif siparis bulunamadi.' };
    }

    // Find pending payment
    const pendingPayment = await orderPaymentService.getPendingPayment(tenantId, orderId);

    if (pendingPayment) {
      // Update payment record directly (simulate callback)
      await prisma.orderPayment.update({
        where: { id: pendingPayment.id },
        data: success
          ? { status: 'SUCCESS', paidAt: new Date() }
          : { status: 'FAILED', errorMessage: 'Simulated failure' },
      });
    }

    // Mark timestamp before triggering flow
    const beforeTrigger = new Date();

    // Trigger conversation flow update (same as real callback)
    await conversationFlowService.handlePaymentCompleted(
      tenantId,
      conversation.id,
      orderId,
      success,
    );

    // Collect only bot responses created AFTER the trigger
    const botResponses = await this.getRecentBotMessages(tenantId, conversation.id, beforeTrigger.toISOString());

    const reply = botResponses.length > 0
      ? botResponses.map((m) => m.text).join('\n\n')
      : success ? 'Odeme basarili!' : 'Odeme basarisiz.';

    const buttons = this.extractButtons(botResponses, reply);

    return { reply, ...(buttons ? { buttons } : {}) };
  }

  // ==================== ORDER STATUS NOTIFICATIONS ====================

  getStatusMessage(status: string, orderNumber?: number): string {
    const orderText = orderNumber ? `#${orderNumber}` : '';
    const messages: Record<string, string> = {
      'PENDING_CONFIRMATION': `⏳ Siparisiniz ${orderText} restoran onayı bekliyor...`,
      'CONFIRMED': `✅ Siparisiniz ${orderText} onaylandi! Hazirlaniyor...`,
      'PREPARING': `👨‍🍳 Siparisiniz ${orderText} hazirlaniyor!`,
      'READY': `🎉 Siparisiniz ${orderText} hazir! Kurye yola cikmak uzere.`,
      'OUT_FOR_DELIVERY': `🚀 Siparisiniz ${orderText} yola cikti!`,
      'DELIVERED': `✅ Siparisiniz ${orderText} teslim edildi! Afiyet olsun!`,
      'CANCELLED': `❌ Siparisiniz ${orderText} iptal edildi.`,
    };
    return messages[status] || `📦 Siparis durumu: ${status}`;
  }

  async sendOrderStatusNotification(
    tenantId: string,
    orderId: string,
    newStatus: string,
  ): Promise<void> {
    try {
      const order = await prisma.order.findFirst({
        where: { id: orderId, tenantId },
        select: { orderNumber: true, conversationId: true },
      });

      if (!order || !order.conversationId) return;

      const statusMessage = this.getStatusMessage(newStatus, order.orderNumber || undefined);

      await prisma.message.create({
        data: {
          tenantId,
          conversationId: order.conversationId,
          direction: 'OUT',
          kind: 'SYSTEM',
          text: statusMessage,
        },
      });

      logger.info({ tenantId, orderId, status: newStatus }, 'Order status notification sent');
    } catch (error) {
      logger.error({ tenantId, orderId, newStatus, error }, 'Failed to send order status notification');
    }
  }

  // Legacy methods for backward compatibility
  async getChatHistory(_tenantId: string, _userId: string): Promise<unknown[]> {
    return [];
  }

  /**
   * Reset chatbot test session: delete messages, orders, intents
   * and set conversation phase back to IDLE.
   */
  async clearChatHistory(tenantId: string, userId: string): Promise<void> {
    const chatbotPhone = `chatbot-${userId}`;

    const conversation = await prisma.conversation.findFirst({
      where: { tenantId, customerPhone: chatbotPhone },
    });

    if (!conversation) return;

    // Delete order-related data for this conversation
    const orders = await prisma.order.findMany({
      where: { tenantId, conversationId: conversation.id },
      select: { id: true },
    });

    const orderIds = orders.map((o) => o.id);

    // Delete all order intents for this conversation
    await prisma.orderIntent.deleteMany({
      where: { tenantId, conversationId: conversation.id },
    });

    if (orderIds.length > 0) {
      await prisma.printJob.deleteMany({
        where: { tenantId, orderId: { in: orderIds } },
      });
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: orderIds } },
      });
    }

    // Delete all messages
    await prisma.message.deleteMany({
      where: { conversationId: conversation.id },
    });

    // Reset conversation to IDLE
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        phase: 'IDLE',
        activeOrderId: null,
        nearestStoreId: null,
        customerLat: null,
        customerLng: null,
        isWithinService: null,
        geoCheckJson: undefined,
      },
    });

    logger.info({ tenantId, conversationId: conversation.id }, 'Chatbot session reset');
  }
}

export const chatbotService = new ChatbotService();
