import jwt from 'jsonwebtoken';
import prisma from '../db/prisma';
import { getConfig } from '@whatres/config';
import { AppError } from '../middleware/error-handler';
import { createLogger } from '../logger';
import { PLAN_DEFINITIONS, SubscriptionPlan, BillingCycle } from '@whatres/shared';

const logger = createLogger();

/**
 * Payload embedded in the super-admin JWT. Deliberately distinct from the
 * tenant JwtPayload (which carries tenantId/role) — an admin token has no
 * tenant scope and grants cross-tenant read/management access.
 */
export interface AdminJwtPayload {
  sub: 'super-admin';
  email: string;
  scope: 'SUPER_ADMIN';
}

/**
 * Super-admin service backing manager.superpersonel.com.
 *
 * Auth is a single fixed account from env (ADMIN_EMAIL / ADMIN_PASSWORD),
 * fully isolated from tenant users. All data methods are CROSS-TENANT — they
 * intentionally do NOT filter by tenantId. Only reachable behind
 * requireSuperAdmin middleware.
 */
export class AdminService {
  private get jwtSecret(): string {
    return getConfig().jwt.secret;
  }

  // ==================== AUTH ====================

  login(email: string, password: string): { token: string; email: string } {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      throw new AppError(503, 'ADMIN_NOT_CONFIGURED', 'Yönetici hesabı yapılandırılmamış.');
    }

    const emailOk = email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
    const passOk = password === adminPassword;
    if (!emailOk || !passOk) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-posta veya şifre hatalı.');
    }

    const payload: AdminJwtPayload = { sub: 'super-admin', email: adminEmail, scope: 'SUPER_ADMIN' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (jwt.sign as any)(payload, this.jwtSecret, { expiresIn: '12h', algorithm: 'HS256' });
    logger.info({ email: adminEmail }, 'Super-admin logged in');
    return { token, email: adminEmail };
  }

  verifyToken(token: string): AdminJwtPayload {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as AdminJwtPayload;
      if (decoded.scope !== 'SUPER_ADMIN') {
        throw new AppError(401, 'INVALID_TOKEN', 'Geçersiz yönetici oturumu.');
      }
      return decoded;
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'Geçersiz veya süresi dolmuş oturum.');
    }
  }

  // ==================== DASHBOARD STATS ====================

  async getStats(): Promise<{
    totalTenants: number;
    activeSubscriptions: number;
    trialCount: number;
    expiredCount: number;
    totalUsers: number;
    mrr: number; // monthly recurring revenue (TRY)
    totalRevenue: number; // sum of successful transactions (TRY)
  }> {
    const [totalTenants, totalUsers, subs, successTx] = await Promise.all([
      prisma.tenant.count(),
      prisma.user.count(),
      prisma.subscription.findMany({
        select: { plan: true, status: true, billingCycle: true },
      }),
      prisma.billingTransaction.findMany({
        where: { status: 'SUCCESS' },
        select: { amount: true },
      }),
    ]);

    let activeSubscriptions = 0;
    let trialCount = 0;
    let expiredCount = 0;
    let mrr = 0;
    for (const s of subs) {
      if (s.status === 'ACTIVE') activeSubscriptions++;
      if (s.plan === 'TRIAL') trialCount++;
      if (s.status === 'EXPIRED') expiredCount++;
      // MRR: only active, non-trial paid plans
      if (s.status === 'ACTIVE' && s.plan !== 'TRIAL') {
        const def = PLAN_DEFINITIONS[s.plan as SubscriptionPlan];
        if (def) {
          mrr += s.billingCycle === 'ANNUAL'
            ? Math.round(def.annualPrice / 12)
            : def.monthlyPrice;
        }
      }
    }

    const totalRevenue = successTx.reduce((sum, t) => sum + Number(t.amount), 0);

    return { totalTenants, activeSubscriptions, trialCount, expiredCount, totalUsers, mrr, totalRevenue };
  }

  // ==================== TENANTS ====================

  async listTenants(search?: string): Promise<any[]> {
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { slug: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const tenants = await prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: true,
        _count: { select: { memberships: true, orders: true, stores: true } },
      },
    });

    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      createdAt: t.createdAt.toISOString(),
      userCount: t._count.memberships,
      orderCount: t._count.orders,
      storeCount: t._count.stores,
      subscription: t.subscription
        ? {
            plan: t.subscription.plan,
            status: t.subscription.status,
            billingCycle: t.subscription.billingCycle,
            currentPeriodEnd: t.subscription.currentPeriodEnd?.toISOString() || null,
            ordersUsed: t.subscription.ordersUsed,
            monthlyOrderLimit: t.subscription.monthlyOrderLimit,
          }
        : null,
    }));
  }

  async getTenant(tenantId: string): Promise<any> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscription: true,
        memberships: { include: { user: { select: { id: true, name: true, email: true, phone: true, createdAt: true } } } },
        _count: { select: { orders: true, stores: true, conversations: true } },
      },
    });
    if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'İşletme bulunamadı.');

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      createdAt: tenant.createdAt.toISOString(),
      counts: {
        orders: tenant._count.orders,
        stores: tenant._count.stores,
        conversations: tenant._count.conversations,
      },
      subscription: tenant.subscription
        ? {
            plan: tenant.subscription.plan,
            status: tenant.subscription.status,
            billingCycle: tenant.subscription.billingCycle,
            currentPeriodStart: tenant.subscription.currentPeriodStart?.toISOString() || null,
            currentPeriodEnd: tenant.subscription.currentPeriodEnd?.toISOString() || null,
            trialEndsAt: tenant.subscription.trialEndsAt?.toISOString() || null,
            ordersUsed: tenant.subscription.ordersUsed,
            messagesUsed: tenant.subscription.messagesUsed,
            monthlyOrderLimit: tenant.subscription.monthlyOrderLimit,
            monthlyMessageLimit: tenant.subscription.monthlyMessageLimit,
            maxStores: tenant.subscription.maxStores,
            iyzicoSubscriptionRef: tenant.subscription.iyzicoSubscriptionRef,
          }
        : null,
      members: tenant.memberships.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        role: m.role,
        joinedAt: m.user.createdAt.toISOString(),
      })),
    };
  }

  async getTenantTransactions(tenantId: string): Promise<any[]> {
    const txs = await prisma.billingTransaction.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return txs.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      amount: Number(t.amount),
      currency: t.currency,
      plan: t.plan,
      billingCycle: t.billingCycle,
      errorMessage: t.errorMessage,
      createdAt: t.createdAt.toISOString(),
      processedAt: t.processedAt?.toISOString() || null,
    }));
  }

  // ==================== MANAGEMENT ACTIONS ====================

  /**
   * Manual subscription intervention by an admin.
   * - action 'extend': push currentPeriodEnd forward by N days, set ACTIVE
   * - action 'suspend': set status EXPIRED
   * - action 'activate': set status ACTIVE
   * - action 'change-plan': switch plan + apply that plan's limits
   */
  async manageSubscription(
    tenantId: string,
    action: 'extend' | 'suspend' | 'activate' | 'change-plan',
    params: { days?: number; plan?: SubscriptionPlan; billingCycle?: BillingCycle },
  ): Promise<any> {
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', 'Abonelik bulunamadı.');

    let data: any = {};
    if (action === 'extend') {
      const days = params.days && params.days > 0 ? params.days : 30;
      const base = sub.currentPeriodEnd && sub.currentPeriodEnd > new Date()
        ? new Date(sub.currentPeriodEnd)
        : new Date();
      base.setDate(base.getDate() + days);
      data = { currentPeriodEnd: base, status: 'ACTIVE' };
    } else if (action === 'suspend') {
      data = { status: 'EXPIRED' };
    } else if (action === 'activate') {
      data = { status: 'ACTIVE' };
    } else if (action === 'change-plan') {
      const plan = params.plan;
      const def = plan ? PLAN_DEFINITIONS[plan] : undefined;
      if (!plan || !def) throw new AppError(400, 'INVALID_PLAN', 'Geçersiz plan.');
      data = {
        plan,
        billingCycle: params.billingCycle || sub.billingCycle,
        monthlyOrderLimit: def.features.monthlyOrderLimit,
        monthlyMessageLimit: def.features.monthlyMessageLimit,
        maxStores: def.features.maxStores,
        maxUsers: def.features.maxUsers,
      };
    }

    const updated = await prisma.subscription.update({ where: { tenantId }, data });
    logger.warn({ tenantId, action, params }, 'Admin subscription intervention');
    return {
      plan: updated.plan,
      status: updated.status,
      currentPeriodEnd: updated.currentPeriodEnd?.toISOString() || null,
    };
  }
}

export const adminService = new AdminService();
