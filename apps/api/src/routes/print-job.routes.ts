import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse, PrintJobDto } from '@whatres/shared';
import { printJobService } from '../services/print-job.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();

router.use(requireAuth);

// Validation schemas
const jobQuerySchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'DONE', 'FAILED']).optional(),
  orderId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const completeSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

/**
 * GET /print-jobs/pending
 * Get pending print jobs for print-bridge
 */
router.get(
  '/pending',
  async (req: Request, res: Response<ApiResponse<PrintJobDto[]>>, next: NextFunction) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const jobs = await printJobService.getPendingJobs(req.tenantId!, limit);
      res.json({ success: true, data: jobs });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /print-jobs
 * List all print jobs (admin)
 */
router.get(
  '/',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<{ jobs: PrintJobDto[]; total: number }>>, next: NextFunction) => {
    try {
      const validation = jobQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid query', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const result = await printJobService.getJobs(req.tenantId!, validation.data);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /print-jobs/:id
 * Get single print job
 */
router.get(
  '/:id',
  async (req: Request, res: Response<ApiResponse<PrintJobDto>>, next: NextFunction) => {
    try {
      const job = await printJobService.getJob(req.tenantId!, req.params.id);
      res.json({ success: true, data: job });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /print-jobs/:id/claim
 * Claim job for processing
 */
router.post(
  '/:id/claim',
  async (req: Request, res: Response<ApiResponse<PrintJobDto>>, next: NextFunction) => {
    try {
      const job = await printJobService.claimJob(req.tenantId!, req.params.id);
      res.json({ success: true, data: job });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /print-jobs/:id/complete
 * Complete or fail a job
 */
router.post(
  '/:id/complete',
  async (req: Request, res: Response<ApiResponse<PrintJobDto>>, next: NextFunction) => {
    try {
      const validation = completeSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const job = await printJobService.completeJob(
        req.tenantId!,
        req.params.id,
        validation.data.success,
        validation.data.errorMessage
      );
      res.json({ success: true, data: job });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /print-jobs/:id/retry
 * Retry a failed job
 */
router.post(
  '/:id/retry',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<PrintJobDto>>, next: NextFunction) => {
    try {
      const job = await printJobService.retryJob(req.tenantId!, req.params.id);
      res.json({ success: true, data: job });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /print-jobs/:id/cancel
 * Cancel a pending or processing job
 */
router.post(
  '/:id/cancel',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<PrintJobDto>>, next: NextFunction) => {
    try {
      const job = await printJobService.cancelJob(req.tenantId!, req.params.id);
      res.json({ success: true, data: job });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /print-jobs/:id
 * Delete a print job
 */
router.delete(
  '/:id',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await printJobService.deleteJob(req.tenantId!, req.params.id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

export const printJobRouter = router;

