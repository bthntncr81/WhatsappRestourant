import prisma from '../db/prisma';
import { createLogger } from '../logger';
import { savedAddressService } from './saved-address.service';

const logger = createLogger();

export interface CustomerDetailDto {
  customerPhone: string;
  customerName: string | null;
  firstOrderDate: string | null;
  stats: {
    totalOrders: number;
    totalSpent: number;
    averageOrderValue: number;
    cancelledOrders: number;
  };
  favoriteItems: {
    menuItemName: string;
    totalQty: number;
    orderCount: number;
  }[];
  recentOrders: {
    id: string;
    orderNumber: number | null;
    status: string;
    totalPrice: number;
    deliveryAddress: string | null;
    paymentMethod: string | null;
    items: { menuItemName: string; qty: number; unitPrice: number }[];
    createdAt: string;
  }[];
  savedAddresses: {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
  }[];
}

export class CustomerService {
  async getCustomerDetails(tenantId: string, customerPhone: string): Promise<CustomerDetailDto> {
    const [orders, savedAddresses, conversation] = await Promise.all([
      prisma.order.findMany({
        where: {
          tenantId,
          customerPhone,
          status: { not: 'DRAFT' },
        },
        include: {
          items: {
            select: {
              menuItemName: true,
              qty: true,
              unitPrice: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      savedAddressService.getByCustomerPhone(tenantId, customerPhone),
      prisma.conversation.findUnique({
        where: {
          tenantId_customerPhone: { tenantId, customerPhone },
        },
        select: { customerName: true },
      }),
    ]);

    const completedOrders = orders.filter(o => o.status !== 'CANCELLED');
    const cancelledOrders = orders.filter(o => o.status === 'CANCELLED');
    const totalSpent = completedOrders.reduce(
      (sum, o) => sum + Number(o.totalPrice),
      0,
    );

    // Aggregate favorite items from non-cancelled orders
    const itemMap = new Map<string, { totalQty: number; orderIds: Set<string> }>();
    for (const order of completedOrders) {
      for (const item of order.items) {
        const existing = itemMap.get(item.menuItemName) || {
          totalQty: 0,
          orderIds: new Set<string>(),
        };
        existing.totalQty += item.qty;
        existing.orderIds.add(order.id);
        itemMap.set(item.menuItemName, existing);
      }
    }

    const favoriteItems = Array.from(itemMap.entries())
      .map(([menuItemName, data]) => ({
        menuItemName,
        totalQty: data.totalQty,
        orderCount: data.orderIds.size,
      }))
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 5);

    const recentOrders = orders.slice(0, 20).map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      totalPrice: Number(o.totalPrice),
      deliveryAddress: o.deliveryAddress,
      paymentMethod: o.paymentMethod,
      items: o.items.map(item => ({
        menuItemName: item.menuItemName,
        qty: item.qty,
        unitPrice: Number(item.unitPrice),
      })),
      createdAt: o.createdAt.toISOString(),
    }));

    const customerName =
      conversation?.customerName || orders[0]?.customerName || null;

    return {
      customerPhone,
      customerName,
      firstOrderDate:
        orders.length > 0
          ? orders[orders.length - 1].createdAt.toISOString()
          : null,
      stats: {
        totalOrders: orders.length,
        totalSpent: Math.round(totalSpent * 100) / 100,
        averageOrderValue:
          completedOrders.length > 0
            ? Math.round((totalSpent / completedOrders.length) * 100) / 100
            : 0,
        cancelledOrders: cancelledOrders.length,
      },
      favoriteItems,
      recentOrders,
      savedAddresses: savedAddresses.map(a => ({
        id: a.id,
        name: a.name,
        address: a.address,
        lat: a.lat,
        lng: a.lng,
      })),
    };
  }
}

export const customerService = new CustomerService();
