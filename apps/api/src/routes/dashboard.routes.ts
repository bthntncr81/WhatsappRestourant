import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import prisma from '../db/prisma';
import { ApiResponse } from '@whatres/shared';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/dashboard/stats
 * Returns all dashboard KPIs in a single request
 */
router.get('/stats', async (req: Request, res: Response<ApiResponse<any>>) => {
  const tenantId = (req as any).tenantId;

  try {
    // Today boundaries
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 7 days ago
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    // 30 days ago (for popular items)
    const thirtyDaysAgo = new Date(todayStart);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Run all queries in parallel
    const [
      todayOrders,
      todayRevenueAgg,
      activeConversations,
      totalCustomersRaw,
      orderStatusGroups,
      recentOrders,
      weeklyOrdersRaw,
      popularItemsRaw,
      satisfactionAgg,
      complaintCount,
    ] = await Promise.all([
      // 1. Today's order count (exclude DRAFT)
      prisma.order.count({
        where: {
          tenantId,
          createdAt: { gte: todayStart },
          status: { not: 'DRAFT' },
        },
      }),

      // 2. Today's revenue
      prisma.order.aggregate({
        where: {
          tenantId,
          createdAt: { gte: todayStart },
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        _sum: { totalPrice: true },
      }),

      // 3. Active conversations
      prisma.conversation.count({
        where: { tenantId, status: 'OPEN' },
      }),

      // 4. Total unique customers
      prisma.conversation.findMany({
        where: { tenantId },
        select: { customerPhone: true },
        distinct: ['customerPhone'],
      }),

      // 5. Orders by status (all time, non-DRAFT)
      prisma.order.groupBy({
        by: ['status'],
        where: { tenantId, status: { not: 'DRAFT' } },
        _count: true,
      }),

      // 6. Recent 5 orders
      prisma.order.findMany({
        where: { tenantId, status: { not: 'DRAFT' } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { _count: { select: { items: true } } },
      }),

      // 7. Weekly trend (last 7 days)
      prisma.order.findMany({
        where: {
          tenantId,
          createdAt: { gte: sevenDaysAgo },
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        select: { createdAt: true, totalPrice: true },
      }),

      // 8. Popular items (last 30 days)
      prisma.orderItem.groupBy({
        by: ['menuItemName'],
        where: {
          order: {
            tenantId,
            createdAt: { gte: thirtyDaysAgo },
            status: { notIn: ['DRAFT', 'CANCELLED'] },
          },
        },
        _sum: { qty: true },
        _count: { orderId: true },
        orderBy: { _sum: { qty: 'desc' } },
        take: 5,
      }),

      // 9. Satisfaction average
      prisma.satisfactionSurvey.aggregate({
        where: { tenantId },
        _avg: { rating: true },
        _count: true,
      }),

      // 10. Complaint count
      prisma.satisfactionSurvey.count({
        where: { tenantId, isComplaint: true },
      }),
    ]);

    // Process weekly trend into date buckets
    const weeklyTrend: Array<{ date: string; orders: number; revenue: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const nextDay = new Date(d);
      nextDay.setDate(nextDay.getDate() + 1);

      const dayOrders = weeklyOrdersRaw.filter((o) => {
        const oDate = new Date(o.createdAt);
        return oDate >= d && oDate < nextDay;
      });

      weeklyTrend.push({
        date: dateStr,
        orders: dayOrders.length,
        revenue: dayOrders.reduce((sum, o) => sum + Number(o.totalPrice), 0),
      });
    }

    // Map order status groups
    const statusMap: Record<string, number> = {
      PENDING_CONFIRMATION: 0,
      CONFIRMED: 0,
      PREPARING: 0,
      READY: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    };
    for (const g of orderStatusGroups) {
      statusMap[g.status] = g._count;
    }

    const data = {
      todayOrders,
      todayRevenue: Number(todayRevenueAgg._sum.totalPrice || 0),
      activeConversations,
      totalCustomers: totalCustomersRaw.length,

      ordersByStatus: {
        pending: statusMap.PENDING_CONFIRMATION,
        confirmed: statusMap.CONFIRMED,
        preparing: statusMap.PREPARING,
        ready: statusMap.READY,
        delivered: statusMap.DELIVERED,
        cancelled: statusMap.CANCELLED,
      },

      weeklyTrend,

      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        status: o.status,
        totalPrice: Number(o.totalPrice),
        createdAt: o.createdAt.toISOString(),
        itemCount: o._count.items,
      })),

      popularItems: popularItemsRaw.map((item) => ({
        name: item.menuItemName,
        totalQty: item._sum.qty || 0,
        orderCount: item._count.orderId,
      })),

      satisfaction: {
        averageRating: satisfactionAgg._avg.rating
          ? Math.round(satisfactionAgg._avg.rating * 10) / 10
          : null,
        totalSurveys: satisfactionAgg._count,
        complaintCount,
      },
    };

    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { code: 'DASHBOARD_ERROR', message: error.message },
    });
  }
});

export const dashboardRouter = router;
