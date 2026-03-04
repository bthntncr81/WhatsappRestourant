import prisma from '../db/prisma';
import { createLogger } from '../logger';
import { menuService } from './menu.service';

const logger = createLogger();

interface HighFiveMenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  image: string | null;
  available: boolean;
  prepTime: number | null;
  modifiers: { id: string; name: string; price: number }[];
}

interface HighFiveCategory {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
}

interface HighFiveMenuResponse {
  categories: HighFiveCategory[];
  items: HighFiveMenuItem[];
  syncedAt: string;
  totalItems: number;
  totalCategories: number;
}

interface MenuSyncResult {
  versionId: string;
  itemsCreated: number;
  optionGroupsCreated: number;
  optionsCreated: number;
  categoriesFound: number;
}

export class HighFiveIntegrationService {
  /**
   * Pull menu from HighFive and sync to WhatRes
   */
  async pullMenu(tenantId: string): Promise<MenuSyncResult> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant?.highfiveApiUrl || !tenant?.highfiveApiKey) {
      throw new Error('HighFive API ayarları yapılandırılmamış');
    }

    const apiUrl = tenant.highfiveApiUrl.replace(/\/$/, '');
    const locationParam = tenant.highfiveLocationId ? `?locationId=${tenant.highfiveLocationId}` : '';

    // Fetch menu from HighFive
    const response = await fetch(`${apiUrl}/api/external/menu${locationParam}`, {
      headers: {
        'X-API-Key': tenant.highfiveApiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HighFive menü çekme hatası: ${response.status} - ${error}`);
    }

    const menuData: HighFiveMenuResponse = await response.json();

    logger.info(
      { tenantId, categories: menuData.totalCategories, items: menuData.totalItems },
      'HighFive menü verisi alındı',
    );

    // Create new WhatRes menu version
    const version = await menuService.createVersion(tenantId);

    let itemsCreated = 0;
    let optionGroupsCreated = 0;
    let optionsCreated = 0;

    // Group items by category
    const categoryMap = new Map<string, typeof menuData.items>();
    for (const item of menuData.items) {
      const category = menuData.categories.find((c) => c.id === item.categoryId);
      const categoryName = category?.name || 'Diğer';
      if (!categoryMap.has(categoryName)) {
        categoryMap.set(categoryName, []);
      }
      categoryMap.get(categoryName)!.push(item);
    }

    // Create items for each category
    for (const [categoryName, items] of categoryMap.entries()) {
      for (const hfItem of items) {
        // Create menu item
        const createdItem = await prisma.menuItem.create({
          data: {
            tenantId,
            versionId: version.id,
            name: hfItem.name,
            description: hfItem.description,
            basePrice: hfItem.price,
            category: categoryName,
            isActive: hfItem.available,
            externalItemId: hfItem.id,
            sortOrder: itemsCreated,
          },
        });
        itemsCreated++;

        // Create modifiers as option group + options
        if (hfItem.modifiers && hfItem.modifiers.length > 0) {
          const group = await prisma.menuOptionGroup.create({
            data: {
              tenantId,
              versionId: version.id,
              name: `${hfItem.name} Seçenekleri`,
              type: 'MULTI',
              required: false,
              minSelect: 0,
              maxSelect: hfItem.modifiers.length,
            },
          });
          optionGroupsCreated++;

          // Link option group to menu item
          await prisma.menuItemOptionGroup.create({
            data: {
              itemId: createdItem.id,
              groupId: group.id,
              sortOrder: 0,
            },
          });

          // Create options
          for (const mod of hfItem.modifiers) {
            await prisma.menuOption.create({
              data: {
                tenantId,
                versionId: version.id,
                groupId: group.id,
                name: mod.name,
                priceDelta: mod.price,
                isActive: true,
              },
            });
            optionsCreated++;
          }
        }

        // Auto-create synonyms for Turkish variations
        const synonyms = this.generateSynonyms(hfItem.name);
        for (const phrase of synonyms) {
          await prisma.menuSynonym.create({
            data: {
              tenantId,
              versionId: version.id,
              phrase,
              mapsToItemId: createdItem.id,
              weight: 1,
            },
          });
        }
      }
    }

    // Publish the new version
    await menuService.publishVersion(tenantId, version.id);

    // Update last sync timestamp and hash
    const hashResponse = await fetch(`${apiUrl}/api/external/menu/hash`, {
      headers: { 'X-API-Key': tenant.highfiveApiKey },
      signal: AbortSignal.timeout(10000),
    });
    const hashData = hashResponse.ok ? await hashResponse.json() : null;

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        highfiveLastMenuSync: new Date(),
        highfiveMenuHash: hashData?.hash || null,
      },
    });

    logger.info(
      { tenantId, versionId: version.id, itemsCreated, optionGroupsCreated, optionsCreated },
      'HighFive menü senkronizasyonu tamamlandı',
    );

    return {
      versionId: version.id,
      itemsCreated,
      optionGroupsCreated,
      optionsCreated,
      categoriesFound: categoryMap.size,
    };
  }

  /**
   * Check if HighFive menu has changed since last sync
   */
  async checkMenuChanged(tenantId: string): Promise<boolean> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant?.highfiveApiUrl || !tenant?.highfiveApiKey) {
      return false;
    }

    try {
      const apiUrl = tenant.highfiveApiUrl.replace(/\/$/, '');
      const response = await fetch(`${apiUrl}/api/external/menu/hash`, {
        headers: { 'X-API-Key': tenant.highfiveApiKey },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return false;

      const data = await response.json();
      return data.hash !== tenant.highfiveMenuHash;
    } catch {
      return false;
    }
  }

  /**
   * Push a WhatRes order to HighFive POS
   */
  async pushOrder(tenantId: string, orderId: string): Promise<void> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant?.highfiveApiUrl || !tenant?.highfiveApiKey) {
      logger.warn({ tenantId }, 'HighFive entegrasyonu yapılandırılmamış, sipariş gönderilmiyor');
      return;
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { items: true },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Already pushed?
    if (order.externalOrderId) {
      logger.info({ tenantId, orderId, externalOrderId: order.externalOrderId }, 'Sipariş zaten HighFive\'a gönderilmiş');
      return;
    }

    // Map WhatRes items to HighFive format
    const items = [];
    for (const item of order.items) {
      // Find the menu item to get its externalItemId
      const menuItem = await prisma.menuItem.findFirst({
        where: { id: item.menuItemId, tenantId },
      });

      if (!menuItem?.externalItemId) {
        logger.warn(
          { tenantId, orderId, menuItemId: item.menuItemId, menuItemName: item.menuItemName },
          'Menu item externalItemId bulunamadı, atlaniyor',
        );
        continue;
      }

      // Parse modifiers
      const modifiers: string[] = [];
      if (item.optionsJson) {
        const options = item.optionsJson as any;
        if (Array.isArray(options)) {
          for (const opt of options) {
            if (typeof opt === 'string') {
              modifiers.push(opt);
            } else if (opt?.name) {
              modifiers.push(opt.name);
            }
          }
        }
      }

      items.push({
        menuItemId: menuItem.externalItemId,
        quantity: item.qty,
        modifiers,
        notes: item.notes || undefined,
      });
    }

    if (items.length === 0) {
      logger.warn({ tenantId, orderId }, 'Hiçbir ürün eşleştirilemedi, sipariş gönderilmiyor');
      return;
    }

    const apiUrl = tenant.highfiveApiUrl.replace(/\/$/, '');

    const payload = {
      externalOrderId: order.id,
      type: 'DELIVERY',
      customerName: order.customerName || undefined,
      customerPhone: order.customerPhone || undefined,
      customerAddress: order.deliveryAddress || undefined,
      notes: order.notes || undefined,
      source: 'WHATSAPP',
      items,
      locationId: tenant.highfiveLocationId || undefined,
    };

    const response = await fetch(`${apiUrl}/api/external/orders`, {
      method: 'POST',
      headers: {
        'X-API-Key': tenant.highfiveApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ tenantId, orderId, status: response.status, error }, 'HighFive sipariş gönderme hatası');
      throw new Error(`HighFive sipariş hatası: ${response.status} - ${error}`);
    }

    const result = await response.json();

    // Save HighFive orderId
    await prisma.order.update({
      where: { id: orderId },
      data: { externalOrderId: result.orderId },
    });

    logger.info(
      { tenantId, orderId, highfiveOrderId: result.orderId, highfiveOrderNumber: result.orderNumber },
      'Sipariş HighFive\'a başarıyla gönderildi',
    );
  }

  /**
   * Handle order status update from HighFive webhook
   */
  async handleStatusUpdate(
    tenantId: string,
    externalOrderId: string,
    newStatus: string,
  ): Promise<{ orderId: string; conversationId: string; updatedStatus: string } | null> {
    // Find WhatRes order by externalOrderId (which is the HighFive orderId)
    // Wait - externalOrderId in WhatRes stores the HighFive orderId,
    // but webhook sends the HighFive's order.externalOrderId which is WhatRes order.id
    // So we search by order.id
    let order = await prisma.order.findFirst({
      where: { id: externalOrderId, tenantId },
    });

    // If not found by id, try by externalOrderId
    if (!order) {
      order = await prisma.order.findFirst({
        where: { externalOrderId, tenantId },
      });
    }

    if (!order) {
      logger.warn({ tenantId, externalOrderId, newStatus }, 'HighFive webhook: Sipariş bulunamadı');
      return null;
    }

    // Map HighFive status → WhatRes status
    const statusMap: Record<string, string> = {
      PENDING: 'PENDING_CONFIRMATION',
      CONFIRMED: 'CONFIRMED',
      PREPARING: 'PREPARING',
      READY: 'READY',
      OUT_FOR_DELIVERY: 'DELIVERING',
      DELIVERED: 'DELIVERED',
      SERVED: 'DELIVERED',
      COMPLETED: 'DELIVERED',
      CANCELLED: 'CANCELLED',
    };

    const whatresStatus = statusMap[newStatus.toUpperCase()];
    if (!whatresStatus) {
      logger.warn({ tenantId, externalOrderId, newStatus }, 'Bilinmeyen HighFive status');
      return null;
    }

    // Don't update if already in same or later status
    const currentStatus = order.status;
    if (currentStatus === whatresStatus || currentStatus === 'DELIVERED' || currentStatus === 'CANCELLED') {
      logger.info(
        { tenantId, orderId: order.id, currentStatus, newStatus: whatresStatus },
        'Sipariş zaten bu durumda veya ilerlemede',
      );
      return null;
    }

    // Update order status
    await prisma.order.update({
      where: { id: order.id },
      data: { status: whatresStatus as any },
    });

    logger.info(
      { tenantId, orderId: order.id, from: currentStatus, to: whatresStatus },
      'HighFive webhook: Sipariş durumu güncellendi',
    );

    return {
      orderId: order.id,
      conversationId: order.conversationId,
      updatedStatus: whatresStatus,
    };
  }

  // ==================== HELPERS ====================

  /**
   * Generate Turkish synonym variations for a menu item name
   */
  private generateSynonyms(name: string): string[] {
    const synonyms: string[] = [];
    const lower = name.toLocaleLowerCase('tr');

    // Remove common suffixes for base form
    const variations = [
      lower,
      lower.replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i'),
    ];

    // Only add variations that differ from the original
    for (const v of variations) {
      if (v !== name && v.length > 2) {
        synonyms.push(v);
      }
    }

    return synonyms;
  }
}

export const highfiveIntegrationService = new HighFiveIntegrationService();
