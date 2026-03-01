import prisma from '../db/prisma';
import { createLogger } from '../logger';

const logger = createLogger();

export interface FavoriteItem {
  menuItemId: string;
  menuItemName: string;
  totalQty: number;
  orderCount: number;
  lastOrderedAt: Date;
  currentPrice: number;
  isAvailable: boolean;
  category: string;
  score: number;
}

class ReorderService {
  /**
   * Get ranked favorite items for a customer.
   * Ranking: orderCount * 3 + totalQty + recencyBonus
   * recencyBonus: within 7 days +5, within 30 days +2, else 0
   */
  async getFavorites(
    tenantId: string,
    customerPhone: string,
    limit = 10,
  ): Promise<FavoriteItem[]> {
    // Get all delivered/confirmed order items for this customer
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          tenantId,
          customerPhone,
          status: { in: ['DELIVERED', 'CONFIRMED', 'PREPARING', 'READY'] },
        },
      },
      select: {
        menuItemId: true,
        menuItemName: true,
        qty: true,
        createdAt: true,
      },
    });

    if (orderItems.length === 0) return [];

    // Group by menuItemId
    const itemMap = new Map<
      string,
      { menuItemName: string; totalQty: number; orderCount: number; lastOrderedAt: Date }
    >();

    for (const oi of orderItems) {
      const existing = itemMap.get(oi.menuItemId);
      if (existing) {
        existing.totalQty += oi.qty;
        existing.orderCount += 1;
        if (oi.createdAt > existing.lastOrderedAt) {
          existing.lastOrderedAt = oi.createdAt;
        }
      } else {
        itemMap.set(oi.menuItemId, {
          menuItemName: oi.menuItemName,
          totalQty: oi.qty,
          orderCount: 1,
          lastOrderedAt: oi.createdAt,
        });
      }
    }

    // Get current menu items to check availability and price
    const menuItemIds = Array.from(itemMap.keys());
    const menuItems = await prisma.menuItem.findMany({
      where: {
        id: { in: menuItemIds },
        tenantId,
      },
      select: {
        id: true,
        name: true,
        basePrice: true,
        isActive: true,
        category: true,
      },
    });

    const menuMap = new Map(menuItems.map((m) => [m.id, m]));
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Build scored favorites
    const favorites: FavoriteItem[] = [];

    for (const [menuItemId, data] of itemMap.entries()) {
      const menuItem = menuMap.get(menuItemId);
      if (!menuItem || !menuItem.isActive) continue;

      let recencyBonus = 0;
      if (data.lastOrderedAt > sevenDaysAgo) recencyBonus = 5;
      else if (data.lastOrderedAt > thirtyDaysAgo) recencyBonus = 2;

      const score = data.orderCount * 3 + data.totalQty + recencyBonus;

      favorites.push({
        menuItemId,
        menuItemName: menuItem.name,
        totalQty: data.totalQty,
        orderCount: data.orderCount,
        lastOrderedAt: data.lastOrderedAt,
        currentPrice: Number(menuItem.basePrice),
        isAvailable: menuItem.isActive,
        category: menuItem.category,
        score,
      });
    }

    // Sort by score descending
    favorites.sort((a, b) => b.score - a.score);

    return favorites.slice(0, limit);
  }

  /**
   * Build WhatsApp list message sections from favorites, grouped by category.
   */
  buildFavoritesListSections(
    favorites: FavoriteItem[],
  ): Array<{ title: string; rows: Array<{ id: string; title: string; description: string }> }> {
    // Group by category
    const categoryMap = new Map<string, FavoriteItem[]>();
    for (const fav of favorites) {
      const items = categoryMap.get(fav.category) || [];
      items.push(fav);
      categoryMap.set(fav.category, items);
    }

    const sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description: string }>;
    }> = [];

    for (const [category, items] of categoryMap.entries()) {
      sections.push({
        title: category.substring(0, 24),
        rows: items.map((item) => ({
          id: `reorder_${item.menuItemId}`,
          title: item.menuItemName.substring(0, 24),
          description: `${item.orderCount}x siparis - ${item.currentPrice.toFixed(0)} TL`.substring(
            0,
            72,
          ),
        })),
      });
    }

    return sections;
  }

  /**
   * Add a favorite item to an existing draft or create a new draft order.
   */
  async addFavoriteToOrder(
    tenantId: string,
    conversationId: string,
    menuItemId: string,
    qty: number,
  ): Promise<{ orderId: string; itemName: string; unitPrice: number }> {
    const menuItem = await prisma.menuItem.findFirst({
      where: { id: menuItemId, tenantId, isActive: true },
    });

    if (!menuItem) {
      throw new Error('Menu item not available');
    }

    // Check for existing draft
    let order = await prisma.order.findFirst({
      where: { tenantId, conversationId, status: 'DRAFT' },
    });

    if (!order) {
      // Get conversation for customer info
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      order = await prisma.order.create({
        data: {
          tenantId,
          conversationId,
          status: 'DRAFT',
          totalPrice: 0,
          customerPhone: conversation?.customerPhone,
          customerName: conversation?.customerName,
        },
      });
    }

    // Add item
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        qty,
        unitPrice: menuItem.basePrice,
      },
    });

    // Update total
    const allItems = await prisma.orderItem.findMany({
      where: { orderId: order.id },
    });
    const total = allItems.reduce(
      (sum, i) => sum + Number(i.unitPrice) * i.qty,
      0,
    );
    await prisma.order.update({
      where: { id: order.id },
      data: { totalPrice: total },
    });

    logger.info(
      { tenantId, conversationId, menuItemId, orderId: order.id },
      'Favorite item added to order',
    );

    return {
      orderId: order.id,
      itemName: menuItem.name,
      unitPrice: Number(menuItem.basePrice),
    };
  }
}

export const reorderService = new ReorderService();
