import { Router, Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@whatres/shared';
import { requireAuth } from '../middleware/auth.middleware';
import { highfiveIntegrationService } from '../services/highfive-integration.service';
import prisma from '../db/prisma';
import { createLogger } from '../logger';

const router = Router();
const logger = createLogger();

/**
 * GET /integrations/highfive
 * Get HighFive integration settings
 */
router.get(
  '/highfive',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: {
          highfiveApiUrl: true,
          highfiveApiKey: true,
          highfiveLocationId: true,
          highfiveWebhookSecret: true,
          highfiveLastMenuSync: true,
          highfiveMenuHash: true,
        },
      });

      res.json({
        success: true,
        data: {
          apiUrl: tenant?.highfiveApiUrl || null,
          apiKey: tenant?.highfiveApiKey ? '***' + tenant.highfiveApiKey.slice(-6) : null,
          locationId: tenant?.highfiveLocationId || null,
          webhookSecret: tenant?.highfiveWebhookSecret ? '***configured***' : null,
          lastMenuSync: tenant?.highfiveLastMenuSync?.toISOString() || null,
          menuHash: tenant?.highfiveMenuHash || null,
          isConfigured: !!(tenant?.highfiveApiUrl && tenant?.highfiveApiKey),
          webhookUrl: `${process.env.APP_BASE_URL || 'https://posfixmenu.com'}${process.env.API_PREFIX || '/api'}/webhooks/highfive/${req.tenantId}`,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /integrations/highfive
 * Update HighFive integration settings
 */
router.put(
  '/highfive',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { apiUrl, apiKey, locationId, webhookSecret } = req.body;

      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: {
          highfiveApiUrl: apiUrl || null,
          highfiveApiKey: apiKey || null,
          highfiveLocationId: locationId || null,
          highfiveWebhookSecret: webhookSecret || null,
        },
      });

      logger.info({ tenantId: req.tenantId }, 'HighFive entegrasyon ayarları güncellendi');

      res.json({ success: true, data: { message: 'Ayarlar kaydedildi' } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /integrations/highfive/test
 * Test HighFive connection
 */
router.post(
  '/highfive/test',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
      });

      if (!tenant?.highfiveApiUrl || !tenant?.highfiveApiKey) {
        return res.json({
          success: false,
          error: { code: 'NOT_CONFIGURED', message: 'HighFive API ayarları yapılandırılmamış' },
        });
      }

      const apiUrl = tenant.highfiveApiUrl.replace(/\/$/, '');

      const response = await fetch(`${apiUrl}/api/external/menu/hash`, {
        headers: {
          'X-API-Key': tenant.highfiveApiKey,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json();
        res.json({
          success: true,
          data: {
            connected: true,
            menuHash: data.hash,
            lastUpdated: data.lastUpdated,
          },
        });
      } else {
        res.json({
          success: false,
          error: {
            code: 'CONNECTION_FAILED',
            message: `HighFive API yanıt verdi ama hata döndü: ${response.status}`,
          },
        });
      }
    } catch (error: any) {
      res.json({
        success: false,
        error: {
          code: 'CONNECTION_ERROR',
          message: `HighFive API'ye bağlanılamadı: ${error.message}`,
        },
      });
    }
  },
);

/**
 * POST /integrations/highfive/sync-menu
 * Sync menu from HighFive
 */
router.post(
  '/highfive/sync-menu',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const result = await highfiveIntegrationService.pullMenu(req.tenantId!);

      res.json({
        success: true,
        data: {
          message: 'Menü senkronizasyonu tamamlandı',
          ...result,
        },
      });
    } catch (error: any) {
      logger.error({ tenantId: req.tenantId, error: error.message }, 'Menü senkronizasyonu hatası');
      res.json({
        success: false,
        error: { code: 'SYNC_FAILED', message: error.message },
      });
    }
  },
);

/**
 * GET /integrations/highfive/menu-changed
 * Check if HighFive menu has changed
 */
router.get(
  '/highfive/menu-changed',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const changed = await highfiveIntegrationService.checkMenuChanged(req.tenantId!);
      res.json({ success: true, data: { changed } });
    } catch (error) {
      next(error);
    }
  },
);

export const integrationRouter = router;
