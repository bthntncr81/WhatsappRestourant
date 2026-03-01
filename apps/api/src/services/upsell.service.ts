import OpenAI from 'openai';
import { getConfig } from '@whatres/config';
import prisma from '../db/prisma';
import { createLogger } from '../logger';

const logger = createLogger();

export interface UpsellSuggestion {
  itemId: string;
  itemName: string;
  price: number;
  message: string;
  source: 'rule' | 'history' | 'ai';
}

const UPSELL_SYSTEM_PROMPT = `Sen bir restoran chatbotusun. Musteriye capraz satis onerisi yapacaksin.
Kurallar:
- Samimi, esprili, arkadasca tonda yaz
- Turkce, kisa (max 2 cumle)
- Emoji kullan ama abartma (max 1)
- Musterinin adini kullan (varsa)
- Fiyat bilgisini dogal sekilde ver
- Baskici olma, teklif et
- Sadece mesaj metnini yaz, baska bir sey ekleme

Ornekler:
- "Sutlaci unuttun sanki :) sadece 8 TL!"
- "Doner yanina bir ayran ne gider be! 🥛 5 TL"
- "Bu siparis tatlisiz olmaz, baklava ekleyelim mi? 😋 12 TL"
- "Ahmet bey, her zamanki ayraninizi da ekleyelim mi? 🥛 5 TL"`;

export class UpsellService {
  private client: OpenAI | null = null;
  private config = getConfig();

  constructor() {
    if (this.config.openai.apiKey) {
      this.client = new OpenAI({ apiKey: this.config.openai.apiKey });
    }
  }

  /**
   * Get a cross-sell suggestion for the current order.
   * Returns null if no good suggestion found.
   */
  async getSuggestion(
    tenantId: string,
    orderId: string,
    customerPhone: string,
    customerName: string | null,
  ): Promise<UpsellSuggestion | null> {
    try {
      // Get current order with items
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order || order.items.length === 0) return null;

      const currentItemIds = order.items.map(i => i.menuItemId);
      const currentItemNames = order.items.map(i => i.menuItemName);

      // Try layers in priority order
      const suggestion =
        (await this.tryManualRules(tenantId, currentItemIds, currentItemNames)) ||
        (await this.tryFrequentlyBoughtTogether(tenantId, currentItemIds, currentItemNames));

      if (!suggestion) return null;

      // Check spam: don't suggest same item to same customer twice in a row
      const recentReject = await prisma.upsellEvent.findFirst({
        where: {
          tenantId,
          conversationId: order.conversationId,
          suggestedItemId: suggestion.itemId,
          accepted: false,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (recentReject) {
        // Check if there have been at least 3 orders since the reject
        const ordersSinceReject = await prisma.order.count({
          where: {
            tenantId,
            customerPhone,
            status: { not: 'DRAFT' },
            createdAt: { gt: recentReject.createdAt },
          },
        });
        if (ordersSinceReject < 3) return null;
      }

      // Generate AI message
      const message = await this.generateMessage(
        suggestion,
        currentItemNames,
        customerName,
        customerPhone,
        tenantId,
      );

      return { ...suggestion, message };
    } catch (err) {
      logger.error({ err }, 'Upsell suggestion failed');
      return null;
    }
  }

  /**
   * Layer 1: Check manual cross-sell rules
   */
  private async tryManualRules(
    tenantId: string,
    currentItemIds: string[],
    currentItemNames: string[],
  ): Promise<Omit<UpsellSuggestion, 'message'> | null> {
    const rules = await prisma.crossSellRule.findMany({
      where: {
        tenantId,
        isActive: true,
        triggerItemId: { in: currentItemIds },
        suggestItemId: { notIn: currentItemIds },
      },
      include: {
        suggestItem: { select: { id: true, name: true, basePrice: true, isActive: true } },
      },
      orderBy: { priority: 'desc' },
      take: 1,
    });

    const rule = rules[0];
    if (!rule || !rule.suggestItem.isActive) return null;

    return {
      itemId: rule.suggestItem.id,
      itemName: rule.suggestItem.name,
      price: Number(rule.suggestItem.basePrice),
      source: 'rule',
    };
  }

  /**
   * Layer 2: Find items frequently ordered together across all orders
   */
  private async tryFrequentlyBoughtTogether(
    tenantId: string,
    currentItemIds: string[],
    currentItemNames: string[],
  ): Promise<Omit<UpsellSuggestion, 'message'> | null> {
    // Get orders that contain any of the current items
    const relatedOrders = await prisma.order.findMany({
      where: {
        tenantId,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        items: { some: { menuItemId: { in: currentItemIds } } },
      },
      include: { items: { select: { menuItemId: true, menuItemName: true } } },
      take: 200,
    });

    if (relatedOrders.length < 3) return null;

    // Count co-occurrences
    const coCount = new Map<string, { name: string; count: number }>();
    for (const order of relatedOrders) {
      for (const item of order.items) {
        if (currentItemIds.includes(item.menuItemId)) continue;
        const existing = coCount.get(item.menuItemId) || { name: item.menuItemName, count: 0 };
        existing.count++;
        coCount.set(item.menuItemId, existing);
      }
    }

    // Sort by frequency, min 3
    const sorted = Array.from(coCount.entries())
      .filter(([, v]) => v.count >= 3)
      .sort((a, b) => b[1].count - a[1].count);

    if (sorted.length === 0) return null;

    const [topItemId, topData] = sorted[0];

    // Get menu item for price
    const menuItem = await prisma.menuItem.findFirst({
      where: { id: topItemId, isActive: true },
      select: { id: true, name: true, basePrice: true },
    });

    if (!menuItem) return null;

    return {
      itemId: menuItem.id,
      itemName: menuItem.name,
      price: Number(menuItem.basePrice),
      source: 'history',
    };
  }

  /**
   * Generate a friendly upsell message using GPT
   */
  private async generateMessage(
    suggestion: Omit<UpsellSuggestion, 'message'>,
    currentItemNames: string[],
    customerName: string | null,
    customerPhone: string,
    tenantId: string,
  ): Promise<string> {
    // Check if customer has ordered this item before
    const previousCount = await prisma.orderItem.count({
      where: {
        menuItemId: suggestion.itemId,
        order: {
          tenantId,
          customerPhone,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
      },
    });

    // If no AI available, use a template-based message
    if (!this.client) {
      return this.getFallbackMessage(suggestion, currentItemNames, customerName, previousCount);
    }

    try {
      const userPrompt = [
        customerName ? `Musteri: ${customerName}` : 'Musteri: Misafir',
        `Mevcut sepet: ${currentItemNames.join(', ')}`,
        `Onerilen urun: ${suggestion.itemName} (${suggestion.price} TL)`,
        `Musteri bu urunu daha once ${previousCount} kez siparis etmis.`,
        'Samimi bir capraz satis mesaji yaz.',
      ].join('\n');

      const response = await this.client.chat.completions.create({
        model: this.config.openai.model,
        messages: [
          { role: 'system', content: UPSELL_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_completion_tokens: 100,
      });

      const msg = response.choices[0]?.message?.content?.trim();
      if (msg) return msg;
    } catch (err) {
      logger.warn({ err }, 'AI upsell message generation failed, using fallback');
    }

    return this.getFallbackMessage(suggestion, currentItemNames, customerName, previousCount);
  }

  /**
   * Template-based fallback if AI is not available
   */
  private getFallbackMessage(
    suggestion: Omit<UpsellSuggestion, 'message'>,
    currentItemNames: string[],
    customerName: string | null,
    previousCount: number,
  ): string {
    const name = customerName ? `${customerName}, ` : '';
    const price = `${suggestion.price.toFixed(0)} TL`;

    if (previousCount > 0) {
      return `${name}${suggestion.itemName}'i unuttun sanki :) sadece ${price}!`;
    }
    return `${name}${currentItemNames[0]} yanina ${suggestion.itemName} ne gider be! 😄 ${price}`;
  }

  /**
   * Log an upsell event (accepted or rejected)
   */
  async logEvent(
    tenantId: string,
    conversationId: string,
    orderId: string,
    suggestedItemId: string,
    suggestedName: string,
    accepted: boolean,
    source: string,
  ): Promise<void> {
    await prisma.upsellEvent.create({
      data: {
        tenantId,
        conversationId,
        orderId,
        suggestedItemId,
        suggestedName,
        accepted,
        source,
      },
    });
  }
}

export const upsellService = new UpsellService();
