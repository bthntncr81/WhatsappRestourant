import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse, AuthResponseDto, MeResponseDto } from '@whatres/shared';
import { authService } from '../services/auth.service';
import { requireAuth } from '../middleware/auth.middleware';
import { authRateLimiter } from '../middleware/rate-limit.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  tenantName: z.string().min(2, 'Tenant name must be at least 2 characters'),
  tenantSlug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * POST /auth/register
 * Register a new tenant with owner user
 */
router.post(
  '/register',
  authRateLimiter,
  async (req: Request, res: Response<ApiResponse<AuthResponseDto>>, next: NextFunction) => {
    try {
      const validation = registerSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid input', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const result = await authService.register(validation.data);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /auth/login
 * Login with email and password
 */
router.post(
  '/login',
  authRateLimiter,
  async (req: Request, res: Response<ApiResponse<AuthResponseDto>>, next: NextFunction) => {
    try {
      const validation = loginSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid input', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const tenantId = req.headers['x-tenant-id'] as string | undefined;
      const result = await authService.login(validation.data, tenantId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /auth/me
 * Get current user info
 */
router.get(
  '/me',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<MeResponseDto>>, next: NextFunction) => {
    try {
      if (!req.user || !req.tenantId) {
        throw new AppError(401, 'NOT_AUTHENTICATED', 'Authentication required');
      }

      const result = await authService.getMe(req.user.sub, req.tenantId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

export const authRouter = router;


