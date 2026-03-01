import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@whatres/shared';
import { surveyService, SurveyDto, ComplaintWithMessages } from '../services/survey.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();

router.use(requireAuth);
router.use(requireRole(['OWNER', 'ADMIN', 'AGENT']));

/**
 * GET /surveys/complaints
 * List complaints (low-rated surveys) with conversation messages
 */
const complaintsQuerySchema = z.object({
  resolved: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

router.get(
  '/complaints',
  async (
    req: Request,
    res: Response<ApiResponse<{ complaints: ComplaintWithMessages[]; total: number }>>,
    next: NextFunction,
  ) => {
    try {
      const validation = complaintsQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid query', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const resolved = validation.data.resolved === 'true'
        ? true
        : validation.data.resolved === 'false'
          ? false
          : undefined;

      const result = await surveyService.getComplaints(req.tenantId!, {
        resolved,
        limit: validation.data.limit,
        offset: validation.data.offset,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /surveys/stats
 * Get survey statistics
 */
router.get(
  '/stats',
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const stats = await surveyService.getStats(req.tenantId!);
      res.json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /surveys
 * List all surveys
 */
const surveysQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

router.get(
  '/',
  async (
    req: Request,
    res: Response<ApiResponse<{ surveys: SurveyDto[]; total: number }>>,
    next: NextFunction,
  ) => {
    try {
      const validation = surveysQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid query', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const result = await surveyService.getSurveys(req.tenantId!, validation.data);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /surveys/:id/resolve
 * Resolve a complaint
 */
const resolveSchema = z.object({
  note: z.string().min(1).max(1000),
});

router.post(
  '/:id/resolve',
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      const validation = resolveSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      await surveyService.resolveComplaint(
        req.tenantId!,
        req.params.id,
        req.user!.sub,
        validation.data.note,
      );

      res.json({ success: true, message: 'Complaint resolved' });
    } catch (error) {
      next(error);
    }
  },
);

export const surveyRouter = router;
