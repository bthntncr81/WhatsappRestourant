import { Router, Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@whatres/shared';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';
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
          webhookUrl: `${process.env.APP_BASE_URL || 'https://order.highfivepps.com'}${process.env.API_PREFIX || '/api'}/webhooks/pos/${req.tenantId}`,
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
  requireRole(['OWNER', 'ADMIN']),
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
  requireRole(['OWNER', 'ADMIN']),
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
  requireRole(['OWNER', 'ADMIN']),
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
  requireRole(['OWNER', 'ADMIN']),
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

/**
 * GET /integrations/order-notify-phones
 */
router.get(
  '/order-notify-phones',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { orderNotifyPhones: true },
      });
      res.json({ success: true, data: { phones: tenant?.orderNotifyPhones || [] } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /integrations/order-notify-phones
 */
router.put(
  '/order-notify-phones',
  requireAuth,
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { phones } = req.body;
      if (!Array.isArray(phones)) {
        throw new AppError(400, 'INVALID_INPUT', 'phones must be an array of strings');
      }
      // Normalize phone numbers - ensure 90 prefix for Turkish numbers
      const normalized = phones
        .map((p: string) => {
          let num = p.replace(/\D/g, '');
          if (num.startsWith('0') && num.length === 11) num = '9' + num; // 05xx -> 905xx
          if (num.length === 10 && !num.startsWith('90')) num = '90' + num; // 5xx -> 905xx
          return num;
        })
        .filter((p: string) => p.length >= 12);

      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: { orderNotifyPhones: normalized },
      });
      res.json({ success: true, data: { phones: normalized } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /integrations/working-hours
 */
router.get(
  '/working-hours',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { workingHours: true },
      });
      res.json({ success: true, data: { workingHours: tenant?.workingHours || null } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /integrations/working-hours
 */
router.put(
  '/working-hours',
  requireAuth,
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { workingHours } = req.body;
      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: { workingHours: workingHours || null },
      });
      res.json({ success: true, data: { workingHours } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /integrations/google-maps
 */
router.get(
  '/google-maps',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { googleMapsApiKey: true },
      });
      res.json({ success: true, data: { apiKey: tenant?.googleMapsApiKey || '' } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /integrations/google-maps
 */
router.put(
  '/google-maps',
  requireAuth,
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { apiKey } = req.body;
      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: { googleMapsApiKey: apiKey || null },
      });
      res.json({ success: true, data: { apiKey } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /integrations/iyzico
 */
router.get(
  '/iyzico',
  requireAuth,
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { iyzicoApiKey: true, iyzicoSecretKey: true, iyzicoBaseUrl: true, iyzicoMode: true },
      });
      res.json({
        success: true,
        data: {
          apiKey: tenant?.iyzicoApiKey || '',
          secretKey: tenant?.iyzicoSecretKey ? '***' + tenant.iyzicoSecretKey.slice(-6) : '',
          baseUrl: tenant?.iyzicoBaseUrl || '',
          mode: tenant?.iyzicoMode || 'test',
          isConfigured: !!(tenant?.iyzicoApiKey && tenant?.iyzicoSecretKey),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /integrations/iyzico
 */
router.put(
  '/iyzico',
  requireAuth,
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { apiKey, secretKey, mode } = req.body;
      const baseUrl = mode === 'prod'
        ? 'https://api.iyzipay.com'
        : 'https://sandbox-api.iyzipay.com';

      const data: any = { iyzicoMode: mode || 'test', iyzicoBaseUrl: baseUrl };
      if (apiKey) data.iyzicoApiKey = apiKey;
      if (secretKey && !secretKey.startsWith('***')) data.iyzicoSecretKey = secretKey;

      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data,
      });

      res.json({ success: true, data: { mode: mode || 'test', baseUrl } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /integrations/busy-status
 */
router.get(
  '/busy-status',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { isBusy: true, busyEstimateMinutes: true, busyMessage: true },
      });
      res.json({ success: true, data: tenant });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /integrations/busy-status
 */
router.put(
  '/busy-status',
  requireAuth,
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { isBusy, busyEstimateMinutes, busyMessage } = req.body;
      const updated = await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: {
          isBusy: !!isBusy,
          busyEstimateMinutes: busyEstimateMinutes ? Number(busyEstimateMinutes) : null,
          busyMessage: busyMessage || null,
        },
        select: { isBusy: true, busyEstimateMinutes: true, busyMessage: true },
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  },
);

// ==================== ONBOARDING ====================

router.get(
  '/onboarding',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { onboardingStep: true, onboardingCompletedAt: true },
      });
      res.json({
        success: true,
        data: {
          step: tenant?.onboardingStep ?? 0,
          completed: !!tenant?.onboardingCompletedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/onboarding',
  requireAuth,
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { step, completed } = req.body;
      const data: any = {};
      if (typeof step === 'number' && step >= 0 && step <= 6) {
        data.onboardingStep = step;
      }
      if (completed === true) {
        data.onboardingCompletedAt = new Date();
        data.onboardingStep = 6;
      }
      const tenant = await prisma.tenant.update({
        where: { id: req.tenantId! },
        data,
        select: { onboardingStep: true, onboardingCompletedAt: true },
      });
      res.json({
        success: true,
        data: {
          step: tenant.onboardingStep,
          completed: !!tenant.onboardingCompletedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ==================== AI FEEDBACK (admin only) ====================

router.get(
  '/ai-feedback/conversations',
  requireAuth,
  requireRole(['OWNER']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const date = req.query.date as string || new Date().toISOString().split('T')[0];
      const startOfDay = new Date(date + 'T00:00:00Z');
      const endOfDay = new Date(date + 'T23:59:59Z');

      const conversations = await prisma.conversation.findMany({
        where: {
          tenantId: req.tenantId!,
          messages: { some: { direction: 'OUT', kind: 'TEXT', createdAt: { gte: startOfDay, lte: endOfDay } } },
        },
        select: {
          id: true,
          customerPhone: true,
          customerName: true,
          messages: {
            where: { createdAt: { gte: startOfDay, lte: endOfDay } },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              direction: true,
              kind: true,
              text: true,
              rating: true,
              ratingNote: true,
              createdAt: true,
            },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 50,
      });
      res.json({ success: true, data: conversations });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/ai-feedback/rate/:messageId',
  requireAuth,
  requireRole(['OWNER']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { rating, note } = req.body;
      if (!rating || rating < 1 || rating > 3) {
        throw new AppError(400, 'INVALID_RATING', 'Rating must be 1 (wrong), 2 (partial), or 3 (correct)');
      }
      const updated = await prisma.message.update({
        where: { id: req.params.messageId },
        data: { rating, ratingNote: note || null, ratedAt: new Date() },
        select: { id: true, rating: true, ratingNote: true },
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/ai-feedback/daily-prompt',
  requireAuth,
  requireRole(['OWNER']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const date = req.query.date as string || new Date().toISOString().split('T')[0];
      const startOfDay = new Date(date + 'T00:00:00Z');
      const endOfDay = new Date(date + 'T23:59:59Z');

      const badMessages = await prisma.message.findMany({
        where: {
          tenantId: req.tenantId!,
          direction: 'OUT',
          rating: { in: [1, 2] },
          ratedAt: { gte: startOfDay, lte: endOfDay },
        },
        select: {
          id: true,
          text: true,
          rating: true,
          ratingNote: true,
          conversation: {
            select: {
              messages: {
                where: { createdAt: { gte: startOfDay, lte: endOfDay } },
                orderBy: { createdAt: 'asc' },
                take: 10,
                select: { direction: true, text: true, kind: true },
              },
            },
          },
        },
        take: 30,
      });

      if (badMessages.length === 0) {
        res.json({ success: true, data: { prompt: null, message: 'Bugün kötü puanlı mesaj yok — tebrikler!' } });
        return;
      }

      let prompt = `Aşağıda WhatsApp sipariş botunun bugün (${date}) yanlış veya kısmen doğru cevap verdiği konuşma örnekleri var.\n\n`;
      prompt += `Her birinde müşterinin ne yazdığı, botun ne cevap verdiği ve neden yanlış olduğu belirtilmiş.\n`;
      prompt += `Bu bilgilere dayanarak botun NLU (doğal dil anlama) ve yanıt sistemini iyileştirmek için öneriler sun.\n\n`;
      prompt += `---\n\n`;

      for (const msg of badMessages) {
        const context = msg.conversation.messages
          .map((m: any) => `${m.direction === 'IN' ? 'MÜŞTERİ' : 'BOT'}: ${m.text || `[${m.kind}]`}`)
          .join('\n');

        prompt += `KONUŞMA:\n${context}\n\n`;
        prompt += `YANLIŞ CEVAP: ${msg.text}\n`;
        prompt += `PUAN: ${msg.rating === 1 ? 'YANLIŞ' : 'KISMİ'}\n`;
        if (msg.ratingNote) prompt += `NOT: ${msg.ratingNote}\n`;
        prompt += `\n---\n\n`;
      }

      prompt += `Toplam ${badMessages.length} hatalı cevap var. Bunlara göre:\n`;
      prompt += `1. Hangi tür müşteri mesajları yanlış anlaşılıyor?\n`;
      prompt += `2. Hangi keyword'ler eklenmeli?\n`;
      prompt += `3. NLU prompt'u nasıl iyileştirilebilir?\n`;
      prompt += `4. Conversation flow'da hangi edge case'ler handle edilmeli?\n`;

      res.json({ success: true, data: { prompt, badCount: badMessages.length, date } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /integrations/pos/connect-otorder
 * Tek tikla OtOrder baglantisi: restoran sahibi OtOrder hesabiyla (subdomain +
 * e-posta + sifre) giris yapar; OtOrder tarafinda IntegrationPartner + API key
 * otomatik uretilir, posApiUrl/posApiKey tenant'a yazilir ve menu senkronu baslar.
 * Sifre SAKLANMAZ; yalnizca anlik login icin OtOrder'a iletilir.
 */
router.post(
  '/pos/connect-otorder',
  requireAuth,
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<any>>, next: NextFunction) => {
    try {
      const { subdomain, email, password } = req.body as {
        subdomain?: string;
        email?: string;
        password?: string;
      };
      const sub = (subdomain || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\.otorder\.com.*$/, '')
        .replace(/[^a-z0-9-]/g, '');
      if (!sub || !email || !password) {
        throw new AppError(400, 'INVALID_INPUT', 'Subdomain, e-posta ve sifre zorunlu');
      }

      const base = `https://${sub}.otorder.com`;
      const timeout = { signal: AbortSignal.timeout(12000) };

      // 1) OtOrder'a giris (subdomain host'u tenant'i cozer)
      let loginRes: globalThis.Response;
      try {
        loginRes = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          ...timeout,
        });
      } catch {
        throw new AppError(502, 'OTORDER_UNREACHABLE', `${sub}.otorder.com adresine ulasilamadi`);
      }
      const loginData = (await loginRes.json().catch(() => ({}))) as any;
      if (!loginRes.ok || !loginData?.token) {
        throw new AppError(401, 'OTORDER_LOGIN_FAILED', loginData?.error || 'OtOrder girisi basarisiz - bilgileri kontrol edin');
      }

      // 2) OtOrder tarafinda WhatsApp partner + API key uret
      const webhookUrl = `${process.env.APP_BASE_URL || ''}${process.env.API_PREFIX || '/api'}/webhooks/pos/${req.tenantId}`;
      const connectRes = await fetch(`${base}/api/integrations/whatsapp/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${loginData.token}`,
        },
        body: JSON.stringify({ webhookUrl }),
        ...timeout,
      });
      const connectData = (await connectRes.json().catch(() => ({}))) as any;
      if (!connectRes.ok || !connectData?.config?.posApiKey) {
        throw new AppError(
          connectRes.status === 403 ? 403 : 502,
          'OTORDER_CONNECT_FAILED',
          connectData?.error || 'OtOrder baglanti kurulamadi (paketinizde WhatsApp ozelligi aktif mi?)',
        );
      }

      // 3) Kimlikleri tenant'a yaz — posApiUrl BASE olmali; pos-integration.service
      //    zaten "/api/external/..." ekler, aksi halde cift path (/api/external/api/external) olur.
      const posBaseUrl = String(connectData.config.posApiUrl || '').replace(/\/api\/external\/?$/, '');
      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: {
          posApiUrl: posBaseUrl,
          posApiKey: connectData.config.posApiKey,
        },
      });
      logger.info({ tenantId: req.tenantId, sub }, 'OtOrder baglantisi kuruldu');

      // 4) Menuyu hemen cek (hata baglantiyi bozmaz)
      let sync: any = null;
      try {
        sync = await posIntegrationService.pullMenu(req.tenantId!);
      } catch (e) {
        logger.warn({ error: e }, 'OtOrder ilk menu senkronu basarisiz - sonra tekrar denenebilir');
      }

      res.json({
        success: true,
        data: {
          connected: true,
          subdomain: sub,
          posApiUrl: connectData.config.posApiUrl,
          sync,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export const integrationRouter = router;
