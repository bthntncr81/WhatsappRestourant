// ==================== SUBSCRIPTION PLANS ====================

export type SubscriptionPlan = 'TRIAL' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'STARTER' | 'PRO';
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
  posIntegration: boolean;
}

export interface ExtraOrderPack {
  orders: number;
  price: number;
  currency: string;
}

export const EXTRA_ORDER_PACKS: ExtraOrderPack[] = [
  { orders: 500, price: 50, currency: 'USD' },
  { orders: 1000, price: 85, currency: 'USD' },
  { orders: 2000, price: 125, currency: 'USD' },
];

export const POS_INTEGRATION_MONTHLY_PRICE = 1000; // TL/ay

export interface PlanDefinition {
  key: SubscriptionPlan;
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  isFree: boolean;
  features: PlanFeatures;
  popular?: boolean;
}

// NOTE: iyzico pricing plan reference codes are intentionally NOT in this
// shared DTO — they are a backend concern tied to the platform iyzico
// account and should never leak to the frontend. Backend resolves them via
// env vars (see apps/api/src/services/billing.service.ts → getPlanIyzicoRef).

export const PLAN_DEFINITIONS: Record<SubscriptionPlan, PlanDefinition> = {
  TRIAL: {
    key: 'TRIAL',
    name: 'Deneme',
    description: '14 günlük ücretsiz deneme',
    monthlyPrice: 0,
    annualPrice: 0,
    currency: 'USD',
    isFree: true,
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
      posIntegration: false,
    },
  },
  SILVER: {
    key: 'SILVER',
    name: 'Gümüş',
    description: 'Küçük ve orta ölçekli işletmeler için',
    monthlyPrice: 80,
    annualPrice: 840, // $70/ay × 12
    currency: 'USD',
    isFree: false,
    features: {
      monthlyOrderLimit: 750,
      monthlyMessageLimit: 3000,
      maxStores: 1,
      maxUsers: 3,
      whatsappIntegration: true,
      prioritySupport: false,
      customBranding: false,
      apiAccess: false,
      analytics: true,
      multiLanguage: false,
      posIntegration: false,
    },
  },
  GOLD: {
    key: 'GOLD',
    name: 'Gold',
    description: 'Büyüyen işletmeler için ideal',
    monthlyPrice: 135,
    annualPrice: 1440, // $120/ay × 12
    currency: 'USD',
    isFree: false,
    popular: true,
    features: {
      monthlyOrderLimit: 1500,
      monthlyMessageLimit: 6000,
      maxStores: 2,
      maxUsers: 5,
      whatsappIntegration: true,
      prioritySupport: true,
      customBranding: false,
      apiAccess: true,
      analytics: true,
      multiLanguage: false,
      posIntegration: false,
    },
  },
  PLATINUM: {
    key: 'PLATINUM',
    name: 'Platinyum',
    description: 'Yüksek hacimli işletmeler ve zincirler için',
    monthlyPrice: 380,
    annualPrice: 4080, // $340/ay × 12
    currency: 'USD',
    isFree: false,
    features: {
      monthlyOrderLimit: 3000,
      monthlyMessageLimit: 15000,
      maxStores: 5,
      maxUsers: 15,
      whatsappIntegration: true,
      prioritySupport: true,
      customBranding: true,
      apiAccess: true,
      analytics: true,
      multiLanguage: true,
      posIntegration: false,
    },
  },
  // Legacy plans — kept for existing subscriptions, hidden from new signups
  STARTER: {
    key: 'STARTER',
    name: 'Starter (Eski)',
    description: 'Bu plan artık yeni üyeliklere kapalıdır',
    monthlyPrice: 0,
    annualPrice: 0,
    currency: 'USD',
    isFree: false,
    features: {
      monthlyOrderLimit: 500, monthlyMessageLimit: 2000, maxStores: 1, maxUsers: 3,
      whatsappIntegration: true, prioritySupport: false, customBranding: false,
      apiAccess: false, analytics: true, multiLanguage: false, posIntegration: false,
    },
  },
  PRO: {
    key: 'PRO',
    name: 'Pro (Eski)',
    description: 'Bu plan artık yeni üyeliklere kapalıdır',
    monthlyPrice: 0,
    annualPrice: 0,
    currency: 'USD',
    isFree: false,
    features: {
      monthlyOrderLimit: 2000, monthlyMessageLimit: 10000, maxStores: 3, maxUsers: 10,
      whatsappIntegration: true, prioritySupport: true, customBranding: true,
      apiAccess: true, analytics: true, multiLanguage: true, posIntegration: false,
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

