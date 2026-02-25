import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  ApiResponse,
  WhatsAppConfigDto,
  WhatsAppTestConnectionDto,
} from '@whatres/shared';
import { whatsappConfigService } from '../services/whatsapp-config.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();

// All routes require OWNER or ADMIN
router.use(requireAuth);
router.use(requireRole(['OWNER', 'ADMIN']));

const upsertConfigSchema = z.object({
  phoneNumberId: z.string().min(1, 'Phone Number ID is required'),
  wabaId: z.string().min(1, 'WABA ID is required'),
  accessToken: z.string().min(1, 'Access Token is required'),
  appSecret: z.string().min(1, 'App Secret is required'),
});

/** GET /whatsapp-config - Get tenant WhatsApp config */
router.get(
  '/',
  async (req: Request, res: Response<ApiResponse<WhatsAppConfigDto | null>>, next: NextFunction) => {
    try {
      const config = await whatsappConfigService.getConfig(req.tenantId!);
      res.json({ success: true, data: config });
    } catch (error) {
      next(error);
    }
  }
);

/** PUT /whatsapp-config - Create or update config */
router.put(
  '/',
  async (req: Request, res: Response<ApiResponse<WhatsAppConfigDto>>, next: NextFunction) => {
    try {
      const validation = upsertConfigSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const config = await whatsappConfigService.upsertConfig(
        req.tenantId!,
        validation.data
      );
      res.json({ success: true, data: config });
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /whatsapp-config - Disconnect */
router.delete(
  '/',
  async (req: Request, res: Response<ApiResponse<null>>, next: NextFunction) => {
    try {
      await whatsappConfigService.deleteConfig(req.tenantId!);
      res.json({ success: true, data: null });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /whatsapp-config/test - Test connection */
router.post(
  '/test',
  async (req: Request, res: Response<ApiResponse<WhatsAppTestConnectionDto>>, next: NextFunction) => {
    try {
      const result = await whatsappConfigService.testConnection(req.tenantId!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

export const whatsappConfigRouter = router;
