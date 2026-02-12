// ==================== SUBSCRIPTION PLANS ====================

export type SubscriptionPlan = 'TRIAL' | 'STARTER' | 'PRO';
export type SubscriptionStatus = 'ACTIVE' | 'PENDING' | 'CANCELLED' | 'EXPIRED' | 'UNPAID';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';
export type TransactionType = 'SUBSCRIPTION_PAYMENT' | 'SUBSCRIPTION_UPGRADE' | 'SUBSCRIPTION_RENEWAL' | 'REFUND';
export type TransactionStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';

// ==================== PLAN DEFINITIONS ====================

export interface PlanFeatures {
  monthlyOrderLimit: number;
  monthlyMessageLimit: number;
  maxStores: number;
  maxUsers: number;
  whatsappIntegration: boolean;
  prioritySupport: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  analytics: boolean;
  multiLanguage: boolean;
}

export interface PlanDefinition {
  key: SubscriptionPlan;
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  isFree: boolean;
  iyzicoRefCode: string | null; // iyzico pricing plan reference
  features: PlanFeatures;
  popular?: boolean;
}

export const PLAN_DEFINITIONS: Record<SubscriptionPlan, PlanDefinition> = {
  TRIAL: {
    key: 'TRIAL',
    name: 'Deneme',
    description: '14 günlük ücretsiz deneme',
    monthlyPrice: 0,
    annualPrice: 0,
    currency: 'TRY',
    isFree: true,
    iyzicoRefCode: null,
    features: {
      monthlyOrderLimit: 50,
      monthlyMessageLimit: 200,
      maxStores: 1,
      maxUsers: 2,
      whatsappIntegration: true,
      prioritySupport: false,
      customBranding: false,
      apiAccess: false,
      analytics: false,
      multiLanguage: false,
    },
  },
  STARTER: {
    key: 'STARTER',
    name: 'Starter',
    description: 'Küçük işletmeler için ideal',
    monthlyPrice: 299,
    annualPrice: 2990, // ~2 ay ücretsiz
    currency: 'TRY',
    isFree: false,
    iyzicoRefCode: '832d1a63-24e0-4ef2-ace4-3f907ca53f95',
    features: {
      monthlyOrderLimit: 500,
      monthlyMessageLimit: 2000,
      maxStores: 1,
      maxUsers: 3,
      whatsappIntegration: true,
      prioritySupport: false,
      customBranding: false,
      apiAccess: false,
      analytics: true,
      multiLanguage: false,
    },
  },
  PRO: {
    key: 'PRO',
    name: 'Pro',
    description: 'Büyüyen işletmeler için',
    monthlyPrice: 799,
    annualPrice: 7990, // ~2 ay ücretsiz
    currency: 'TRY',
    isFree: false,
    iyzicoRefCode: '662d8855-7a32-4a17-83fb-3e4ef3dcaab1',
    popular: true,
    features: {
      monthlyOrderLimit: 2000,
      monthlyMessageLimit: 10000,
      maxStores: 3,
      maxUsers: 10,
      whatsappIntegration: true,
      prioritySupport: true,
      customBranding: true,
      apiAccess: true,
      analytics: true,
      multiLanguage: true,
    },
  },
};

// ==================== DTOs ====================

export interface SubscriptionDto {
  id: string;
  tenantId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  
  // Usage
  monthlyOrderLimit: number;
  monthlyMessageLimit: number;
  maxStores: number;
  maxUsers: number;
  ordersUsed: number;
  messagesUsed: number;
  usageResetAt: string;
  
  // Renewal
  autoRenew: boolean;
  cancelledAt: string | null;
  cancelAtPeriodEnd: boolean;
  
  // Computed
  isTrialActive: boolean;
  daysUntilTrialEnds: number | null;
  usagePercentage: {
    orders: number;
    messages: number;
  };
}

export interface StoredCardDto {
  id: string;
  cardAlias: string | null;
  cardAssociation: string | null;
  cardFamily: string | null;
  cardBankName: string | null;
  binNumber: string | null;
  lastFourDigits: string | null;
  cardType: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface BillingTransactionDto {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  currency: string;
  plan: SubscriptionPlan | null;
  billingCycle: BillingCycle | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
}

// ==================== REQUEST DTOs ====================

export interface SubscribeWithNewCardDto {
  planKey: SubscriptionPlan;
  billingCycle: BillingCycle;
  card: {
    cardHolderName: string;
    cardNumber: string;
    expireMonth: string;
    expireYear: string;
    cvc: string;
  };
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
  };
  cardAlias?: string;
  saveCard?: boolean;
}

export interface SubscribeWithStoredCardDto {
  planKey: SubscriptionPlan;
  billingCycle: BillingCycle;
  storedCardId: string;
}

export interface RegisterCardDto {
  card: {
    cardHolderName: string;
    cardNumber: string;
    expireMonth: string;
    expireYear: string;
  };
  buyer: {
    email: string;
    name: string;
    surname: string;
  };
  cardAlias?: string;
}

export interface CancelSubscriptionDto {
  immediate: boolean;
  reason?: string;
}

export interface ChangePlanDto {
  newPlan: SubscriptionPlan;
  billingCycle?: BillingCycle;
}

// ==================== RESPONSE DTOs ====================

export interface SubscribeResponseDto {
  success: boolean;
  status: 'Success' | 'Requires3DS' | 'Failed';
  message?: string;
  subscription?: SubscriptionDto;
  threeDsHtmlContent?: string;
  paymentId?: string;
  errorCode?: string;
}

export interface PlansResponseDto {
  plans: PlanDefinition[];
}

export interface BillingOverviewDto {
  subscription: SubscriptionDto;
  currentPlan: PlanDefinition;
  storedCards: StoredCardDto[];
  recentTransactions: BillingTransactionDto[];
  usage: {
    orders: { used: number; limit: number; percentage: number };
    messages: { used: number; limit: number; percentage: number };
    stores: { used: number; limit: number };
    users: { used: number; limit: number };
  };
}

