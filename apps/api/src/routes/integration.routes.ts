import { Router, Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@whatres/shared';
import { requireAuth } from '../middleware/auth.middleware';
import { posIntegrationService } from '../services/pos-integration.service';
import prisma from '../db/prisma';
import { createLogger } from '../logger';

const router = Router();
const logger = createLogger();

/**
 * GET /integrations/pos
 * Get POS integration settings for current tenant
 */
router.get(
  '/pos',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: {
          posApiUrl: true,
          posApiKey: true,
          posLocationId: true,
          posWebhookSecret: true,
          posLastMenuSync: true,
          posMenuHash: true,
        },
      });

      res.json({
        success: true,
        data: {
          apiUrl: tenant?.posApiUrl || null,
          apiKey: tenant?.posApiKey ? '***' + tenant.posApiKey.slice(-6) : null,
          locationId: tenant?.posLocationId || null,
          webhookSecret: tenant?.posWebhookSecret ? '***configured***' : null,
          lastMenuSync: tenant?.posLastMenuSync?.toISOString() || null,
          menuHash: tenant?.posMenuHash || null,
          isConfigured: !!(tenant?.posApiUrl && tenant?.posApiKey),
          webhookUrl: `${process.env.APP_BASE_URL || 'https://posfixmenu.com'}${process.env.API_PREFIX || '/api'}/webhooks/pos/${req.tenantId}`,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /integrations/pos
 * Update POS integration settings for current tenant
 */
router.put(
  '/pos',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { apiUrl, apiKey, locationId, webhookSecret } = req.body;

      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: {
          posApiUrl: apiUrl || null,
          posApiKey: apiKey || null,
          posLocationId: locationId || null,
          posWebhookSecret: webhookSecret || null,
        },
      });

      logger.info({ tenantId: req.tenantId }, 'POS entegrasyon ayarları güncellendi');

      res.json({ success: true, data: { message: 'Ayarlar kaydedildi' } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /integrations/pos/test
 * Test POS connection for current tenant
 */
router.post(
  '/pos/test',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
      });

      if (!tenant?.posApiUrl || !tenant?.posApiKey) {
        return res.json({
          success: false,
          error: { code: 'NOT_CONFIGURED', message: 'POS API ayarları yapılandırılmamış' },
        });
      }

      const apiUrl = tenant.posApiUrl.replace(/\/$/, '');

      const response = await fetch(`${apiUrl}/api/external/menu/hash`, {
        headers: {
          'X-API-Key': tenant.posApiKey,
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
            message: `POS API yanıt verdi ama hata döndü: ${response.status}`,
          },
        });
      }
    } catch (error: any) {
      res.json({
        success: false,
        error: {
          code: 'CONNECTION_ERROR',
          message: `POS API'ye bağlanılamadı: ${error.message}`,
        },
      });
    }
  },
);

/**
 * POST /integrations/pos/sync-menu
 * Sync menu from POS for current tenant
 */
router.post(
  '/pos/sync-menu',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const result = await posIntegrationService.pullMenu(req.tenantId!);

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
 * GET /integrations/pos/menu-changed
 * Check if POS menu has changed since last sync
 */
router.get(
  '/pos/menu-changed',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const changed = await posIntegrationService.checkMenuChanged(req.tenantId!);
      res.json({ success: true, data: { changed } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /integrations/pickup-discount
 * Get pickup discount percent for current tenant
 */
router.get(
  '/pickup-discount',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { pickupDiscountPercent: true },
      });

      res.json({
        success: true,
        data: { pickupDiscountPercent: tenant?.pickupDiscountPercent || 0 },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /integrations/pickup-discount
 * Update pickup discount percent for current tenant
 */
router.put(
  '/pickup-discount',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { pickupDiscountPercent } = req.body;
      const percent = Math.max(0, Math.min(100, parseInt(pickupDiscountPercent) || 0));

      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: { pickupDiscountPercent: percent || null },
      });

      logger.info({ tenantId: req.tenantId, pickupDiscountPercent: percent }, 'Gel al indirim oranı güncellendi');

      res.json({ success: true, data: { pickupDiscountPercent: percent } });
    } catch (error) {
      next(error);
    }
  },
);

export const integrationRouter = router;
