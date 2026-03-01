import prisma from '../db/prisma';
import { AppError } from '../middleware/error-handler';
import { createLogger } from '../logger';
import {
  StoreDto,
  CreateStoreDto,
  UpdateStoreDto,
  DeliveryRuleDto,
  CreateDeliveryRuleDto,
  UpdateDeliveryRuleDto,
} from '@whatres/shared';

const logger = createLogger();

export class StoreService {
  // ==================== STORES ====================

  async getStores(
    tenantId: string,
    includeInactive = false
  ): Promise<StoreDto[]> {
    const stores = await prisma.store.findMany({
      where: {
        tenantId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        deliveryRules: {
          where: includeInactive ? {} : { isActive: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return stores.map((store) => this.mapStoreToDto(store));
  }

  async getStore(tenantId: string, storeId: string): Promise<StoreDto> {
    const store = await prisma.store.findFirst({
      where: { id: storeId, tenantId },
      include: { deliveryRules: true },
    });

    if (!store) {
      throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found');
    }

    return this.mapStoreToDto(store);
  }

  async createStore(tenantId: string, data: CreateStoreDto): Promise<StoreDto> {
    const store = await prisma.store.create({
      data: {
        tenantId,
        name: data.name,
        address: data.address,
        lat: data.lat,
        lng: data.lng,
        phone: data.phone,
        isActive: data.isActive ?? true,
      },
      include: { deliveryRules: true },
    });

    logger.info({ tenantId, storeId: store.id }, 'Store created');

    return this.mapStoreToDto(store);
  }

  async updateStore(
    tenantId: string,
    storeId: string,
    data: UpdateStoreDto
  ): Promise<StoreDto> {
    const existing = await prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });

    if (!existing) {
      throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found');
    }

    const store = await prisma.store.update({
      where: { id: storeId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.lat !== undefined && { lat: data.lat }),
        ...(data.lng !== undefined && { lng: data.lng }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.isOpen !== undefined && { isOpen: data.isOpen }),
      },
      include: { deliveryRules: true },
    });

    logger.info({ tenantId, storeId }, 'Store updated');

    return this.mapStoreToDto(store);
  }

  async deleteStore(tenantId: string, storeId: string): Promise<void> {
    const existing = await prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });

    if (!existing) {
      throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found');
    }

    await prisma.store.delete({ where: { id: storeId } });

    logger.info({ tenantId, storeId }, 'Store deleted');
  }

  // ==================== DELIVERY RULES ====================

  async getDeliveryRules(
    tenantId: string,
    storeId?: string
  ): Promise<DeliveryRuleDto[]> {
    const rules = await prisma.deliveryRule.findMany({
      where: {
        tenantId,
        ...(storeId && { storeId }),
      },
      include: { store: true },
      orderBy: { radiusKm: 'asc' },
    });

    return rules.map((rule) => this.mapDeliveryRuleToDto(rule));
  }

  async getDeliveryRule(
    tenantId: string,
    ruleId: string
  ): Promise<DeliveryRuleDto> {
    const rule = await prisma.deliveryRule.findFirst({
      where: { id: ruleId, tenantId },
      include: { store: true },
    });

    if (!rule) {
      throw new AppError(404, 'RULE_NOT_FOUND', 'Delivery rule not found');
    }

    return this.mapDeliveryRuleToDto(rule);
  }

  async createDeliveryRule(
    tenantId: string,
    data: CreateDeliveryRuleDto
  ): Promise<DeliveryRuleDto> {
    // Verify store exists and belongs to tenant
    const store = await prisma.store.findFirst({
      where: { id: data.storeId, tenantId },
    });

    if (!store) {
      throw new AppError(404, 'STORE_NOT_FOUND', 'Store not found');
    }

    const rule = await prisma.deliveryRule.create({
      data: {
        tenantId,
        storeId: data.storeId,
        radiusKm: data.radiusKm,
        minBasket: data.minBasket,
        deliveryFee: data.deliveryFee,
        isActive: data.isActive ?? true,
      },
      include: { store: true },
    });

    logger.info(
      { tenantId, storeId: data.storeId, ruleId: rule.id },
      'Delivery rule created'
    );

    return this.mapDeliveryRuleToDto(rule);
  }

  async updateDeliveryRule(
    tenantId: string,
    ruleId: string,
    data: UpdateDeliveryRuleDto
  ): Promise<DeliveryRuleDto> {
    const existing = await prisma.deliveryRule.findFirst({
      where: { id: ruleId, tenantId },
    });

    if (!existing) {
      throw new AppError(404, 'RULE_NOT_FOUND', 'Delivery rule not found');
    }

    const rule = await prisma.deliveryRule.update({
      where: { id: ruleId },
      data: {
        ...(data.radiusKm !== undefined && { radiusKm: data.radiusKm }),
        ...(data.minBasket !== undefined && { minBasket: data.minBasket }),
        ...(data.deliveryFee !== undefined && { deliveryFee: data.deliveryFee }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
      include: { store: true },
    });

    logger.info({ tenantId, ruleId }, 'Delivery rule updated');

    return this.mapDeliveryRuleToDto(rule);
  }

  async deleteDeliveryRule(tenantId: string, ruleId: string): Promise<void> {
    const existing = await prisma.deliveryRule.findFirst({
      where: { id: ruleId, tenantId },
    });

    if (!existing) {
      throw new AppError(404, 'RULE_NOT_FOUND', 'Delivery rule not found');
    }

    await prisma.deliveryRule.delete({ where: { id: ruleId } });

    logger.info({ tenantId, ruleId }, 'Delivery rule deleted');
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
      deliveryRules: store.deliveryRules?.map((rule: any) =>
        this.mapDeliveryRuleToDto(rule)
      ),
    };
  }

  async areAllStoresClosed(tenantId: string): Promise<boolean> {
    const openCount = await prisma.store.count({
      where: { tenantId, isActive: true, isOpen: true },
    });
    return openCount === 0;
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
      store: rule.store ? this.mapStoreToDto(rule.store) : undefined,
    };
  }
}

export const storeService = new StoreService();


