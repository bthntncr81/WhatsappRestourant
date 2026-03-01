import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@whatres/shared';
import { broadcastService } from '../services/broadcast.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();

router.use(requireAuth);
router.use(requireRole(['OWNER', 'ADMIN']));

// ==================== SETTINGS ====================

router.get(
  '/settings',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const settings = await broadcastService.getSettings(req.tenantId!);
      res.json({ success: true, data: settings });
    } catch (error) {
      next(error);
    }
  },
);

const updateSettingsSchema = z.object({
  isEnabled: z.boolean().optional(),
  maxDiscountPct: z.number().min(0).max(100).optional(),
  minDaysBetweenSends: z.number().min(1).max(30).optional(),
  dailySendLimit: z.number().min(1).max(10000).optional(),
  activeThresholdDays: z.number().min(1).max(365).optional(),
  sleepingThresholdDays: z.number().min(1).max(365).optional(),
});

router.put(
  '/settings',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const validation = updateSettingsSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid settings', {
          errors: validation.error.flatten().fieldErrors,
        });
      }
      const settings = await broadcastService.updateSettings(req.tenantId!, validation.data);
      res.json({ success: true, data: settings });
    } catch (error) {
      next(error);
    }
  },
);

// ==================== CUSTOMER PROFILES ====================

const customersQuerySchema = z.object({
  segment: z.enum(['ACTIVE', 'SLEEPING', 'NEW']).optional(),
  optIn: z.enum(['PENDING', 'OPTED_IN', 'OPTED_OUT']).optional(),
  limit: z.coerce.number().min(1).max(1000).optional(),
  offset: z.coerce.number().min(0).optional(),
});

router.get(
  '/customers',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const validation = customersQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid query', {
          errors: validation.error.flatten().fieldErrors,
        });
      }
      const result = await broadcastService.getCustomerProfiles(req.tenantId!, validation.data);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/customers/sync',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const result = await broadcastService.syncCustomerProfiles(req.tenantId!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

// ==================== CUSTOMER DETAIL ====================

router.get(
  '/customers/:id/favorites',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const favorites = await broadcastService.getCustomerFavorites(req.tenantId!, req.params.id);
      res.json({ success: true, data: favorites });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/customers/:id/orders',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const orders = await broadcastService.getCustomerOrders(req.tenantId!, req.params.id);
      res.json({ success: true, data: orders });
    } catch (error) {
      next(error);
    }
  },
);

// ==================== CAMPAIGNS ====================

router.get(
  '/campaigns',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const campaigns = await broadcastService.getCampaigns(req.tenantId!);
      res.json({ success: true, data: campaigns });
    } catch (error) {
      next(error);
    }
  },
);

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  targetSegments: z.array(z.enum(['ACTIVE', 'SLEEPING', 'NEW'])).min(1),
  maxDiscountPct: z.number().min(0).max(100),
  usePersonalTime: z.boolean(),
  scheduledAt: z.string().optional(),
});

router.post(
  '/campaigns',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const validation = createCampaignSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid campaign data', {
          errors: validation.error.flatten().fieldErrors,
        });
      }
      const campaign = await broadcastService.createCampaign(req.tenantId!, validation.data);
      res.json({ success: true, data: campaign });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/campaigns/:id',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const campaign = await broadcastService.getCampaign(req.tenantId!, req.params.id);
      if (!campaign) {
        throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
      }
      res.json({ success: true, data: campaign });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/campaigns/:id/schedule',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const result = await broadcastService.scheduleCampaign(req.tenantId!, req.params.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/campaigns/:id/cancel',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const result = await broadcastService.cancelCampaign(req.tenantId!, req.params.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/campaigns/:id/logs',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const logs = await broadcastService.getCampaignLogs(req.tenantId!, req.params.id);
      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  },
);

// ==================== STATS ====================

router.get(
  '/stats',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const stats = await broadcastService.getStats(req.tenantId!);
      res.json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  },
);

export const broadcastRouter = router;
