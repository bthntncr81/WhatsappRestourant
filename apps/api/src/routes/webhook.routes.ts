import { Router, Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import prisma from '../db/prisma';
import { posIntegrationService } from '../services/pos-integration.service';
import { conversationFlowService } from '../services/conversation-flow.service';
import { createLogger } from '../logger';

const router = Router();
const logger = createLogger();

/**
 * Notify customer via WhatsApp about order status change
 */
async function notifyCustomerStatusChange(
  tenantId: string,
  conversationId: string,
  orderId: string,
  status: string,
): Promise<void> {
  try {
    const statusMessages: Record<string, string> = {
      CONFIRMED: '✅ Siparişiniz onaylandı! Hazırlanmaya başlanacak.',
      PREPARING: '👨‍🍳 Siparişiniz hazırlanıyor...',
      READY: '🎉 Siparişiniz hazır!',
      DELIVERING: '🚗 Siparişiniz yola çıktı!',
      DELIVERED: '📦 Siparişiniz teslim edildi. Afiyet olsun!',
      CANCELLED: '❌ Siparişiniz iptal edildi.',
    };

    const message = statusMessages[status];
    if (!message) return;

    await conversationFlowService.sendStatusNotification(tenantId, conversationId, message);
  } catch (error) {
    logger.error({ tenantId, conversationId, orderId, status, error }, 'Müşteri bildirim hatası');
  }
}

/**
 * POST /webhooks/pos/:tenantId
 * Receive webhooks from POS system
 * Events: order.confirmed, order.preparing, order.ready, order.delivered, order.cancelled, menu.updated
 */
router.post(
  '/pos/:tenantId',
  async (req: Request, res: Response, _next: NextFunction) => {
    try {
      const { tenantId } = req.params;

      // Get tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        logger.warn({ tenantId }, 'POS webhook: Tenant bulunamadı');
        return res.status(404).json({ success: false, error: 'Tenant not found' });
      }

      // Verify HMAC signature if webhook secret is configured
      if (tenant.posWebhookSecret) {
        const signature = req.headers['x-webhook-signature'] as string;
        if (!signature) {
          logger.warn({ tenantId }, 'POS webhook: İmza eksik');
          return res.status(401).json({ success: false, error: 'Missing signature' });
        }

        const body = JSON.stringify(req.body);
        const expectedSignature = createHmac('sha256', tenant.posWebhookSecret)
          .update(body)
          .digest('hex');

        // Use timing-safe comparison to prevent timing attacks
        const expectedBuf = Buffer.from(expectedSignature, 'hex');
        const signatureBuf = Buffer.from(signature, 'hex');
        if (
          expectedBuf.length !== signatureBuf.length ||
          !timingSafeEqual(expectedBuf, signatureBuf)
        ) {
          logger.warn({ tenantId }, 'POS webhook: Geçersiz imza');
          return res.status(401).json({ success: false, error: 'Invalid signature' });
        }
      }

      const { event, data } = req.body;

      if (!event) {
        return res.status(400).json({ success: false, error: 'Missing event' });
      }

      logger.info({ tenantId, event }, 'POS webhook alındı');

      // Handle order status events
      if (event.startsWith('order.')) {
        const status = event.replace('order.', '').toUpperCase();
        const externalOrderId = data?.externalOrderId || data?.orderId;

        if (!externalOrderId) {
          return res.status(400).json({ success: false, error: 'Missing order ID' });
        }

        const result = await posIntegrationService.handleStatusUpdate(
          tenantId,
          externalOrderId,
          status,
        );

        // Send WhatsApp notification
        if (result) {
          await notifyCustomerStatusChange(
            tenantId,
            result.conversationId,
            result.orderId,
            result.updatedStatus,
          );
        }

        return res.json({ success: true, processed: !!result });
      }

      // Handle menu update event
      if (event === 'menu.updated') {
        logger.info({ tenantId }, 'POS menü güncelleme, senkronizasyon başlatılıyor...');

        // Sync in background - don't block webhook response
        posIntegrationService.pullMenu(tenantId).catch((err) => {
          logger.error({ tenantId, error: err.message }, 'Otomatik menü senkronizasyonu hatası');
        });

        return res.json({ success: true, message: 'Menu sync started' });
      }

      // Handle ping
      if (event === 'ping') {
        return res.json({ success: true, message: 'pong', timestamp: new Date().toISOString() });
      }

      // Unknown event
      logger.warn({ tenantId, event }, 'Bilinmeyen POS webhook event');
      return res.json({ success: true, message: 'Unknown event, ignored' });
    } catch (error) {
      logger.error({ error }, 'POS webhook işleme hatası');
      // Always return 200 to prevent retries for application errors
      return res.status(200).json({ success: false, error: 'Internal processing error' });
    }
  },
);

export const webhookRouter = router;
