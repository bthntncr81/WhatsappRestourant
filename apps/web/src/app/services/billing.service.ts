import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

// ==================== TYPES ====================

export type SubscriptionPlan = 'TRIAL' | 'STARTER' | 'PRO';
export type SubscriptionStatus = 'ACTIVE' | 'PENDING' | 'CANCELLED' | 'EXPIRED' | 'UNPAID';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string };
}

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
  features: PlanFeatures;
  popular?: boolean;
}

export interface SubscriptionDto {
  id: string;
  tenantId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  monthlyOrderLimit: number;
  monthlyMessageLimit: number;
  maxStores: number;
  maxUsers: number;
  ordersUsed: number;
  messagesUsed: number;
  usageResetAt: string;
  autoRenew: boolean;
  cancelledAt: string | null;
  cancelAtPeriodEnd: boolean;
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
  type: string;
  status: string;
  amount: number;
  currency: string;
  plan: SubscriptionPlan | null;
  billingCycle: BillingCycle | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
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

@Injectable({
  providedIn: 'root',
})
export class BillingService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  private get headers() {
    return { headers: this.authService.getAuthHeaders() };
  }

  // ==================== PLANS ====================

  getPlans(): Observable<ApiResponse<{ plans: PlanDefinition[] }>> {
    return this.http.get<ApiResponse<{ plans: PlanDefinition[] }>>(
      `${environment.apiBaseUrl}/billing/plans`
    );
  }

  // ==================== SUBSCRIPTION ====================

  getBillingOverview(): Observable<ApiResponse<BillingOverviewDto>> {
    return this.http.get<ApiResponse<BillingOverviewDto>>(
      `${environment.apiBaseUrl}/billing/overview`,
      this.headers
    );
  }

  getSubscription(): Observable<ApiResponse<SubscriptionDto>> {
    return this.http.get<ApiResponse<SubscriptionDto>>(
      `${environment.apiBaseUrl}/billing/subscription`,
      this.headers
    );
  }

  subscribe(data: {
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
  }): Observable<ApiResponse<{ status: string; subscription?: SubscriptionDto }>> {
    return this.http.post<ApiResponse<{ status: string; subscription?: SubscriptionDto }>>(
      `${environment.apiBaseUrl}/billing/subscribe`,
      data,
      this.headers
    );
  }

  getCheckoutForm(data: {
    planKey: SubscriptionPlan;
    billingCycle: BillingCycle;
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
    callbackUrl: string;
  }): Observable<ApiResponse<{ checkoutFormContent: string; token: string }>> {
    return this.http.post<ApiResponse<{ checkoutFormContent: string; token: string }>>(
      `${environment.apiBaseUrl}/billing/subscribe/checkout-form`,
      data,
      this.headers
    );
  }

  cancelSubscription(immediate: boolean, reason?: string): Observable<ApiResponse<SubscriptionDto>> {
    return this.http.post<ApiResponse<SubscriptionDto>>(
      `${environment.apiBaseUrl}/billing/cancel`,
      { immediate, reason },
      this.headers
    );
  }

  changePlan(newPlan: SubscriptionPlan, billingCycle?: BillingCycle): Observable<ApiResponse<SubscriptionDto>> {
    return this.http.post<ApiResponse<SubscriptionDto>>(
      `${environment.apiBaseUrl}/billing/change-plan`,
      { newPlan, billingCycle },
      this.headers
    );
  }

  // ==================== CARDS ====================

  getCards(): Observable<ApiResponse<{ cards: StoredCardDto[] }>> {
    return this.http.get<ApiResponse<{ cards: StoredCardDto[] }>>(
      `${environment.apiBaseUrl}/billing/cards`,
      this.headers
    );
  }

  registerCard(data: {
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
  }): Observable<ApiResponse<StoredCardDto>> {
    return this.http.post<ApiResponse<StoredCardDto>>(
      `${environment.apiBaseUrl}/billing/cards`,
      data,
      this.headers
    );
  }

  deleteCard(cardId: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${environment.apiBaseUrl}/billing/cards/${cardId}`,
      this.headers
    );
  }

  setDefaultCard(cardId: string): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(
      `${environment.apiBaseUrl}/billing/cards/${cardId}/set-default`,
      {},
      this.headers
    );
  }

  // ==================== TRANSACTIONS ====================

  getTransactions(limit = 20, offset = 0): Observable<ApiResponse<{ transactions: BillingTransactionDto[]; total: number }>> {
    return this.http.get<ApiResponse<{ transactions: BillingTransactionDto[]; total: number }>>(
      `${environment.apiBaseUrl}/billing/transactions?limit=${limit}&offset=${offset}`,
      this.headers
    );
  }
}

