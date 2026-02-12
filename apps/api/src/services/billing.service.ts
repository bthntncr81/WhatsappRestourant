import prisma from '../db/prisma';
import { createLogger } from '../logger';
import { AppError } from '../middleware/error-handler';

import { iyzicoService, sanitizeForIyzico, formatGsmNumber } from './iyzico.service';
import {
  SubscriptionPlan,
  SubscriptionStatus,
  BillingCycle,
  SubscriptionDto,
  StoredCardDto,
  BillingTransactionDto,
  PlanDefinition,
  PLAN_DEFINITIONS,
  SubscribeWithNewCardDto,
  SubscribeWithStoredCardDto,
  RegisterCardDto,
  CancelSubscriptionDto,
  BillingOverviewDto,
} from '@whatres/shared';

const logger = createLogger();

// Trial period in days
const TRIAL_DAYS = 14;

export class BillingService {
  // ==================== PLANS ====================

  getPlans(): PlanDefinition[] {
    return Object.values(PLAN_DEFINITIONS);
  }

  getPlan(planKey: SubscriptionPlan): PlanDefinition {
    const plan = PLAN_DEFINITIONS[planKey];
    if (!plan) {
      throw new AppError(404, 'PLAN_NOT_FOUND', `Plan not found: ${planKey}`);
    }
    return plan;
  }

  // ==================== SUBSCRIPTION MANAGEMENT ====================

  /**
   * Get or create subscription for tenant
   */
  async getOrCreateSubscription(tenantId: string): Promise<SubscriptionDto> {
    let subscription = await prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      // Create trial subscription with upsert to handle race conditions
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

      try {
        subscription = await prisma.subscription.upsert({
          where: { tenantId },
          update: {}, // No update if exists
          create: {
            tenantId,
            plan: 'TRIAL',
            status: 'ACTIVE',
            billingCycle: 'MONTHLY',
            trialEndsAt,
            currentPeriodStart: new Date(),
            currentPeriodEnd: trialEndsAt,
            monthlyOrderLimit: PLAN_DEFINITIONS.TRIAL.features.monthlyOrderLimit,
            monthlyMessageLimit: PLAN_DEFINITIONS.TRIAL.features.monthlyMessageLimit,
            maxStores: PLAN_DEFINITIONS.TRIAL.features.maxStores,
            maxUsers: PLAN_DEFINITIONS.TRIAL.features.maxUsers,
          },
        });

        logger.info({ tenantId }, 'Created trial subscription');
      } catch (error: any) {
        // If unique constraint error, subscription was created by another request
        if (error.code === 'P2002') {
          subscription = await prisma.subscription.findUnique({
            where: { tenantId },
          });
          if (!subscription) {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    return this.mapSubscriptionToDto(subscription);
  }

  /**
   * Get subscription details
   */
  async getSubscription(tenantId: string): Promise<SubscriptionDto | null> {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId },
    });

    return subscription ? this.mapSubscriptionToDto(subscription) : null;
  }

  /**
   * Subscribe with new card
   */
  async subscribeWithNewCard(
    tenantId: string,
    dto: SubscribeWithNewCardDto
  ): Promise<{ success: boolean; subscription?: SubscriptionDto; checkoutFormContent?: string; error?: string }> {
    const plan = this.getPlan(dto.planKey);

    if (plan.isFree || !plan.iyzicoRefCode) {
      throw new AppError(400, 'INVALID_PLAN', 'This plan does not support paid subscription');
    }

    // Get tenant for customer reference
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const customerRefCode = `CUST-${tenantId}`;

    // Create pending transaction
    const transaction = await prisma.billingTransaction.create({
      data: {
        tenantId,
        type: 'SUBSCRIPTION_PAYMENT',
        status: 'PENDING',
        amount: dto.billingCycle === 'MONTHLY' ? plan.monthlyPrice : plan.annualPrice,
        currency: plan.currency,
        plan: dto.planKey,
        billingCycle: dto.billingCycle,
      },
    });

    try {
      // Initialize subscription via iyzico
      const result = await iyzicoService.initializeSubscription({
        pricingPlanRefCode: plan.iyzicoRefCode,
        customerRefCode,
        email: dto.buyer.email,
        name: dto.buyer.name,
        surname: dto.buyer.surname,
        gsmNumber: dto.buyer.gsmNumber,
        identityNumber: dto.buyer.identityNumber,
        address: {
          city: dto.buyer.city,
          country: dto.buyer.country,
          address: dto.buyer.address,
          zipCode: dto.buyer.zipCode,
        },
        card: dto.card,
        registerCard: dto.saveCard,
      });

      if (result.success && result.subscriptionRefCode) {
        // Update subscription in database
        const subscription = await this.activateSubscription(
          tenantId,
          dto.planKey,
          dto.billingCycle,
          result.subscriptionRefCode,
          result.customerRefCode || customerRefCode
        );

        // Mark transaction as success
        await prisma.billingTransaction.update({
          where: { id: transaction.id },
          data: {
            status: 'SUCCESS',
            iyzicoPaymentId: result.subscriptionRefCode,
            processedAt: new Date(),
          },
        });

        logger.info({ tenantId, plan: dto.planKey }, 'Subscription activated successfully');

        return { success: true, subscription };
      } else {
        // Mark transaction as failed
        await prisma.billingTransaction.update({
          where: { id: transaction.id },
          data: {
            status: 'FAILED',
            errorMessage: result.error,
            errorCode: result.errorCode,
          },
        });

        return { success: false, error: result.error };
      }
    } catch (error) {
      // Mark transaction as failed
      await prisma.billingTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  }

  /**
   * Subscribe with Checkout Form (supports 3DS)
   */
  async getSubscriptionCheckoutForm(
    tenantId: string,
    planKey: SubscriptionPlan,
    billingCycle: BillingCycle,
    buyer: {
      email: string;
      name: string;
      surname: string;
      gsmNumber: string;
      identityNumber: string;
      city: string;
      country: string;
      address: string;
      zipCode: string;
    },
    callbackUrl: string
  ): Promise<{ success: boolean; checkoutFormContent?: string; token?: string; error?: string }> {
    const plan = this.getPlan(planKey);

    if (plan.isFree || !plan.iyzicoRefCode) {
      throw new AppError(400, 'INVALID_PLAN', 'This plan does not support paid subscription');
    }

    const customerRefCode = `CUST-${tenantId}`;

    const result = await iyzicoService.initializeSubscriptionCheckoutForm({
      pricingPlanRefCode: plan.iyzicoRefCode,
      customerRefCode,
      email: buyer.email,
      name: buyer.name,
      surname: buyer.surname,
      gsmNumber: buyer.gsmNumber,
      identityNumber: buyer.identityNumber,
      address: {
        city: buyer.city,
        country: buyer.country,
        address: buyer.address,
        zipCode: buyer.zipCode,
      },
      callbackUrl,
    });

    return result;
  }

  /**
   * Activate subscription after successful payment
   */
  private async activateSubscription(
    tenantId: string,
    planKey: SubscriptionPlan,
    billingCycle: BillingCycle,
    iyzicoSubscriptionRef: string,
    iyzicoCustomerRef: string
  ): Promise<SubscriptionDto> {
    const plan = PLAN_DEFINITIONS[planKey];
    
    // Calculate period end based on billing cycle
    const periodEnd = new Date();
    if (billingCycle === 'MONTHLY') {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    const subscription = await prisma.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        plan: planKey,
        status: 'ACTIVE',
        billingCycle,
        iyzicoSubscriptionRef,
        iyzicoCustomerRef,
        currentPeriodStart: new Date(),
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
        monthlyOrderLimit: plan.features.monthlyOrderLimit,
        monthlyMessageLimit: plan.features.monthlyMessageLimit,
        maxStores: plan.features.maxStores,
        maxUsers: plan.features.maxUsers,
        ordersUsed: 0,
        messagesUsed: 0,
        usageResetAt: new Date(),
      },
      update: {
        plan: planKey,
        status: 'ACTIVE',
        billingCycle,
        iyzicoSubscriptionRef,
        iyzicoCustomerRef,
        currentPeriodStart: new Date(),
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
        monthlyOrderLimit: plan.features.monthlyOrderLimit,
        monthlyMessageLimit: plan.features.monthlyMessageLimit,
        maxStores: plan.features.maxStores,
        maxUsers: plan.features.maxUsers,
        cancelledAt: null,
        cancelAtPeriodEnd: false,
      },
    });

    return this.mapSubscriptionToDto(subscription);
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(tenantId: string, dto: CancelSubscriptionDto): Promise<SubscriptionDto> {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'No subscription found');
    }

    if (subscription.status === 'CANCELLED') {
      throw new AppError(400, 'ALREADY_CANCELLED', 'Subscription is already cancelled');
    }

    // Cancel via iyzico if there's a subscription reference
    if (subscription.iyzicoSubscriptionRef) {
      const result = await iyzicoService.cancelSubscription(subscription.iyzicoSubscriptionRef);
      if (!result.success) {
        logger.warn({ tenantId, error: result.error }, 'Failed to cancel subscription in iyzico');
        // Continue with local cancellation anyway
      }
    }

    const updated = await prisma.subscription.update({
      where: { tenantId },
      data: dto.immediate
        ? {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            autoRenew: false,
          }
        : {
            cancelAtPeriodEnd: true,
            cancelledAt: new Date(),
            autoRenew: false,
          },
    });

    logger.info({ tenantId, immediate: dto.immediate }, 'Subscription cancelled');

    return this.mapSubscriptionToDto(updated);
  }

  /**
   * Upgrade/downgrade subscription plan
   */
  async changePlan(
    tenantId: string,
    newPlanKey: SubscriptionPlan,
    billingCycle?: BillingCycle
  ): Promise<SubscriptionDto> {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'No subscription found');
    }

    const newPlan = this.getPlan(newPlanKey);

    // If upgrading from trial or has iyzico reference, need to go through payment flow
    if (subscription.plan === 'TRIAL' || (newPlan.iyzicoRefCode && subscription.iyzicoSubscriptionRef)) {
      // For upgrades with existing subscription, use iyzico upgrade API
      if (subscription.iyzicoSubscriptionRef && newPlan.iyzicoRefCode) {
        const result = await iyzicoService.upgradeSubscription(
          subscription.iyzicoSubscriptionRef,
          newPlan.iyzicoRefCode
        );

        if (!result.success) {
          throw new AppError(400, 'UPGRADE_FAILED', result.error || 'Failed to upgrade subscription');
        }

        // Update local subscription
        const updated = await prisma.subscription.update({
          where: { tenantId },
          data: {
            plan: newPlanKey,
            iyzicoSubscriptionRef: result.newSubscriptionRefCode || subscription.iyzicoSubscriptionRef,
            monthlyOrderLimit: newPlan.features.monthlyOrderLimit,
            monthlyMessageLimit: newPlan.features.monthlyMessageLimit,
            maxStores: newPlan.features.maxStores,
            maxUsers: newPlan.features.maxUsers,
          },
        });

        return this.mapSubscriptionToDto(updated);
      }
    }

    // For downgrades or enterprise custom plans, just update locally
    const updated = await prisma.subscription.update({
      where: { tenantId },
      data: {
        plan: newPlanKey,
        billingCycle: billingCycle || subscription.billingCycle,
        monthlyOrderLimit: newPlan.features.monthlyOrderLimit,
        monthlyMessageLimit: newPlan.features.monthlyMessageLimit,
        maxStores: newPlan.features.maxStores,
        maxUsers: newPlan.features.maxUsers,
      },
    });

    return this.mapSubscriptionToDto(updated);
  }

  // ==================== USAGE TRACKING ====================

  /**
   * Increment order usage
   */
  async incrementOrderUsage(tenantId: string): Promise<void> {
    await this.checkAndResetUsage(tenantId);

    await prisma.subscription.updateMany({
      where: { tenantId },
      data: { ordersUsed: { increment: 1 } },
    });
  }

  /**
   * Increment message usage
   */
  async incrementMessageUsage(tenantId: string): Promise<void> {
    await this.checkAndResetUsage(tenantId);

    await prisma.subscription.updateMany({
      where: { tenantId },
      data: { messagesUsed: { increment: 1 } },
    });
  }

  /**
   * Check if usage limit reached
   */
  async checkUsageLimit(tenantId: string, type: 'orders' | 'messages'): Promise<{
    allowed: boolean;
    used: number;
    limit: number;
    remaining: number;
  }> {
    const subscription = await this.getOrCreateSubscription(tenantId);
    
    const used = type === 'orders' ? subscription.ordersUsed : subscription.messagesUsed;
    const limit = type === 'orders' ? subscription.monthlyOrderLimit : subscription.monthlyMessageLimit;
    
    // -1 means unlimited
    const allowed = limit === -1 || used < limit;
    const remaining = limit === -1 ? -1 : Math.max(0, limit - used);

    return { allowed, used, limit, remaining };
  }

  /**
   * Reset usage if month has passed
   */
  private async checkAndResetUsage(tenantId: string): Promise<void> {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) return;

    const now = new Date();
    const resetAt = new Date(subscription.usageResetAt);
    
    // Check if a month has passed since last reset
    if (now.getTime() - resetAt.getTime() > 30 * 24 * 60 * 60 * 1000) {
      await prisma.subscription.update({
        where: { tenantId },
        data: {
          ordersUsed: 0,
          messagesUsed: 0,
          usageResetAt: now,
        },
      });

      logger.info({ tenantId }, 'Usage reset for new billing period');
    }
  }

  // ==================== STORED CARDS ====================

  async getStoredCards(tenantId: string): Promise<StoredCardDto[]> {
    const cards = await prisma.storedCard.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    return cards.map(this.mapStoredCardToDto);
  }

  async registerCard(tenantId: string, dto: RegisterCardDto): Promise<StoredCardDto> {
    const result = await iyzicoService.storeCard({
      email: dto.buyer.email,
      externalId: tenantId,
      card: {
        cardAlias: dto.cardAlias || 'My Card',
        cardHolderName: dto.card.cardHolderName,
        cardNumber: dto.card.cardNumber,
        expireMonth: dto.card.expireMonth,
        expireYear: dto.card.expireYear,
      },
    });

    if (!result.success || !result.cardToken || !result.cardUserKey) {
      throw new AppError(400, 'CARD_REGISTRATION_FAILED', result.error || 'Failed to register card');
    }

    // Check if this is the first card
    const existingCards = await prisma.storedCard.count({ where: { tenantId } });
    const isDefault = existingCards === 0;

    const card = await prisma.storedCard.create({
      data: {
        tenantId,
        cardToken: result.cardToken,
        cardUserKey: result.cardUserKey,
        cardAlias: dto.cardAlias,
        cardAssociation: result.cardAssociation,
        cardFamily: result.cardFamily,
        cardBankName: result.cardBankName,
        binNumber: result.binNumber,
        lastFourDigits: result.lastFourDigits,
        isDefault,
      },
    });

    return this.mapStoredCardToDto(card);
  }

  async deleteCard(tenantId: string, cardId: string): Promise<void> {
    const card = await prisma.storedCard.findFirst({
      where: { id: cardId, tenantId },
    });

    if (!card) {
      throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
    }

    // Delete from iyzico
    const result = await iyzicoService.deleteCard(card.cardUserKey, card.cardToken);
    if (!result.success) {
      logger.warn({ tenantId, cardId, error: result.error }, 'Failed to delete card from iyzico');
    }

    // Delete from database
    await prisma.storedCard.delete({ where: { id: cardId } });

    // If this was default, set another card as default
    if (card.isDefault) {
      const anotherCard = await prisma.storedCard.findFirst({
        where: { tenantId },
      });
      if (anotherCard) {
        await prisma.storedCard.update({
          where: { id: anotherCard.id },
          data: { isDefault: true },
        });
      }
    }
  }

  async setDefaultCard(tenantId: string, cardId: string): Promise<void> {
    const card = await prisma.storedCard.findFirst({
      where: { id: cardId, tenantId },
    });

    if (!card) {
      throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found');
    }

    // Unset current default
    await prisma.storedCard.updateMany({
      where: { tenantId, isDefault: true },
      data: { isDefault: false },
    });

    // Set new default
    await prisma.storedCard.update({
      where: { id: cardId },
      data: { isDefault: true },
    });
  }

  // ==================== TRANSACTIONS ====================

  async getTransactions(
    tenantId: string,
    limit = 10,
    offset = 0
  ): Promise<{ transactions: BillingTransactionDto[]; total: number }> {
    const [transactions, total] = await Promise.all([
      prisma.billingTransaction.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.billingTransaction.count({ where: { tenantId } }),
    ]);

    return {
      transactions: transactions.map(this.mapTransactionToDto),
      total,
    };
  }

  // ==================== BILLING OVERVIEW ====================

  async getBillingOverview(tenantId: string): Promise<BillingOverviewDto> {
    const subscription = await this.getOrCreateSubscription(tenantId);
    const currentPlan = this.getPlan(subscription.plan);
    const storedCards = await this.getStoredCards(tenantId);
    const { transactions } = await this.getTransactions(tenantId, 5);

    // Get actual usage counts
    const [storeCount, userCount] = await Promise.all([
      prisma.store.count({ where: { tenantId, isActive: true } }),
      prisma.membership.count({ where: { tenantId } }),
    ]);

    return {
      subscription,
      currentPlan,
      storedCards,
      recentTransactions: transactions,
      usage: {
        orders: {
          used: subscription.ordersUsed,
          limit: subscription.monthlyOrderLimit,
          percentage: subscription.monthlyOrderLimit === -1 
            ? 0 
            : Math.round((subscription.ordersUsed / subscription.monthlyOrderLimit) * 100),
        },
        messages: {
          used: subscription.messagesUsed,
          limit: subscription.monthlyMessageLimit,
          percentage: subscription.monthlyMessageLimit === -1 
            ? 0 
            : Math.round((subscription.messagesUsed / subscription.monthlyMessageLimit) * 100),
        },
        stores: {
          used: storeCount,
          limit: subscription.maxStores,
        },
        users: {
          used: userCount,
          limit: subscription.maxUsers,
        },
      },
    };
  }

  // ==================== MAPPERS ====================

  private mapSubscriptionToDto(subscription: any): SubscriptionDto {
    const now = new Date();
    const trialEndsAt = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
    const isTrialActive = Boolean(subscription.plan === 'TRIAL' && trialEndsAt && trialEndsAt > now);
    const daysUntilTrialEnds = isTrialActive && trialEndsAt
      ? Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      id: subscription.id,
      tenantId: subscription.tenantId,
      plan: subscription.plan,
      status: subscription.status,
      billingCycle: subscription.billingCycle,
      trialEndsAt: subscription.trialEndsAt?.toISOString() || null,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
      monthlyOrderLimit: subscription.monthlyOrderLimit,
      monthlyMessageLimit: subscription.monthlyMessageLimit,
      maxStores: subscription.maxStores,
      maxUsers: subscription.maxUsers,
      ordersUsed: subscription.ordersUsed,
      messagesUsed: subscription.messagesUsed,
      usageResetAt: subscription.usageResetAt.toISOString(),
      autoRenew: subscription.autoRenew,
      cancelledAt: subscription.cancelledAt?.toISOString() || null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      isTrialActive,
      daysUntilTrialEnds,
      usagePercentage: {
        orders: subscription.monthlyOrderLimit === -1 
          ? 0 
          : Math.round((subscription.ordersUsed / subscription.monthlyOrderLimit) * 100),
        messages: subscription.monthlyMessageLimit === -1 
          ? 0 
          : Math.round((subscription.messagesUsed / subscription.monthlyMessageLimit) * 100),
      },
    };
  }

  private mapStoredCardToDto(card: any): StoredCardDto {
    return {
      id: card.id,
      cardAlias: card.cardAlias,
      cardAssociation: card.cardAssociation,
      cardFamily: card.cardFamily,
      cardBankName: card.cardBankName,
      binNumber: card.binNumber,
      lastFourDigits: card.lastFourDigits,
      cardType: card.cardType,
      isDefault: card.isDefault,
      createdAt: card.createdAt.toISOString(),
    };
  }

  private mapTransactionToDto(transaction: any): BillingTransactionDto {
    return {
      id: transaction.id,
      type: transaction.type,
      status: transaction.status,
      amount: Number(transaction.amount),
      currency: transaction.currency,
      plan: transaction.plan,
      billingCycle: transaction.billingCycle,
      errorMessage: transaction.errorMessage,
      createdAt: transaction.createdAt.toISOString(),
      processedAt: transaction.processedAt?.toISOString() || null,
    };
  }
}

export const billingService = new BillingService();

