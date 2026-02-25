import { Router, Request, Response, NextFunction } from 'express';
import { ApiResponse, OrderPaymentDto } from '@whatres/shared';
import { orderPaymentService } from '../services/order-payment.service';
import { conversationFlowService } from '../services/conversation-flow.service';
import { requireAuth } from '../middleware/auth.middleware';
import { createLogger } from '../logger';

const router = Router();
const logger = createLogger();

/**
 * POST /payments/callback/iyzico
 * iyzico payment callback - PUBLIC endpoint (no auth)
 * iyzico POSTs here after customer completes payment
 */
router.post(
  '/callback/iyzico',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body;

      if (!token) {
        logger.warn('iyzico callback received without token');
        return res.status(400).send('Missing token');
      }

      logger.info({ token: token.substring(0, 20) + '...' }, 'iyzico payment callback received');

      // Process payment result
      const result = await orderPaymentService.handlePaymentCallback(token);

      // Trigger conversation flow update
      await conversationFlowService.handlePaymentCompleted(
        result.tenantId,
        result.conversationId,
        result.orderId,
        result.success,
      );

      // Return HTML page for customer (iyzico redirects browser here)
      const html = result.success
        ? `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Odeme Basarili</title></head>
           <body style="font-family:sans-serif;text-align:center;padding:50px">
           <h1>✅ Odemeniz Basariyla Alindi!</h1>
           <p>WhatsApp'a donerek siparisinizia takip edebilirsiniz.</p>
           </body></html>`
        : `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Odeme Basarisiz</title></head>
           <body style="font-family:sans-serif;text-align:center;padding:50px">
           <h1>❌ Odeme Basarisiz</h1>
           <p>WhatsApp'tan tekrar deneyebilir veya nakit odeme secebilirsiniz.</p>
           </body></html>`;

      res.status(200).send(html);
    } catch (error) {
      logger.error({ error }, 'iyzico callback processing failed');
      res.status(200).send(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Hata</title></head>
         <body style="font-family:sans-serif;text-align:center;padding:50px">
         <h1>Bir hata olustu</h1>
         <p>Lutfen WhatsApp'tan bizimle iletisime gecin.</p>
         </body></html>`
      );
    }
  }
);

/**
 * GET /payments/:paymentId/status
 * Get payment status (for admin panel)
 */
router.get(
  '/:paymentId/status',
  requireAuth,
  async (req: Request, res: Response<ApiResponse<OrderPaymentDto | null>>, next: NextFunction) => {
    try {
      const payment = await orderPaymentService.getPaymentStatus(
        req.tenantId!,
        req.params.paymentId,
      );

      res.json({ success: true, data: payment });
    } catch (error) {
      next(error);
    }
  }
);

export const paymentRouter = router;
