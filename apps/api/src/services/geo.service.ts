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
      where: { tenantId, isActive: true },
      include: {
        deliveryRules: {
          where: { isActive: true },
          orderBy: { radiusKm: 'desc' }, // Largest radius first
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

    // Check if customer is within any delivery radius
    const applicableRule = nearest.deliveryRules.find(
      (rule) => nearest.distance <= rule.radiusKm
    );

    if (applicableRule) {
      logger.info(
        {
          tenantId,
          storeId: nearest.store.id,
          distance: nearest.distance.toFixed(2),
          radiusKm: applicableRule.radiusKm,
        },
        'Customer is within service area'
      );

      return {
        isWithinServiceArea: true,
        nearestStore: nearest.store,
        distance: Math.round(nearest.distance * 100) / 100,
        deliveryRule: applicableRule,
        alternativeStores: [],
        message: `En yakın şubemiz: ${nearest.store.name} (${nearest.distance.toFixed(1)} km)`,
      };
    }

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


