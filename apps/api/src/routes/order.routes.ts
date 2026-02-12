import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse, OrderDto, PrintJobDto } from '@whatres/shared';
import { orderService } from '../services/order.service';
import { printJobService } from '../services/print-job.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();

router.use(requireAuth);
router.use(requireRole(['OWNER', 'ADMIN', 'AGENT']));

// Validation schemas
const orderQuerySchema = z.object({
  status: z
    .enum(['DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'])
    .optional(),
  conversationId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const confirmOrderSchema = z.object({
  deliveryAddress: z.string().optional(),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum([
    'DRAFT',
    'PENDING_CONFIRMATION',
    'CONFIRMED',
    'PREPARING',
    'READY',
    'DELIVERED',
    'CANCELLED',
  ]),
});

const reprintSchema = z.object({
  type: z.enum(['KITCHEN', 'COURIER']),
});

/**
 * GET /orders
 * List orders
 */
router.get(
  '/',
  async (req: Request, res: Response<ApiResponse<{ orders: OrderDto[]; total: number }>>, next: NextFunction) => {
    try {
      const validation = orderQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid query', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const result = await orderService.getOrders(req.tenantId!, validation.data);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /orders/:id
 * Get single order
 */
router.get(
  '/:id',
  async (req: Request, res: Response<ApiResponse<OrderDto>>, next: NextFunction) => {
    try {
      const order = await orderService.getOrder(req.tenantId!, req.params.id);
      res.json({ success: true, data: order });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /orders/:id/confirm
 * Confirm order and create print jobs
 */
router.post(
  '/:id/confirm',
  async (req: Request, res: Response<ApiResponse<OrderDto>>, next: NextFunction) => {
    try {
      const validation = confirmOrderSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const order = await orderService.confirmOrder(req.tenantId!, req.params.id, validation.data);
      res.json({ success: true, data: order, message: 'Order confirmed' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /orders/:id/status
 * Update order status
 */
router.patch(
  '/:id/status',
  async (req: Request, res: Response<ApiResponse<OrderDto>>, next: NextFunction) => {
    try {
      const validation = updateStatusSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const order = await orderService.updateOrderStatus(
        req.tenantId!,
        req.params.id,
        validation.data.status
      );
      res.json({ success: true, data: order });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /orders/:id/reprint
 * Create reprint job
 */
router.post(
  '/:id/reprint',
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      const validation = reprintSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      await orderService.reprintOrder(req.tenantId!, req.params.id, validation.data.type);
      res.json({ success: true, message: 'Reprint job created' });
    } catch (error) {
      next(error);
    }
  }
);

export const orderRouter = router;


