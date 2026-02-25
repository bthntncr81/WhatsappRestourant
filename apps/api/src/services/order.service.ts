import prisma from '../db/prisma';
import { AppError } from '../middleware/error-handler';
import { createLogger } from '../logger';
import {
  OrderDto,
  OrderStatus,
  ConfirmOrderDto,
  OrderListQueryDto,
  PrintJobPayload,
} from '@whatres/shared';
import { Prisma } from '@prisma/client';
import { chatbotService } from './chatbot.service';
import { whatsappService } from './whatsapp.service';
import { TEMPLATES } from './message-templates';

const logger = createLogger();

export class OrderService {
  // ==================== CRUD ====================

  async getOrders(
    tenantId: string,
    query: OrderListQueryDto
  ): Promise<{ orders: OrderDto[]; total: number }> {
    const where: Prisma.OrderWhereInput = { tenantId };

    if (query.status) {
      where.status = query.status;
    }
    if (query.conversationId) {
      where.conversationId = query.conversationId;
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { 
          items: true,
          store: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit || 50,
        skip: query.offset || 0,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders: orders.map((o) => this.mapToDto(o)),
      total,
    };
  }

  async getOrder(tenantId: string, orderId: string): Promise<OrderDto> {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { 
        items: true,
        store: { select: { id: true, name: true } },
      },
    });

    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    return this.mapToDto(order);
  }

  async getOrderByConversation(
    tenantId: string,
    conversationId: string,
    status?: OrderStatus
  ): Promise<OrderDto | null> {
    const where: Prisma.OrderWhereInput = {
      tenantId,
      conversationId,
    };

    if (status) {
      where.status = status;
    }

    const order = await prisma.order.findFirst({
      where,
      include: { 
        items: true,
        store: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return order ? this.mapToDto(order) : null;
  }

  // ==================== PENDING CONFIRMATION ====================

  /**
   * Move order to PENDING_CONFIRMATION status (customer submitted, awaiting restaurant approval).
   * Called by conversation flow after payment is completed.
   */
  async setPendingConfirmation(
    tenantId: string,
    orderId: string,
    dto: ConfirmOrderDto,
  ): Promise<OrderDto> {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: true,
        conversation: true,
      },
    });

    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    if (order.status !== 'DRAFT') {
      throw new AppError(400, 'INVALID_STATUS', `Cannot set pending for order with status ${order.status}`);
    }

    // Get next order number
    const orderNumber = await this.getNextOrderNumber(tenantId);

    // Determine storeId
    let storeId = order.storeId;
    if (!storeId) {
      if (order.conversation.nearestStoreId) {
        storeId = order.conversation.nearestStoreId;
      } else {
        const defaultStore = await prisma.store.findFirst({
          where: { tenantId, isActive: true },
          orderBy: { createdAt: 'asc' },
        });
        storeId = defaultStore?.id || null;
      }
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'PENDING_CONFIRMATION',
        orderNumber,
        storeId,
        paymentMethod: dto.paymentMethod || order.paymentMethod,
        deliveryAddress: dto.deliveryAddress || order.deliveryAddress,
        notes: dto.notes || order.notes,
        customerPhone: order.conversation.customerPhone,
        customerName: order.conversation.customerName,
      },
      include: {
        items: true,
        store: { select: { id: true, name: true } },
      },
    });

    logger.info(
      { tenantId, orderId, orderNumber, storeId },
      'Order set to PENDING_CONFIRMATION',
    );

    return this.mapToDto(updatedOrder);
  }

  // ==================== CONFIRM (Restaurant Approval) ====================

  /**
   * Confirm order (called by restaurant/admin from panel).
   * Only works on PENDING_CONFIRMATION orders.
   * Sends WhatsApp notification to customer and creates print jobs.
   */
  async confirmOrder(
    tenantId: string,
    orderId: string,
    dto: ConfirmOrderDto
  ): Promise<OrderDto> {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: true,
        conversation: true,
      },
    });

    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    if (order.status !== 'PENDING_CONFIRMATION') {
      throw new AppError(400, 'INVALID_STATUS', `Cannot confirm order with status ${order.status}. Order must be in PENDING_CONFIRMATION.`);
    }

    // Update order
    const confirmedOrder = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          deliveryAddress: dto.deliveryAddress || order.deliveryAddress,
          paymentMethod: dto.paymentMethod || order.paymentMethod,
          notes: dto.notes || order.notes,
        },
        include: {
          items: true,
          store: { select: { id: true, name: true } },
        },
      });

      // Create print jobs
      await this.createPrintJobs(tx, tenantId, updated);

      return updated;
    });

    // Send WhatsApp notification to customer
    try {
      await whatsappService.sendText(
        tenantId,
        order.conversationId,
        TEMPLATES.restaurantApproved(confirmedOrder.orderNumber || 0),
      );
    } catch (error) {
      logger.error({ error, tenantId, orderId }, 'Failed to send confirmation notification to customer');
    }

    logger.info(
      { tenantId, orderId, orderNumber: confirmedOrder.orderNumber },
      'Order confirmed by restaurant and customer notified',
    );

    return this.mapToDto(confirmedOrder);
  }

  // ==================== UPDATE STATUS ====================

  async updateOrderStatus(
    tenantId: string,
    orderId: string,
    status: OrderStatus
  ): Promise<OrderDto> {
    const order = await prisma.order.update({
      where: { id: orderId, tenantId },
      data: { status },
      include: { 
        items: true,
        store: { select: { id: true, name: true } },
      },
    });

    // Send notification for status change
    await chatbotService.sendOrderStatusNotification(tenantId, orderId, status);

    logger.info({ tenantId, orderId, status }, 'Order status updated');
    return this.mapToDto(order);
  }

  // ==================== PRINT JOBS ====================

  private async createPrintJobs(
    tx: Prisma.TransactionClient,
    tenantId: string,
    order: any
  ): Promise<void> {
    const basePayload = {
      orderNumber: order.orderNumber,
      timestamp: new Date().toISOString(),
      storeName: order.store?.name || null,
      items: order.items.map((item: any) => ({
        name: item.menuItemName,
        qty: item.qty,
        options: (item.optionsJson as any[])?.map((o) => o.optionName) || [],
        notes: item.notes,
      })),
      notes: order.notes,
    };

    // Kitchen receipt
    const kitchenPayload: PrintJobPayload = {
      ...basePayload,
    };

    await tx.printJob.create({
      data: {
        tenantId,
        orderId: order.id,
        type: 'KITCHEN',
        status: 'PENDING',
        payloadJson: kitchenPayload as any,
      },
    });

    // Courier receipt
    const courierPayload: PrintJobPayload = {
      ...basePayload,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      deliveryAddress: order.deliveryAddress,
      paymentMethod: order.paymentMethod,
      totalPrice: Number(order.totalPrice),
    };

    await tx.printJob.create({
      data: {
        tenantId,
        orderId: order.id,
        type: 'COURIER',
        status: 'PENDING',
        payloadJson: courierPayload as any,
      },
    });
  }

  async reprintOrder(
    tenantId: string,
    orderId: string,
    type: 'KITCHEN' | 'COURIER'
  ): Promise<void> {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { 
        items: true,
        store: { select: { name: true } },
      },
    });

    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    if (order.status === 'DRAFT') {
      throw new AppError(400, 'INVALID_STATUS', 'Cannot reprint draft order');
    }

    const payload: PrintJobPayload = {
      orderNumber: order.orderNumber || 0,
      timestamp: new Date().toISOString(),
      storeName: order.store?.name || null,
      items: order.items.map((item) => ({
        name: item.menuItemName,
        qty: item.qty,
        options: (item.optionsJson as any[])?.map((o: any) => o.optionName) || [],
        notes: item.notes,
      })),
      notes: order.notes,
      ...(type === 'COURIER'
        ? {
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            deliveryAddress: order.deliveryAddress,
            paymentMethod: order.paymentMethod,
            totalPrice: Number(order.totalPrice),
          }
        : {}),
    };

    await prisma.printJob.create({
      data: {
        tenantId,
        orderId,
        type,
        status: 'PENDING',
        payloadJson: payload as any,
      },
    });

    logger.info({ tenantId, orderId, type }, 'Reprint job created');
  }

  // ==================== HELPERS ====================

  private async getNextOrderNumber(tenantId: string): Promise<number> {
    // Atomik siparis numarasi - race condition onleme
    const result = await prisma.$queryRaw<Array<{ next_number: bigint }>>`
      SELECT COALESCE(MAX("orderNumber"), 0) + 1 AS next_number
      FROM orders
      WHERE "tenantId" = ${tenantId}
    `;
    return Number(result[0]?.next_number) || 1;
  }

  private mapToDto(order: any): OrderDto {
    return {
      id: order.id,
      tenantId: order.tenantId,
      conversationId: order.conversationId,
      storeId: order.storeId || null,
      storeName: order.store?.name || null,
      orderNumber: order.orderNumber,
      status: order.status as OrderStatus,
      totalPrice: Number(order.totalPrice),
      notes: order.notes,
      customerPhone: order.customerPhone,
      customerName: order.customerName,
      deliveryAddress: order.deliveryAddress,
      paymentMethod: order.paymentMethod,
      items: order.items.map((item: any) => ({
        id: item.id,
        orderId: item.orderId,
        menuItemId: item.menuItemId,
        menuItemName: item.menuItemName,
        qty: item.qty,
        unitPrice: Number(item.unitPrice),
        optionsJson: item.optionsJson,
        extrasJson: item.extrasJson,
        notes: item.notes,
      })),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      confirmedAt: order.confirmedAt?.toISOString() || null,
    };
  }
}

export const orderService = new OrderService();

