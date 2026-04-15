import crypto from 'crypto';
import { createLogger } from '../logger';
import prisma from '../db/prisma';

const logger = createLogger();

// ==================== CONFIGURATION ====================

const IYZICO_SANDBOX_URL = 'https://sandbox-api.iyzipay.com';
const IYZICO_PROD_URL = 'https://api.iyzipay.com';

interface IyzicoConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  source: 'tenant' | 'env';
}

/**
 * Read iyzico credentials from environment variables.
 * Used as the fallback when a tenant has not configured their own keys.
 * No hardcoded sandbox values — set IYZICO_API_KEY/IYZICO_SECRET_KEY in .env.
 */
function getEnvConfig(): IyzicoConfig {
  return {
    apiKey: process.env.IYZICO_API_KEY || '',
    secretKey: process.env.IYZICO_SECRET_KEY || '',
    baseUrl: process.env.IYZICO_BASE_URL || IYZICO_SANDBOX_URL,
    source: 'env',
  };
}

/**
 * Resolve iyzico config for a tenant.
 * Preference order:
 *   1. Tenant-level keys from Settings (tenant.iyzicoApiKey/SecretKey). baseUrl
 *      is derived from tenant.iyzicoMode ('test' → sandbox, 'prod' → prod)
 *      so test/prod keys can never be paired with the wrong endpoint.
 *   2. Environment fallback (process.env.IYZICO_*).
 *
 * Throws if neither tenant nor env provides usable credentials — this is a
 * hard error rather than a silent sandbox fallback, to catch misconfiguration.
 */
async function resolveIyzicoConfig(tenantId: string): Promise<IyzicoConfig> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { iyzicoApiKey: true, iyzicoSecretKey: true, iyzicoMode: true },
  });

  if (tenant?.iyzicoApiKey && tenant?.iyzicoSecretKey) {
    return {
      apiKey: tenant.iyzicoApiKey,
      secretKey: tenant.iyzicoSecretKey,
      baseUrl: tenant.iyzicoMode === 'prod' ? IYZICO_PROD_URL : IYZICO_SANDBOX_URL,
      source: 'tenant',
    };
  }

  const env = getEnvConfig();
  if (!env.apiKey || !env.secretKey) {
    throw new Error(
      'iyzico yapılandırması eksik: ne tenant anahtarları ne de IYZICO_API_KEY/IYZICO_SECRET_KEY env değişkenleri bulundu',
    );
  }
  return env;
}

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
 * Format price for iyzico (e.g. "155.00" -> "155.0", "130" -> "130.0")
 * iyzico expects at least one decimal place but no trailing zeros
 */
export function formatPrice(price: string | number): string {
  if (price === null || price === undefined) return '0.0';
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (!isFinite(num)) return '0.0';
  const result = num.toString();
  if (result.indexOf('.') === -1) {
    return result + '.0';
  }
  return result;
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
  constructor() {
    logger.info('Iyzico service initialized (tenant-scoped)');
  }

  /**
   * Make authenticated request to iyzico API using the tenant's own
   * credentials (or env fallback). Every call site MUST pass a tenantId —
   * we no longer cache a single env-based config.
   */
  private async request<T>(
    tenantId: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<{ success: boolean; data?: T; error?: string; errorCode?: string }> {
    const config = await resolveIyzicoConfig(tenantId);
    const url = `${config.baseUrl}${path}`;
    const requestBody = body ? JSON.stringify(body) : '';

    const { authorization, randomKey } = generateAuthHeader(
      config.apiKey,
      config.secretKey,
      path,
      requestBody
    );

    const headers: Record<string, string> = {
      'Authorization': authorization,
      'x-iyzi-rnd': randomKey,
      'Content-Type': 'application/json',
    };

    try {
      logger.info(
        {
          tenantId,
          configSource: config.source,
          baseUrl: config.baseUrl,
          method,
          path,
          body: requestBody.substring(0, 500),
        },
        'Making iyzico request',
      );

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
  async initializeSubscription(tenantId: string, params: {
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

    const result = await this.request<SubscriptionInitResponse>(tenantId, 'POST', '/v2/subscription/initialize', body);

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
  async initializeSubscriptionCheckoutForm(tenantId: string, params: {
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
    }>(tenantId, 'POST', '/v2/subscription/checkoutform/initialize', body);

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
  async getSubscription(tenantId: string, subscriptionRefCode: string): Promise<{
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
    }>(tenantId, 'GET', `/v2/subscription/${subscriptionRefCode}`);

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
  async cancelSubscription(tenantId: string, subscriptionRefCode: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      subscriptionReferenceCode: subscriptionRefCode,
    };

    const result = await this.request(tenantId, 'POST', '/v2/subscription/cancel', body);
    return { success: result.success, error: result.error };
  }

  /**
   * Upgrade/change subscription plan
   */
  async upgradeSubscription(
    tenantId: string,
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
    }>(tenantId, 'POST', '/v2/subscription/upgrade', body);

    if (result.success && result.data) {
      return {
        success: true,
        newSubscriptionRefCode: result.data.data.referenceCode,
      };
    }

    return { success: false, error: result.error };
  }

  // ==================== CHECKOUT FORM (Order Payments) ====================

  /**
   * Initialize checkout form for one-time order payment
   */
  async initializeCheckoutForm(tenantId: string, params: {
    price: string;
    paidPrice: string;
    basketId: string;
    conversationId: string;
    callbackUrl: string;
    buyer: {
      id: string;
      name: string;
      surname: string;
      gsmNumber: string;
      email: string;
      identityNumber: string;
      ip: string;
      city: string;
      country: string;
      address: string;
      zipCode: string;
    };
    basketItems: Array<{
      id: string;
      name: string;
      category1: string;
      itemType: 'PHYSICAL' | 'VIRTUAL';
      price: string;
    }>;
  }): Promise<{
    success: boolean;
    token?: string;
    paymentPageUrl?: string;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: params.conversationId,
      price: formatPrice(params.price),
      paidPrice: formatPrice(params.paidPrice),
      currency: 'TRY',
      basketId: params.basketId,
      paymentGroup: 'PRODUCT',
      callbackUrl: params.callbackUrl,
      enabledInstallments: [1],
      buyer: {
        id: params.buyer.id,
        name: sanitizeForIyzico(params.buyer.name),
        surname: sanitizeForIyzico(params.buyer.surname),
        gsmNumber: formatGsmNumber(params.buyer.gsmNumber),
        email: params.buyer.email,
        identityNumber: params.buyer.identityNumber,
        registrationAddress: sanitizeForIyzico(params.buyer.address),
        ip: getValidIp(params.buyer.ip),
        city: sanitizeForIyzico(params.buyer.city),
        country: sanitizeForIyzico(params.buyer.country),
        zipCode: params.buyer.zipCode,
      },
      shippingAddress: {
        contactName: sanitizeForIyzico(`${params.buyer.name} ${params.buyer.surname}`),
        city: sanitizeForIyzico(params.buyer.city),
        country: sanitizeForIyzico(params.buyer.country),
        address: sanitizeForIyzico(params.buyer.address),
        zipCode: params.buyer.zipCode,
      },
      billingAddress: {
        contactName: sanitizeForIyzico(`${params.buyer.name} ${params.buyer.surname}`),
        city: sanitizeForIyzico(params.buyer.city),
        country: sanitizeForIyzico(params.buyer.country),
        address: sanitizeForIyzico(params.buyer.address),
        zipCode: params.buyer.zipCode,
      },
      basketItems: params.basketItems.map((item) => ({
        id: item.id,
        name: sanitizeForIyzico(item.name),
        category1: sanitizeForIyzico(item.category1),
        itemType: item.itemType,
        price: formatPrice(item.price),
      })),
    };

    const result = await this.request<{
      token: string;
      checkoutFormContent: string;
      paymentPageUrl: string;
      tokenExpireTime: number;
    }>(tenantId, 'POST', '/payment/iyzipos/checkoutform/initialize/auth/ecom', body);

    if (result.success && result.data) {
      return {
        success: true,
        token: result.data.token,
        paymentPageUrl: result.data.paymentPageUrl,
      };
    }

    return { success: false, error: result.error };
  }

  /**
   * Retrieve checkout form payment result
   */
  async retrieveCheckoutFormResult(tenantId: string, token: string): Promise<{
    success: boolean;
    paymentStatus?: string;
    paymentId?: string;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      token,
    };

    const result = await this.request<{
      paymentStatus: string;
      paymentId: string;
      price: number;
      paidPrice: number;
      errorMessage?: string;
    }>(tenantId, 'POST', '/payment/iyzipos/checkoutform/auth/ecom/detail', body);

    if (result.success && result.data) {
      return {
        success: true,
        paymentStatus: result.data.paymentStatus,
        paymentId: result.data.paymentId,
      };
    }

    return { success: false, error: result.error };
  }

  // ==================== CARD STORAGE API ====================

  /**
   * Store a card without making a payment
   */
  async storeCard(tenantId: string, params: {
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
    }>(tenantId, 'POST', '/cardstorage/card', body);

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
  async deleteCard(tenantId: string, cardUserKey: string, cardToken: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      cardUserKey,
      cardToken,
    };

    const result = await this.request(tenantId, 'DELETE', '/cardstorage/card', body);
    return { success: result.success, error: result.error };
  }

  /**
   * Get stored cards for a user
   */
  async getStoredCards(tenantId: string, cardUserKey: string): Promise<{
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
    }>(tenantId, 'POST', '/cardstorage/cards', body);

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
  async updateSubscriptionCard(tenantId: string, params: {
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
    }>(tenantId, 'POST', '/v2/subscription/card-update/checkoutform/initialize', body);

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
  async retrySubscriptionPayment(tenantId: string, subscriptionRefCode: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const body = {
      locale: 'tr',
      conversationId: generateConversationId(),
      subscriptionReferenceCode: subscriptionRefCode,
    };

    const result = await this.request(tenantId, 'POST', '/v2/subscription/operation/retry', body);
    return { success: result.success, error: result.error };
  }

  /**
   * Cancel/refund a payment by paymentId
   */
  async cancelPayment(tenantId: string, paymentId: string, ip: string = '85.34.78.112'): Promise<{ success: boolean; error?: string }> {
    try {
      const body = {
        locale: 'tr',
        conversationId: `cancel-${Date.now()}`,
        paymentId,
        ip,
      };

      const result = await this.request(tenantId, 'POST', '/payment/cancel', body);

      if (result.success) {
        return { success: true };
      }
      return { success: false, error: result.error || 'Cancel failed' };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errMsg };
    }
  }
}

export const iyzicoService = new IyzicoService();

