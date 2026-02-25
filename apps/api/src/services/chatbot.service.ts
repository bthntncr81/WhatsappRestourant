import OpenAI from 'openai';
import prisma from '../db/prisma';
import { menuService } from './menu.service';
import { createLogger } from '../logger';

const logger = createLogger();

interface OrderItem {
  menuItemId: string;
  menuItemName: string;
  qty: number;
  unitPrice: number;
}

interface ChatSession {
  history: { role: 'user' | 'assistant' | 'system'; content: string }[];
  currentOrder: OrderItem[];
  orderId?: string;
}

// In-memory session storage
const chatSessions = new Map<string, ChatSession>();

export class ChatbotService {
  private openai: OpenAI | null = null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      logger.info('OpenAI client initialized');
    } else {
      logger.warn('OPENAI_API_KEY not set - chatbot will use mock responses');
    }
  }

  private getSessionKey(tenantId: string, userId: string): string {
    return `${tenantId}:${userId}`;
  }

  private async getSession(tenantId: string, userId: string): Promise<ChatSession> {
    const key = this.getSessionKey(tenantId, userId);
    if (!chatSessions.has(key)) {
      const systemPrompt = await this.buildSystemPrompt(tenantId);
      chatSessions.set(key, {
        history: [{ role: 'system', content: systemPrompt }],
        currentOrder: [],
      });
    }
    return chatSessions.get(key)!;
  }

  async processMessage(
    tenantId: string,
    userId: string,
    userMessage: string
  ): Promise<{ reply: string; order?: { id: string; items: OrderItem[]; total: number; status: string } }> {
    const session = await this.getSession(tenantId, userId);
    session.history.push({ role: 'user', content: userMessage });

    const lowerMessage = userMessage.toLowerCase().trim();

    // Check for confirmation keywords
    if (this.isConfirmation(lowerMessage) && session.currentOrder.length > 0) {
      return await this.confirmOrder(tenantId, userId, session);
    }

    // Check for cancel keywords
    if (this.isCancellation(lowerMessage)) {
      return this.cancelOrder(session);
    }

    // Check for menu request
    if (this.isMenuRequest(lowerMessage)) {
      return await this.showMenu(tenantId, session);
    }

    // Try to extract order items
    const extractedItems = await this.extractOrderItems(tenantId, userMessage);
    
    if (extractedItems.length > 0) {
      // Add items to current order
      for (const item of extractedItems) {
        const existingIndex = session.currentOrder.findIndex(i => i.menuItemId === item.menuItemId);
        if (existingIndex >= 0) {
          session.currentOrder[existingIndex].qty += item.qty;
        } else {
          session.currentOrder.push(item);
        }
      }

      const reply = this.buildOrderSummary(session.currentOrder, false);
      session.history.push({ role: 'assistant', content: reply });
      
      return { 
        reply,
        order: {
          id: session.orderId || 'draft',
          items: session.currentOrder,
          total: this.calculateTotal(session.currentOrder),
          status: 'DRAFT'
        }
      };
    }

    // Default response
    let reply: string;
    if (this.openai) {
      try {
        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          messages: session.history as OpenAI.Chat.ChatCompletionMessageParam[],
          temperature: 0.7,
          max_tokens: 500,
        });
        reply = completion.choices[0]?.message?.content || this.getDefaultResponse();
      } catch (error) {
        logger.error({ error }, 'OpenAI API error');
        reply = this.getDefaultResponse();
      }
    } else {
      reply = this.getDefaultResponse();
    }

    session.history.push({ role: 'assistant', content: reply });

    // Trim history
    if (session.history.length > 20) {
      const systemMessage = session.history[0];
      session.history = [systemMessage, ...session.history.slice(-18)];
    }

    return { reply };
  }

  private async extractOrderItems(tenantId: string, message: string): Promise<OrderItem[]> {
    const items: OrderItem[] = [];
    
    try {
      // Get menu items
      const menu = await menuService.getPublishedMenu(tenantId);
      if (!menu || !menu.categories) return items;

      const allMenuItems: { id: string; name: string; price: number; nameLower: string; nameNormalized: string; nameNoSpaces: string }[] = [];
      
      for (const category of menu.categories) {
        for (const item of category.items) {
          const nameLower = item.name.toLowerCase();
          allMenuItems.push({
            id: item.id,
            name: item.name,
            price: item.basePrice,
            nameLower,
            nameNormalized: this.normalizeForMatch(nameLower),
            nameNoSpaces: nameLower.replace(/\s+/g, ''),
          });
        }
      }

      const lowerMessage = message.toLowerCase();
      const normalizedMessage = this.normalizeForMatch(lowerMessage);
      const noSpacesMessage = lowerMessage.replace(/\s+/g, '');
      
      // Sort menu items by name length (longest first) to match more specific items first
      allMenuItems.sort((a, b) => b.nameLower.length - a.nameLower.length);

      // Track what parts of the message we've already matched
      let remainingMessage = lowerMessage;
      let remainingNormalized = normalizedMessage;
      let remainingNoSpaces = noSpacesMessage;
      const matchedItemIds = new Set<string>();

      for (const menuItem of allMenuItems) {
        if (matchedItemIds.has(menuItem.id)) continue;

        // Check multiple matching strategies:
        // 1. Exact include (e.g. "kola" in "bir kola istiyorum")
        // 2. Normalized include (handles Turkish chars: ş->s, ç->c, etc.)
        // 3. No-space include (e.g. "cheeseburger" matches "cheese burger")
        // 4. Word-by-word match (all words of item name found in message)
        const hasExactMatch = remainingMessage.includes(menuItem.nameLower);
        const hasNormalizedMatch = remainingNormalized.includes(menuItem.nameNormalized);
        const hasNoSpaceMatch = remainingNoSpaces.includes(menuItem.nameNoSpaces);
        const hasWordMatch = this.allWordsMatch(menuItem.nameLower, remainingMessage);

        if (!hasExactMatch && !hasNormalizedMatch && !hasNoSpaceMatch && !hasWordMatch) continue;

        // Determine which form to use for quantity regex
        let matchTarget = remainingMessage;
        let namePattern = menuItem.nameLower;

        if (hasExactMatch) {
          matchTarget = remainingMessage;
          namePattern = menuItem.nameLower;
        } else if (hasNoSpaceMatch) {
          matchTarget = remainingNoSpaces;
          namePattern = menuItem.nameNoSpaces;
        } else if (hasNormalizedMatch) {
          matchTarget = remainingNormalized;
          namePattern = menuItem.nameNormalized;
        } else if (hasWordMatch) {
          matchTarget = remainingMessage;
          // Build pattern that matches words in any order with stuff in between
          namePattern = menuItem.nameLower;
        }

        // Try to find quantity before/near the item name
        let qty = 1;

        // Strategy 1: Look for "N (adet|tane)? itemName" pattern
        const itemPattern = new RegExp(
          `(\\d+)?\\s*(adet|tane)?\\s*(daha|de|da|fazla|dahi)?\\s*${this.escapeRegex(namePattern)}`,
          'i'
        );
        const match = matchTarget.match(itemPattern);
        if (match && match[1]) {
          qty = parseInt(match[1]);
        }

        // Strategy 2: Look for "bir/iki/üç itemName" pattern (Turkish number words)
        if (qty === 1) {
          const turkishNumbers: Record<string, number> = {
            'bir': 1, 'iki': 2, 'üç': 3, 'uc': 3, 'dört': 4, 'dort': 4,
            'beş': 5, 'bes': 5, 'altı': 6, 'alti': 6, 'yedi': 7, 'sekiz': 8,
            'dokuz': 9, 'on': 10
          };
          const wordQtyPattern = new RegExp(
            `(${Object.keys(turkishNumbers).join('|')})\\s*(adet|tane)?\\s*(daha|de|da|fazla|dahi)?\\s*${this.escapeRegex(namePattern)}`,
            'i'
          );
          const wordMatch = matchTarget.match(wordQtyPattern);
          if (wordMatch && wordMatch[1]) {
            qty = turkishNumbers[wordMatch[1].toLowerCase()] || 1;
          }
        }

        items.push({
          menuItemId: menuItem.id,
          menuItemName: menuItem.name,
          qty: qty,
          unitPrice: menuItem.price
        });

        matchedItemIds.add(menuItem.id);

        // Remove matched parts
        if (hasExactMatch && match) {
          remainingMessage = remainingMessage.replace(itemPattern, ' ');
        }
        remainingNormalized = remainingNormalized.replace(new RegExp(this.escapeRegex(menuItem.nameNormalized), 'i'), ' ');
        remainingNoSpaces = remainingNoSpaces.replace(new RegExp(this.escapeRegex(menuItem.nameNoSpaces), 'i'), ' ');
      }
    } catch (error) {
      logger.warn({ tenantId, error }, 'Error extracting order items');
    }

    return items;
  }

  /**
   * Normalize text for fuzzy matching: remove diacritics, Turkish chars
   */
  private normalizeForMatch(text: string): string {
    return text
      .replace(/ş/g, 's').replace(/Ş/g, 's')
      .replace(/ç/g, 'c').replace(/Ç/g, 'c')
      .replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
      .replace(/ü/g, 'u').replace(/Ü/g, 'u')
      .replace(/ö/g, 'o').replace(/Ö/g, 'o')
      .replace(/ı/g, 'i').replace(/İ/g, 'i')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Check if all words of itemName appear in the message
   */
  private allWordsMatch(itemName: string, message: string): boolean {
    const itemWords = itemName.split(/\s+/).filter(w => w.length > 1);
    if (itemWords.length === 0) return false;
    const messageNorm = this.normalizeForMatch(message);
    return itemWords.every(word => {
      const normWord = this.normalizeForMatch(word);
      return messageNorm.includes(normWord);
    });
  }

  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async confirmOrder(
    tenantId: string, 
    userId: string, 
    session: ChatSession
  ): Promise<{ reply: string; order?: { id: string; items: OrderItem[]; total: number; status: string; storeId?: string; storeName?: string } }> {
    if (session.currentOrder.length === 0) {
      const reply = '❌ Henüz sepetinizde ürün yok. Önce sipariş ekleyin.';
      session.history.push({ role: 'assistant', content: reply });
      return { reply };
    }

    try {
      // Create or get chatbot conversation
      const chatbotPhone = `chatbot-${userId}`;
      let conversation = await prisma.conversation.findFirst({
        where: { tenantId, customerPhone: chatbotPhone }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            tenantId,
            customerPhone: chatbotPhone,
            customerName: 'Chatbot Test User',
            status: 'OPEN',
          }
        });
      }

      // Find store to assign order to
      // Priority: 1. Conversation's nearestStoreId, 2. First active store, 3. null
      let storeId: string | null = conversation.nearestStoreId;
      let storeName: string | null = null;

      if (!storeId) {
        // No store from geo check, try to find default/first active store
        const defaultStore = await prisma.store.findFirst({
          where: { tenantId, isActive: true },
          orderBy: { createdAt: 'asc' },
        });
        if (defaultStore) {
          storeId = defaultStore.id;
          storeName = defaultStore.name;
        }
      } else {
        // Get store name
        const store = await prisma.store.findUnique({
          where: { id: storeId },
          select: { name: true },
        });
        storeName = store?.name || null;
      }

      // Create real order in database
      const totalPrice = this.calculateTotal(session.currentOrder);
      
      // Get next order number
      const lastOrder = await prisma.order.findFirst({
        where: { tenantId },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true }
      });
      const orderNumber = (lastOrder?.orderNumber || 0) + 1;

      const order = await prisma.order.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          storeId, // Assign to store
          orderNumber,
          totalPrice,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          customerPhone: chatbotPhone,
          customerName: 'Chatbot Test User',
          items: {
            create: session.currentOrder.map(item => ({
              menuItemId: item.menuItemId,
              menuItemName: item.menuItemName,
              qty: item.qty,
              unitPrice: item.unitPrice,
            }))
          }
        },
        include: { items: true, store: { select: { name: true } } }
      });

      session.orderId = order.id;

      const storeInfo = order.store?.name ? `\n🏪 Şube: ${order.store.name}` : '';
      const reply = `✅ **SİPARİŞİNİZ ONAYLANDI!**

🎫 Sipariş No: #${orderNumber}
📅 Tarih: ${new Date().toLocaleString('tr-TR')}${storeInfo}

${this.buildOrderSummary(session.currentOrder, true)}

🎉 Siparişiniz mutfağa iletildi!
⏱️ Tahmini hazırlık süresi: 25-30 dakika

Afiyet olsun! 🍽️`;

      session.history.push({ role: 'assistant', content: reply });

      // Clear order after confirmation
      const confirmedOrder = {
        id: order.id,
        items: [...session.currentOrder],
        total: totalPrice,
        status: 'CONFIRMED',
        storeId: order.storeId || undefined,
        storeName: order.store?.name || undefined,
      };
      
      session.currentOrder = [];

      logger.info({ tenantId, orderId: order.id, storeId, total: totalPrice }, 'Chatbot order confirmed');

      return { reply, order: confirmedOrder };
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to create order from chatbot');
      const reply = '❌ Sipariş oluşturulurken bir hata oluştu. Lütfen tekrar deneyin.';
      session.history.push({ role: 'assistant', content: reply });
      return { reply };
    }
  }

  private cancelOrder(session: ChatSession): { reply: string } {
    session.currentOrder = [];
    session.orderId = undefined;
    const reply = `❌ **Sipariş İptal Edildi**

Sepetiniz temizlendi. Yeni sipariş vermek için menüden seçim yapabilirsiniz.

💡 "Menü" yazarak ürünlerimizi görebilirsiniz.`;
    session.history.push({ role: 'assistant', content: reply });
    return { reply };
  }

  private async showMenu(tenantId: string, session: ChatSession): Promise<{ reply: string }> {
    let reply = '';
    
    try {
      const menu = await menuService.getPublishedMenu(tenantId);
      if (menu && menu.categories && menu.categories.length > 0) {
        reply = '📋 **MENÜMÜZ**\n\n';
        for (const category of menu.categories) {
          reply += `**${category.name}**\n`;
          for (const item of category.items) {
            reply += `• ${item.name}: ${item.basePrice} TL\n`;
          }
          reply += '\n';
        }
        reply += '\n💡 Sipariş vermek için örneğin "1 adet Adana Kebap istiyorum" yazabilirsiniz.';
      } else {
        reply = this.getDefaultMenu();
      }
    } catch (error) {
      reply = this.getDefaultMenu();
    }

    session.history.push({ role: 'assistant', content: reply });
    return { reply };
  }

  private getDefaultMenu(): string {
    return `📋 **MENÜMÜZ**

🍖 **Kebaplar**
• Adana Kebap: 120 TL
• Urfa Kebap: 110 TL
• Tavuk Şiş: 90 TL
• Et Döner: 130 TL

🌮 **Lahmacun & Pide**
• Lahmacun: 45 TL
• Karışık Pide: 80 TL
• Kaşarlı Pide: 70 TL

🥤 **İçecekler**
• Ayran: 15 TL
• Kola: 25 TL
• Su: 10 TL

💡 Sipariş vermek için örneğin "1 adet Adana Kebap istiyorum" yazabilirsiniz.`;
  }

  private buildOrderSummary(items: OrderItem[], isConfirmed: boolean): string {
    const total = this.calculateTotal(items);
    
    let summary = isConfirmed ? '📝 **Sipariş Detayı:**\n' : '🛒 **Sepetiniz:**\n';
    
    for (const item of items) {
      summary += `• ${item.qty}x ${item.menuItemName}: ${item.qty * item.unitPrice} TL\n`;
    }
    
    summary += `\n💰 **Toplam: ${total} TL**`;
    
    if (!isConfirmed) {
      summary += '\n\n✅ Onaylamak için "onayla" veya "evet" yazın.\n❌ İptal için "iptal" yazın.\n➕ Başka ürün eklemek için sipariş verin.';
    }
    
    return summary;
  }

  private calculateTotal(items: OrderItem[]): number {
    return items.reduce((sum, item) => sum + (item.qty * item.unitPrice), 0);
  }

  private isConfirmation(message: string): boolean {
    const confirmKeywords = ['onayla', 'onaylıyorum', 'tamam', 'evet', 'olsun', 'siparişi ver', 'tamamla'];
    return confirmKeywords.some(k => message.includes(k));
  }

  private isCancellation(message: string): boolean {
    const cancelKeywords = ['iptal', 'vazgeç', 'istemiyorum', 'sil', 'temizle'];
    return cancelKeywords.some(k => message.includes(k));
  }

  private isMenuRequest(message: string): boolean {
    const menuKeywords = ['menü', 'menu', 'ne var', 'neler var', 'ürünler', 'fiyat', 'liste'];
    return menuKeywords.some(k => message.includes(k));
  }

  private getDefaultResponse(): string {
    return `Merhaba! 👋 Ben sipariş asistanınızım.

💡 **Nasıl sipariş verebilirsiniz:**
• "Menü" - Ürünleri görün
• "1 adet Adana Kebap istiyorum" - Sipariş verin
• "Onayla" - Siparişi onaylayın

Ne sipariş etmek istersiniz?`;
  }

  private async buildSystemPrompt(tenantId: string): Promise<string> {
    let menuContext = '';
    try {
      const menu = await menuService.getPublishedMenu(tenantId);
      if (menu && menu.categories) {
        const items: string[] = [];
        for (const category of menu.categories) {
          items.push(`\n${category.name}:`);
          for (const item of category.items) {
            items.push(`- ${item.name}: ${item.basePrice} TL`);
          }
        }
        menuContext = items.join('\n');
      }
    } catch (error) {
      logger.warn({ tenantId, error }, 'Could not fetch menu for chatbot');
    }

    return `Sen bir restoran sipariş asistanısın. Türkçe konuş.

MENÜ:${menuContext || '\nVarsayılan menü kullanılıyor.'}

KURALLAR:
- Sipariş aldığında kısa ve öz yanıt ver
- Fiyatları doğru hesapla
- Belirsizlikte sor
- Türkçe konuş`;
  }

  async getChatHistory(tenantId: string, userId: string): Promise<unknown[]> {
    const session = await this.getSession(tenantId, userId);
    return session.history;
  }

  async clearChatHistory(tenantId: string, userId: string): Promise<void> {
    const key = this.getSessionKey(tenantId, userId);
    chatSessions.delete(key);
  }

  // ==================== ORDER STATUS NOTIFICATIONS ====================

  /**
   * Get status message in Turkish
   */
  getStatusMessage(status: string, orderNumber?: number): string {
    const orderText = orderNumber ? `#${orderNumber}` : '';
    
    const messages: Record<string, string> = {
      'CONFIRMED': `✅ Siparişiniz ${orderText} onaylandı! Hazırlanmaya başlıyor...`,
      'PREPARING': `👨‍🍳 Siparişiniz ${orderText} hazırlanıyor! Lütfen bekleyin...`,
      'READY': `🎉 Siparişiniz ${orderText} hazır! Kurye yola çıkmak üzere.`,
      'OUT_FOR_DELIVERY': `🚀 Siparişiniz ${orderText} yola çıktı! Kapınızda olacak.`,
      'DELIVERED': `✅ Siparişiniz ${orderText} teslim edildi! Afiyet olsun! 🍽️`,
      'CANCELLED': `❌ Siparişiniz ${orderText} iptal edildi.`,
    };

    return messages[status] || `📦 Sipariş durumu: ${status}`;
  }

  /**
   * Send order status notification to user's chat session
   */
  async sendOrderStatusNotification(
    tenantId: string,
    orderId: string,
    newStatus: string
  ): Promise<void> {
    try {
      // Get order details
      const order = await prisma.order.findFirst({
        where: { id: orderId, tenantId },
        select: { 
          orderNumber: true, 
          customerPhone: true,
          conversationId: true 
        }
      });

      if (!order) {
        logger.warn({ tenantId, orderId }, 'Order not found for notification');
        return;
      }

      const statusMessage = this.getStatusMessage(newStatus, order.orderNumber || undefined);

      // If order has a conversation, add message there
      if (order.conversationId) {
        await prisma.message.create({
          data: {
            tenantId,
            conversationId: order.conversationId,
            direction: 'OUT',
            kind: 'SYSTEM',
            text: statusMessage,
          }
        });
        logger.info({ tenantId, orderId, status: newStatus }, 'Order status notification sent to conversation');
      }

      // Also update any chatbot sessions for this user
      if (order.customerPhone) {
        const sessionKey = `${tenantId}:${order.customerPhone}`;
        const session = chatSessions.get(sessionKey);
        if (session) {
          session.history.push({
            role: 'assistant',
            content: statusMessage
          });
        }
      }

      logger.info({ tenantId, orderId, newStatus }, 'Order status notification processed');
    } catch (error) {
      logger.error({ tenantId, orderId, newStatus, error }, 'Failed to send order status notification');
    }
  }
}

export const chatbotService = new ChatbotService();
