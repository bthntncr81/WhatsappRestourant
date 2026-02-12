import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  ApiResponse,
  StoreDto,
  DeliveryRuleDto,
  GeoCheckResult,
} from '@whatres/shared';
import { storeService } from '../services/store.service';
import { geoService } from '../services/geo.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();

router.use(requireAuth);

// Validation schemas
const createStoreSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  phone: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
});

const updateStoreSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  address: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  phone: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
});

const createDeliveryRuleSchema = z.object({
  storeId: z.string().cuid(),
  radiusKm: z.number().min(0.1).max(100),
  minBasket: z.number().min(0),
  deliveryFee: z.number().min(0),
  isActive: z.boolean().optional(),
});

const updateDeliveryRuleSchema = z.object({
  radiusKm: z.number().min(0.1).max(100).optional(),
  minBasket: z.number().min(0).optional(),
  deliveryFee: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

const geoCheckSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// ==================== STORES ====================

/**
 * GET /stores
 * List all stores
 */
router.get(
  '/',
  async (req: Request, res: Response<ApiResponse<StoreDto[]>>, next: NextFunction) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const stores = await storeService.getStores(req.tenantId!, includeInactive);
      res.json({ success: true, data: stores });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /stores/:id
 * Get single store
 */
router.get(
  '/:id',
  async (req: Request, res: Response<ApiResponse<StoreDto>>, next: NextFunction) => {
    try {
      const store = await storeService.getStore(req.tenantId!, req.params.id);
      res.json({ success: true, data: store });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /stores
 * Create store (ADMIN only)
 */
router.post(
  '/',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<StoreDto>>, next: NextFunction) => {
    try {
      const validation = createStoreSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const store = await storeService.createStore(req.tenantId!, validation.data);
      res.status(201).json({ success: true, data: store, message: 'Store created' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /stores/:id
 * Update store (ADMIN only)
 */
router.patch(
  '/:id',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<StoreDto>>, next: NextFunction) => {
    try {
      const validation = updateStoreSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const store = await storeService.updateStore(
        req.tenantId!,
        req.params.id,
        validation.data
      );
      res.json({ success: true, data: store });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /stores/:id
 * Delete store (ADMIN only)
 */
router.delete(
  '/:id',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await storeService.deleteStore(req.tenantId!, req.params.id);
      res.json({ success: true, message: 'Store deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== DELIVERY RULES ====================

/**
 * GET /stores/delivery-rules
 * List all delivery rules
 */
router.get(
  '/delivery-rules/list',
  async (req: Request, res: Response<ApiResponse<DeliveryRuleDto[]>>, next: NextFunction) => {
    try {
      const storeId = req.query.storeId as string | undefined;
      const rules = await storeService.getDeliveryRules(req.tenantId!, storeId);
      res.json({ success: true, data: rules });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /stores/delivery-rules/:id
 * Get single delivery rule
 */
router.get(
  '/delivery-rules/:id',
  async (req: Request, res: Response<ApiResponse<DeliveryRuleDto>>, next: NextFunction) => {
    try {
      const rule = await storeService.getDeliveryRule(req.tenantId!, req.params.id);
      res.json({ success: true, data: rule });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /stores/delivery-rules
 * Create delivery rule (ADMIN only)
 */
router.post(
  '/delivery-rules',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<DeliveryRuleDto>>, next: NextFunction) => {
    try {
      const validation = createDeliveryRuleSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const rule = await storeService.createDeliveryRule(req.tenantId!, validation.data);
      res.status(201).json({ success: true, data: rule, message: 'Delivery rule created' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /stores/delivery-rules/:id
 * Update delivery rule (ADMIN only)
 */
router.patch(
  '/delivery-rules/:id',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<DeliveryRuleDto>>, next: NextFunction) => {
    try {
      const validation = updateDeliveryRuleSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const rule = await storeService.updateDeliveryRule(
        req.tenantId!,
        req.params.id,
        validation.data
      );
      res.json({ success: true, data: rule });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /stores/delivery-rules/:id
 * Delete delivery rule (ADMIN only)
 */
router.delete(
  '/delivery-rules/:id',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await storeService.deleteDeliveryRule(req.tenantId!, req.params.id);
      res.json({ success: true, message: 'Delivery rule deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== GEO CHECK ====================

/**
 * POST /stores/check-service-area
 * Check if a location is within service area
 */
router.post(
  '/check-service-area',
  async (req: Request, res: Response<ApiResponse<GeoCheckResult>>, next: NextFunction) => {
    try {
      const validation = geoCheckSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const result = await geoService.checkServiceArea(req.tenantId!, {
        lat: validation.data.lat,
        lng: validation.data.lng,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

export const storeRouter = router;


