import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse, AuthResponseDto, MeResponseDto } from '@whatres/shared';
import { authService } from '../services/auth.service';
import { requireAuth } from '../middleware/auth.middleware';
import { authRateLimiter } from '../middleware/rate-limit.middleware';
import { AppError } from '../middleware/error-handler';
import prisma from '../db/prisma';
import { CONSENT_TYPES, LEGAL_VERSION, LEGAL_TEXTS } from '../services/legal-texts';
import { createLogger } from '../logger';

const logger = createLogger();
const router = Router();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Geçersiz e-posta formatı'),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı'),
  name: z.string().min(2, 'Ad en az 2 karakter olmalı'),
  tenantName: z.string().min(2, 'İşletme adı en az 2 karakter olmalı'),
  tenantSlug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug küçük harf, rakam ve tire içermeli'),
  consents: z.object({
    terms: z.literal(true, { errorMap: () => ({ message: 'Mesafeli Satış Sözleşmesi kabul edilmeli' }) }),
    kvkk: z.literal(true, { errorMap: () => ({ message: 'KVKK Aydınlatma Metni kabul edilmeli' }) }),
    explicitConsent: z.literal(true, { errorMap: () => ({ message: 'Açık rıza beyanı kabul edilmeli' }) }),
    dpa: z.literal(true, { errorMap: () => ({ message: 'Veri İşleme Sözleşmesi kabul edilmeli' }) }),
  }),
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
        const firstError = validation.error.issues[0];
        throw new AppError(400, 'VALIDATION_ERROR', firstError?.message || 'Geçersiz bilgiler', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const result = await authService.register(validation.data);

      // Log all 4 consent acceptances with IP + user-agent
      const ipAddress = req.headers['x-forwarded-for'] as string || req.ip || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      const consentEntries = [
        { consentType: CONSENT_TYPES.TERMS },
        { consentType: CONSENT_TYPES.KVKK },
        { consentType: CONSENT_TYPES.EXPLICIT_CONSENT },
        { consentType: CONSENT_TYPES.DPA },
      ];

      await prisma.consentLog.createMany({
        data: consentEntries.map((entry) => ({
          tenantId: result.tenant.id,
          userId: result.user.id,
          consentType: entry.consentType,
          version: LEGAL_VERSION,
          ipAddress,
          userAgent,
        })),
      });

      logger.info(
        { userId: result.user.id, tenantId: result.tenant.id, ip: ipAddress, consents: consentEntries.map((e) => e.consentType) },
        'User registered with all legal consents accepted',
      );

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
 * GET /auth/legal-texts
 * Returns all legal document texts for the registration modal display
 */
router.get('/legal-texts', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      version: LEGAL_VERSION,
      documents: Object.entries(LEGAL_TEXTS).map(([key, val]) => ({
        type: key,
        title: val.title,
        content: val.content,
      })),
    },
  });
});

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


