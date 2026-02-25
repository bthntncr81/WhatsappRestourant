import prisma from '../db/prisma';
import { createLogger } from '../logger';
import { iyzicoService } from './iyzico.service';
import { OrderPaymentDto } from '@whatres/shared';

const logger = createLogger();

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const API_PREFIX = process.env.API_PREFIX || '/api';

export class OrderPaymentService {
  /**
   * Initiate a card payment via iyzico Checkout Form
   */
  async initiateCardPayment(
    tenantId: string,
    orderId: string,
    conversationId: string,
    customerPhone: string,
  ): Promise<OrderPaymentDto> {
    // Get order with items
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: true,
        conversation: true,
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    const totalPrice = Number(order.totalPrice);
    const callbackUrl = `${APP_BASE_URL}${API_PREFIX}/payments/callback/iyzico`;

    // Build basket items for iyzico
    const basketItems = order.items.map((item) => ({
      id: item.id,
      name: item.menuItemName,
      category1: 'Yemek',
      itemType: 'PHYSICAL' as const,
      price: (Number(item.unitPrice) * item.qty).toFixed(2),
    }));

    // Initialize checkout form
    const result = await iyzicoService.initializeCheckoutForm({
      price: totalPrice.toFixed(2),
      paidPrice: totalPrice.toFixed(2),
      basketId: orderId,
      conversationId: `ord-${orderId.slice(0, 15)}`,
      callbackUrl,
      buyer: {
        id: `cust-${customerPhone.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`,
        name: order.customerName || 'Musteri',
        surname: 'Musteri',
        gsmNumber: customerPhone,
        email: `musteri${customerPhone.replace(/[^0-9]/g, '').slice(-10) || 'test'}@email.com`,
        identityNumber: '11111111111',
        ip: '85.34.78.112',
        city: 'Istanbul',
        country: 'Turkey',
        address: order.deliveryAddress || 'Adres belirtilmedi',
        zipCode: '34000',
      },
      basketItems,
    });

    if (!result.success || !result.token) {
      logger.error({ orderId, error: result.error }, 'Failed to create iyzico checkout form');
      throw new Error(result.error || 'iyzico checkout form creation failed');
    }

    // Build checkout URL - iyzico returns the content/page URL
    const checkoutFormUrl = result.paymentPageUrl || `${APP_BASE_URL}${API_PREFIX}/payments/checkout/${result.token}`;

    // Create payment record
    const payment = await prisma.orderPayment.create({
      data: {
        tenantId,
        orderId,
        conversationId,
        method: 'CREDIT_CARD',
        status: 'PENDING',
        amount: totalPrice,
        currency: 'TRY',
        iyzicoToken: result.token,
        checkoutFormUrl,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      },
    });

    logger.info(
      { tenantId, orderId, paymentId: payment.id, token: result.token },
      'Card payment initiated',
    );

    return this.mapToDto(payment);
  }

  /**
   * Handle iyzico payment callback
   */
  async handlePaymentCallback(token: string): Promise<{
    success: boolean;
    orderId: string;
    tenantId: string;
    conversationId: string;
    paymentId?: string;
  }> {
    // Find payment by token
    const payment = await prisma.orderPayment.findFirst({
      where: { iyzicoToken: token },
    });

    if (!payment) {
      logger.error({ token }, 'Payment not found for callback token');
      throw new Error('Payment not found');
    }

    // Retrieve result from iyzico
    const result = await iyzicoService.retrieveCheckoutFormResult(token);

    if (result.success && result.paymentStatus === 'SUCCESS') {
      // Update payment as successful
      await prisma.orderPayment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          iyzicoPaymentId: result.paymentId,
          paidAt: new Date(),
        },
      });

      logger.info(
        { paymentId: payment.id, orderId: payment.orderId, iyzicoPaymentId: result.paymentId },
        'Payment successful',
      );

      return {
        success: true,
        orderId: payment.orderId,
        tenantId: payment.tenantId,
        conversationId: payment.conversationId,
        paymentId: result.paymentId,
      };
    } else {
      // Payment failed
      await prisma.orderPayment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          errorMessage: result.error || 'Payment failed',
        },
      });

      logger.warn(
        { paymentId: payment.id, orderId: payment.orderId, error: result.error },
        'Payment failed',
      );

      return {
        success: false,
        orderId: payment.orderId,
        tenantId: payment.tenantId,
        conversationId: payment.conversationId,
      };
    }
  }

  /**
   * Record a cash payment (immediate success)
   */
  async recordCashPayment(
    tenantId: string,
    orderId: string,
    conversationId: string,
  ): Promise<OrderPaymentDto> {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    const payment = await prisma.orderPayment.create({
      data: {
        tenantId,
        orderId,
        conversationId,
        method: 'CASH',
        status: 'SUCCESS',
        amount: Number(order.totalPrice),
        currency: 'TRY',
        paidAt: new Date(),
      },
    });

    logger.info({ tenantId, orderId, paymentId: payment.id }, 'Cash payment recorded');

    return this.mapToDto(payment);
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(tenantId: string, paymentId: string): Promise<OrderPaymentDto | null> {
    const payment = await prisma.orderPayment.findFirst({
      where: { id: paymentId, tenantId },
    });

    return payment ? this.mapToDto(payment) : null;
  }

  /**
   * Get pending payment for an order
   */
  async getPendingPayment(tenantId: string, orderId: string): Promise<OrderPaymentDto | null> {
    const payment = await prisma.orderPayment.findFirst({
      where: { tenantId, orderId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    return payment ? this.mapToDto(payment) : null;
  }

  // ==================== HELPERS ====================

  private mapToDto(payment: any): OrderPaymentDto {
    return {
      id: payment.id,
      tenantId: payment.tenantId,
      orderId: payment.orderId,
      conversationId: payment.conversationId,
      method: payment.method,
      status: payment.status,
      amount: Number(payment.amount),
      currency: payment.currency,
      checkoutFormUrl: payment.checkoutFormUrl,
      expiresAt: payment.expiresAt?.toISOString() || null,
      paidAt: payment.paidAt?.toISOString() || null,
      createdAt: payment.createdAt.toISOString(),
    };
  }
}

export const orderPaymentService = new OrderPaymentService();
