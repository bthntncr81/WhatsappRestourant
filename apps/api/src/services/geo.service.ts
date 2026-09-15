import prisma from '../db/prisma';
import { createLogger } from '../logger';
import {
  GeoLocation,
  GeoCheckResult,
  StoreDto,
  DeliveryRuleDto,
} from '@whatres/shared';

const logger = createLogger();

/**
 * Calculate distance between two points using Haversine formula
 * @returns Distance in kilometers
 */
export function haversineDistance(
  point1: GeoLocation,
  point2: GeoLocation
): number {
  const R = 6371; // Earth's radius in kilometers

  const lat1Rad = (point1.lat * Math.PI) / 180;
  const lat2Rad = (point2.lat * Math.PI) / 180;
  const deltaLat = ((point2.lat - point1.lat) * Math.PI) / 180;
  const deltaLng = ((point2.lng - point1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export class GeoService {
  /**
   * Check if a location is within service area
   * Returns the nearest store, delivery rule, and alternative stores
   */
  async checkServiceArea(
    tenantId: string,
    customerLocation: GeoLocation
  ): Promise<GeoCheckResult> {
    // Get all active stores with their delivery rules
    const stores = await prisma.store.findMany({
      where: { tenantId, isActive: true, isOpen: true },
      include: {
        deliveryRules: {
          where: { isActive: true },
          // Smallest radius first: the tightest covering tier must win, otherwise
          // a customer 1 km away is charged the 7 km tier's fee and min basket.
          orderBy: { radiusKm: 'asc' },
        },
      },
    });

    if (stores.length === 0) {
      return {
        isWithinServiceArea: false,
        nearestStore: null,
        distance: null,
        deliveryRule: null,
        alternativeStores: [],
        message: 'Henüz hizmet veren şubemiz bulunmamaktadır.',
        reason: 'NO_OPEN_STORE',
        maxRadiusKm: null,
      };
    }

    // Calculate distances to all stores
    const storesWithDistance = stores.map((store) => ({
      store: this.mapStoreToDto(store),
      distance: haversineDistance(customerLocation, {
        lat: store.lat,
        lng: store.lng,
      }),
      deliveryRules: store.deliveryRules.map((rule) =>
        this.mapDeliveryRuleToDto(rule)
      ),
    }));

    // Sort by distance
    storesWithDistance.sort((a, b) => a.distance - b.distance);

    const nearest = storesWithDistance[0];
    const maxRadius = (s: (typeof storesWithDistance)[number]) =>
      s.deliveryRules.length > 0 ? Math.max(...s.deliveryRules.map((r) => r.radiusKm)) : null;

    // The nearest store whose radius covers the customer serves the order.
    // Testing only the single nearest store rejected customers that a
    // slightly farther branch could deliver to.
    for (const candidate of storesWithDistance) {
      const applicableRule = candidate.deliveryRules.find(
        (rule) => candidate.distance <= rule.radiusKm
      );
      if (!applicableRule) continue;

      logger.info(
        {
          tenantId,
          storeId: candidate.store.id,
          distance: candidate.distance.toFixed(2),
          radiusKm: applicableRule.radiusKm,
        },
        'Customer is within service area'
      );

      return {
        isWithinServiceArea: true,
        nearestStore: candidate.store,
        distance: Math.round(candidate.distance * 100) / 100,
        deliveryRule: applicableRule,
        alternativeStores: [],
        message: `En yakın şubemiz: ${candidate.store.name} (${candidate.distance.toFixed(1)} km)`,
        reason: 'IN_AREA',
        maxRadiusKm: maxRadius(candidate),
      };
    }

    const nearestWithRules = storesWithDistance.find((s) => s.deliveryRules.length > 0) ?? null;

    // Customer is outside service area
    // Find alternative stores that could serve them
    const alternatives = storesWithDistance
      .filter((s) => {
        const maxRadius = Math.max(
          ...s.deliveryRules.map((r) => r.radiusKm),
          0
        );
        // Show alternatives within 2x the max delivery radius
        return maxRadius > 0 && s.distance <= maxRadius * 2;
      })
      .slice(0, 3); // Max 3 alternatives

    logger.info(
      {
        tenantId,
        distance: nearest.distance.toFixed(2),
        nearestStoreName: nearest.store.name,
      },
      'Customer is outside service area'
    );

    let message = 'Maalesef bu bölgeye hizmet veremiyoruz.';

    if (alternatives.length > 0) {
      const altNames = alternatives.map(
        (a) => `${a.store.name} (${a.distance.toFixed(1)} km)`
      );
      message += ` En yakın şubelerimiz: ${altNames.join(', ')}`;
    }

    return {
      isWithinServiceArea: false,
      nearestStore: nearest.store,
      distance: Math.round(nearest.distance * 100) / 100,
      deliveryRule: null,
      alternativeStores: alternatives.map((a) => ({
        store: a.store,
        distance: Math.round(a.distance * 100) / 100,
      })),
      message,
      reason: nearestWithRules ? 'OUT_OF_RADIUS' : 'NO_DELIVERY_RULE',
      maxRadiusKm: nearestWithRules ? maxRadius(nearestWithRules) : null,
    };
  }

  /**
   * Delivery terms for a WRITTEN address (the customer did not share a pin,
   * so no zone can be computed; staff verifies the area).
   *
   * WHY these picks: the fee shown is the OUTERMOST zone's fee (largest
   * radius) — an upper bound that never under-quotes an address we could not
   * locate. The minimum basket is the SMALLEST one — it never blocks an order
   * some zone would accept, and matches the early min-basket warning the
   * customer already saw. The store is the pin's nearest store when there was
   * a pin, else the first active store (same default as order confirmation).
   */
  async getTypedAddressTerms(
    tenantId: string,
    preferredStoreId?: string | null
  ): Promise<{
    store: { id: string; name: string; phone: string | null } | null;
    deliveryFee: number | null;
    minBasket: number | null;
    maxRadiusKm: number | null;
  }> {
    const include = {
      deliveryRules: { where: { isActive: true }, orderBy: { radiusKm: 'desc' as const } },
    };
    let stores = await prisma.store.findMany({
      where: { tenantId, isActive: true, isOpen: true },
      include,
      orderBy: { createdAt: 'asc' },
    });
    if (stores.length === 0) {
      stores = await prisma.store.findMany({
        where: { tenantId, isActive: true },
        include,
        orderBy: { createdAt: 'asc' },
      });
    }
    const store = stores.find((s) => s.id === preferredStoreId) ?? stores[0] ?? null;
    if (!store) return { store: null, deliveryFee: null, minBasket: null, maxRadiusKm: null };

    const rules = store.deliveryRules ?? [];
    return {
      store: { id: store.id, name: store.name, phone: store.phone ?? null },
      deliveryFee: rules.length > 0 ? Number(rules[0].deliveryFee) : null,
      minBasket: rules.length > 0 ? Math.min(...rules.map((r) => Number(r.minBasket))) : null,
      maxRadiusKm: rules.length > 0 ? rules[0].radiusKm : null,
    };
  }

  /**
   * Get delivery fee and minimum basket for a location
   */
  async getDeliveryInfo(
    tenantId: string,
    customerLocation: GeoLocation
  ): Promise<{
    deliveryFee: number;
    minBasket: number;
    store: StoreDto;
  } | null> {
    const result = await this.checkServiceArea(tenantId, customerLocation);

    if (!result.isWithinServiceArea || !result.deliveryRule || !result.nearestStore) {
      return null;
    }

    return {
      deliveryFee: result.deliveryRule.deliveryFee,
      minBasket: result.deliveryRule.minBasket,
      store: result.nearestStore,
    };
  }

  // ==================== HELPERS ====================

  private mapStoreToDto(store: any): StoreDto {
    return {
      id: store.id,
      tenantId: store.tenantId,
      name: store.name,
      address: store.address,
      lat: store.lat,
      lng: store.lng,
      phone: store.phone,
      isActive: store.isActive,
      isOpen: store.isOpen ?? true,
      createdAt: store.createdAt.toISOString(),
      updatedAt: store.updatedAt.toISOString(),
    };
  }

  private mapDeliveryRuleToDto(rule: any): DeliveryRuleDto {
    return {
      id: rule.id,
      tenantId: rule.tenantId,
      storeId: rule.storeId,
      radiusKm: rule.radiusKm,
      minBasket: Number(rule.minBasket),
      deliveryFee: Number(rule.deliveryFee),
      isActive: rule.isActive,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }
}

export const geoService = new GeoService();


