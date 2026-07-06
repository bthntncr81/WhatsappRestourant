import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { adminService } from '../services/admin.service';
import { requireSuperAdmin } from '../middleware/admin-auth.middleware';
import { ApiResponse } from '@whatres/shared';

const router = Router();

// ==================== PUBLIC: ADMIN LOGIN ====================

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

/**
 * POST /api/admin/login
 * Super-admin login (env ADMIN_EMAIL / ADMIN_PASSWORD). No tenant scope.
 */
router.post('/login', async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'E-posta ve şifre gerekli.' } });
  }
  try {
    const result = adminService.login(parsed.data.email, parsed.data.password);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// ==================== PROTECTED: SUPER ADMIN ONLY ====================

router.use(requireSuperAdmin);

router.get('/stats', async (_req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
  try {
    res.json({ success: true, data: await adminService.getStats() });
  } catch (error) {
    next(error);
  }
});

router.get('/tenants', async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
  try {
    const search = (req.query.search as string | undefined)?.trim() || undefined;
    res.json({ success: true, data: { tenants: await adminService.listTenants(search) } });
  } catch (error) {
    next(error);
  }
});

router.get('/tenants/:id', async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
  try {
    res.json({ success: true, data: await adminService.getTenant(req.params.id) });
  } catch (error) {
    next(error);
  }
});

router.get('/tenants/:id/transactions', async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
  try {
    res.json({ success: true, data: { transactions: await adminService.getTenantTransactions(req.params.id) } });
  } catch (error) {
    next(error);
  }
});

const manageSchema = z.object({
  action: z.enum(['extend', 'suspend', 'activate', 'change-plan']),
  days: z.number().int().positive().optional(),
  plan: z.enum(['TRIAL', 'SILVER', 'GOLD', 'PLATINUM', 'TEST']).optional(),
  billingCycle: z.enum(['MONTHLY', 'ANNUAL']).optional(),
});

router.post('/tenants/:id/subscription', async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
  const parsed = manageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Geçersiz işlem.' } });
  }
  try {
    const { action, ...params } = parsed.data;
    const result = await adminService.manageSubscription(req.params.id, action, params as any);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
