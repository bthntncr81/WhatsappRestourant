import crypto from 'crypto';
import { createLogger } from '../logger';

const logger = createLogger();

// ==================== CONFIGURATION ====================

interface IyzicoConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  productRefCode: string;
}

const getConfig = (): IyzicoConfig => {
  return {
    apiKey: process.env.IYZICO_API_KEY || 'sandbox-ifkcjkaPdtshoWkt36gjOwpZ9Z5XsUZM',
    secretKey: process.env.IYZICO_SECRET_KEY || 'sandbox-0PfKYCdPshA2ZhqfdGq6JxfB5dXQWeqa',
    baseUrl: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com',
    productRefCode: process.env.IYZICO_PRODUCT_REF_CODE || '4703db20-26dc-45e9-968b-aa0f0ee93b60',
  };
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Generate random string for iyzico auth
 */
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate HMACSHA256 authorization header for iyzico v2 API
 * @see https://docs.iyzico.com/on-hazirliklar/kimlik-dogrulama/hmacsha256-kimlik-dogrulama
 */
function generateAuthHeader(
  apiKey: string,
  secretKey: string,
  uri: string,
  requestBody: string
): { authorization: string; randomKey: string } {
  // 1. Generate random key (timestamp + random string)
  const randomKey = Date.now().toString() + generateRandomString(8);

  // 2. Create payload: randomKey + uri.path + requestBody
  const payload = randomKey + uri + requestBody;

  // 3. Calculate signature: HMACSHA256(payload, secretKey)
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(payload)
    .digest('hex');

  // 4. Create authorization string: base64("apiKey:" + apiKey + "&randomKey:" + randomKey + "&signature:" + signature)
  const authString = `apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`;
  const authorization = 'IYZWSv2 ' + Buffer.from(authString).toString('base64');

  return { authorization, randomKey };
}

/**
 * Sanitize Turkish characters for iyzico (they don't accept Turkish chars)
 */
export function sanitizeForIyzico(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .trim();
}

/**
 * Format GSM number to iyzico format (+905xxxxxxxxx)
 */
export function formatGsmNumber(gsmNumber: string | null | undefined): string {
  if (!gsmNumber) return '+905350000000';
  let cleaned = gsmNumber.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('0')) cleaned = '+9' + cleaned;
    else if (cleaned.startsWith('90')) cleaned = '+' + cleaned;
    else if (cleaned.startsWith('5')) cleaned = '+90' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}

/**
 * Get valid IP (iyzico doesn't accept localhost IPs)
 */
export function getValidIp(ip: string | null | undefined): string {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.includes(':')) {
    return '85.34.78.112'; // Default public IP for sandbox
  }
  return ip;
}

/**
 * Generate unique conversation ID (max 20 chars)
 */
function generateConversationId(): string {
  return `conv-${Date.now().toString(36)}`;
}

// ==================== IYZICO SERVICE ====================

export class IyzicoService {
  private config: IyzicoConfig;

  constructor() {
    this.config = getConfig();
    logger.info({ baseUrl: this.config.baseUrl }, 'Iyzico service initialized');
  }

  /**
   * Make authenticated request to iyzico API
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<{ success: boolean; data?: T; error?: string; errorCode?: string }> {
    const url = `${this.config.baseUrl}${path}`;
    const requestBody = body ? JSON.stringify(body) : '';
    
    const { authorization, randomKey } = generateAuthHeader(
      this.config.apiKey,
      this.config.secretKey,
      path,
      requestBody
    );

    const headers: Record<string, string> = {
      'Authorization': authorization,
      'x-iyzi-rnd': randomKey,
      'Content-Type': 'application/json',
    };

    try {
      logger.debug({ method, path }, 'Making iyzico request');

      const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? requestBody : undefined,
      });

      const data = await response.json();

      if (data.status === 'success') {
        logger.debug({ path, data }, 'Iyzico request successful');
        return { success: true, data };
      } else {
        logger.error({ 
          path, 
          errorCode: data.errorCode,
          errorMessage: data.errorMessage,
          errorGroup: data.errorGroup,
          locale: data.locale,
          conversationId: data.conversationId,
          fullResponse: JSON.stringify(data)
        }, 'Iyzico request failed');
        return {
          success: false,
          error: data.errorMessage || data.errorCode || 'Bilinmeyen hata',
          errorCode: data.errorCode,
        };
      }
    } catch (error) {
      logger.error({ path, error }, 'Iyzico request error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Request failed',
      };
    }
  }

  // ==================== SUBSCRIPTION API ====================

  /**
   * Initialize subscription with new card (NON-3DS)
   */
  async initializeSubscription(params: {
    pricingPlanRefCode: string;
    customerRefCode: string;
    email: string;
    name: string;
    surname: string;
    gsmNumber: string;
    identityNumber: string;
    address: {
      city: string;
      country: string;
      address: string;
      zipCode: string;
    };
    card: {
      cardHolderName: string;
      cardNumber: string;
      expireMonth: string;
      expireYear: string;
      cvc: string;
    };
    registerCard?: boolean;
  }): Promise<{
    success: boolean;
    subscriptionRefCode?: string;
    customerRefCode?: string;
    error?: string;
    errorCode?: string;
  }> {
    const conversationId = generateConversationId();
    
    const body = {
      locale: 'tr',
      conversationId,
      pricingPlanReferenceCode: params.pricingPlanRefCode,
      subscriptionInitialStatus: 'ACTIVE',
      customer: {
        referenceCode: params.customerRefCode,
        email: sanitizeForIyzico(params.email),
        name: sanitizeForIyzico(params.name),
        surname: sanitizeForIyzico(params.surname),
        gsmNumber: formatGsmNumber(params.gsmNumber),
        identityNumber: params.identityNumber,
        billingAddress: {
          contactName: sanitizeForIyzico(`${params.name} ${params.surname}`),
          city: sanitizeForIyzico(params.address.city),
          country: sanitizeForIyzico(params.address.country),
          address: sanitizeForIyzico(params.address.address),
          zipCode: params.address.zipCode,
        },
        shippingAddress: {
          contactName: sanitizeForIyzico(`${params.name} ${params.surname}`),
          city: sanitizeForIyzico(params.address.city),
          country: sanitizeForIyzico(params.address.country),
          address: sanitizeForIyzico(params.address.address),
          zipCode: params.address.zipCode,
        },
      },
      paymentCard: {
        cardHolderName: sanitizeForIyzico(params.card.cardHolderName),
        cardNumber: params.card.cardNumber.replace(/\s/g, ''),
        expireMonth: params.card.expireMonth,
        expireYear: params.card.expireYear,
        cvc: params.card.cvc,
        registerCard: params.registerCard ? 1 : 0,
      },
    };

    interface SubscriptionInitResponse {
      referenceCode?: string;
      parentReferenceCode?: string;
      subscriptionReferenceCode?: string;
      customerReferenceCode?: string;
      data?: {
        referenceCode?: string;
        parentReferenceCode?: string;
        subscriptionReferenceCode?: string;
        customerReferenceCode?: string;
      };
    }

    const result = await this.request<SubscriptionInitResponse>('POST', '/v2/subscription/initialize', body);

    if (result.success && result.data) {
      // iyzico returns nested data in some responses (data.data)
      const nested = result.data.data;
      const subscriptionData = nested || result.data;
      return {
        success: true,
        subscriptionRefCode: subscriptionData.referenceCode || subscriptionData.subscriptionReferenceCode || '',
        customerRefCode: subscriptionData.parentReferenceCode || subscriptionData.customerReferenceCode || '',
      };
    }

    return {
      success: false,
      error: result.error,
      errorCode: result.errorCode,
    };
  }

  /**
   * Initialize subscription with Checkout Form (supports 3DS)
   */
  async initializeSubscriptionCheckoutForm(params: {
    pricingPlanRefCode: string;
    customerRefCode: string;
    email: string;
    name: string;
    surname: string;
    gsmNumber: string;
    identityNumber: string;
    address: {
      city: string;
      country: string;
      address: string;
      zipCode: string;
    };
    callbackUrl: string;
  }): Promise<{
    success: boolean;
    checkoutFormContent?: string;
    token?: string;
    tokenExpireTime?: number;
    error?: string;
    errorCode?: string;
  }> {
    const conversationId = generateConversationId();
    
    const body = {
      locale: 'tr',
      conversationId,
      pricingPlanReferenceCode: params.pricingPlanRefCode,
      subscriptionInitialStatus: 'ACTIVE',
      callbackUrl: params.callbackUrl,
      customer: {
        referenceCode: params.customerRefCode,
        email: sanitizeForIyzico(params.email),
        name: sanitizeForIyzico(params.name),
        surname: sanitizeForIyzico(params.surname),
        gsmNumber: formatGsmNumber(params.gsmNumber),
        identityNumber: params.identityNumber,
        billingAddress: {
          contactName: sanitizeForIyzico(`${params.name} ${params.surname}`),
          city: sanitizeForIyzico(params.address.city),
          country: sanitizeForIyzico(params.address.country),
          address: sanitizeForIyzico(params.address.address),
          zipCode: params.address.zipCode,
        },
        shippingAddress: {
          contactName: sanitizeForIyzico(`${params.name} ${params.surname}`),
          city: sanitizeForIyzico(params.address.city),
          country: sanitizeForIyzico(params.address.country),
          address: sanitizeForIyzico(params.address.address),
          zipCode: params.address.zipCode,
        },
      },
    };

    const result = await this.request<{
      checkoutFormContent: string;
      token: string;
      tokenExpireTime: number;
    }>('POST', '/v2/subscription/checkoutform/initialize', body);

    if (result.success && result.data) {
      return {
        success: true,
        checkoutFormContent: result.data.checkoutFormContent,
        token: result.data.token,
        tokenExpireTime: result.data.tokenExpireTime,
      };
    }

    return {
      success: false,
      error: result.error,
      errorCode: result.errorCode,
    };
  }

  /**
   * Get subscription details
   */
  async getSubscription(subscriptionRefCode: string): Promise<{
    success: boolean;
    subscription?: {
      referenceCode: string;
      status: string;
      pricingPlanName: string;
      startDate: number;
      endDate: number;
      trialDays: number;
      trialEndDate?: number;
    };
    error?: string;
  }> {
    const result = await this.request<{
      data: {
        referenceCode: string;
        subscriptionStatus: string;
        pricingPlanName: string;
        startDate: number;
        endDate: number;
        trialDays: number;
        trialEndDate?: number;
      };
    }>('GET', `/v2/subscription/${subscriptionRefCode}`);

    if (result.success && result.data) {
      return {
        success: true,
        subscription: {
          referenceCode: result.data.data.referenceCode,
          status: result.data.data.subscriptionStatus,
          pricingPlanName: result.data.data.pricingPlanName,
          startDate: result.data.data.startDate,
          endDate: result.data.data.endDate,
          trialDays: result.data.data.trialDays,
          trialEndDate: result.data.data.trialEndDate,
        },
      };
    }

    return { success: false, error: result.error };
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionRefCode: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      subscriptionReferenceCode: subscriptionRefCode,
    };

    const result = await this.request('POST', '/v2/subscription/cancel', body);
    return { success: result.success, error: result.error };
  }

  /**
   * Upgrade/change subscription plan
   */
  async upgradeSubscription(
    subscriptionRefCode: string,
    newPricingPlanRefCode: string,
    resetRecurrenceCount: boolean = true
  ): Promise<{
    success: boolean;
    newSubscriptionRefCode?: string;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      subscriptionReferenceCode: subscriptionRefCode,
      newPricingPlanReferenceCode: newPricingPlanRefCode,
      upgradePeriod: 'NOW',
      useTrial: false,
      resetRecurrenceCount,
    };

    const result = await this.request<{
      data: { referenceCode: string };
    }>('POST', '/v2/subscription/upgrade', body);

    if (result.success && result.data) {
      return {
        success: true,
        newSubscriptionRefCode: result.data.data.referenceCode,
      };
    }

    return { success: false, error: result.error };
  }

  // ==================== CARD STORAGE API ====================

  /**
   * Store a card without making a payment
   */
  async storeCard(params: {
    email: string;
    externalId: string; // tenantId
    card: {
      cardAlias: string;
      cardHolderName: string;
      cardNumber: string;
      expireMonth: string;
      expireYear: string;
    };
  }): Promise<{
    success: boolean;
    cardToken?: string;
    cardUserKey?: string;
    cardAssociation?: string;
    cardFamily?: string;
    cardBankName?: string;
    binNumber?: string;
    lastFourDigits?: string;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      email: sanitizeForIyzico(params.email),
      externalId: params.externalId,
      card: {
        cardAlias: sanitizeForIyzico(params.card.cardAlias),
        cardHolderName: sanitizeForIyzico(params.card.cardHolderName),
        cardNumber: params.card.cardNumber.replace(/\s/g, ''),
        expireMonth: params.card.expireMonth,
        expireYear: params.card.expireYear,
      },
    };

    const result = await this.request<{
      cardToken: string;
      cardUserKey: string;
      cardAssociation: string;
      cardFamily: string;
      cardBankName: string;
      binNumber: string;
      lastFourDigits: string;
    }>('POST', '/cardstorage/card', body);

    if (result.success && result.data) {
      return {
        success: true,
        cardToken: result.data.cardToken,
        cardUserKey: result.data.cardUserKey,
        cardAssociation: result.data.cardAssociation,
        cardFamily: result.data.cardFamily,
        cardBankName: result.data.cardBankName,
        binNumber: result.data.binNumber,
        lastFourDigits: result.data.lastFourDigits,
      };
    }

    return { success: false, error: result.error };
  }

  /**
   * Delete a stored card
   */
  async deleteCard(cardUserKey: string, cardToken: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      cardUserKey,
      cardToken,
    };

    const result = await this.request('DELETE', '/cardstorage/card', body);
    return { success: result.success, error: result.error };
  }

  /**
   * Get stored cards for a user
   */
  async getStoredCards(cardUserKey: string): Promise<{
    success: boolean;
    cards?: Array<{
      cardToken: string;
      cardAlias: string;
      cardAssociation: string;
      cardFamily: string;
      cardBankName: string;
      binNumber: string;
      lastFourDigits: string;
      cardType: string;
    }>;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      cardUserKey,
    };

    const result = await this.request<{
      cardDetails: Array<{
        cardToken: string;
        cardAlias: string;
        cardAssociation: string;
        cardFamily: string;
        cardBankName: string;
        binNumber: string;
        lastFourDigits: string;
        cardType: string;
      }>;
    }>('POST', '/cardstorage/cards', body);

    if (result.success && result.data) {
      return {
        success: true,
        cards: result.data.cardDetails || [],
      };
    }

    return { success: false, error: result.error };
  }

  /**
   * Update subscription card (for card updates)
   */
  async updateSubscriptionCard(params: {
    customerRefCode: string;
    subscriptionRefCode?: string;
    callbackUrl: string;
  }): Promise<{
    success: boolean;
    checkoutFormContent?: string;
    token?: string;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      callbackUrl: params.callbackUrl,
      customerReferenceCode: params.customerRefCode,
      ...(params.subscriptionRefCode && { subscriptionReferenceCode: params.subscriptionRefCode }),
    };

    const result = await this.request<{
      checkoutFormContent: string;
      token: string;
      tokenExpireTime: number;
    }>('POST', '/v2/subscription/card-update/checkoutform/initialize', body);

    if (result.success && result.data) {
      return {
        success: true,
        checkoutFormContent: result.data.checkoutFormContent,
        token: result.data.token,
      };
    }

    return { success: false, error: result.error };
  }

  /**
   * Retry failed subscription payment
   */
  async retrySubscriptionPayment(subscriptionRefCode: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      subscriptionReferenceCode: subscriptionRefCode,
    };

    const result = await this.request('POST', '/v2/subscription/operation/retry', body);
    return { success: result.success, error: result.error };
  }
}

export const iyzicoService = new IyzicoService();

