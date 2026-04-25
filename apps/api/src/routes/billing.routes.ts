import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { billingService } from '../services/billing.service';
import { requireAuth } from '../middleware/auth.middleware';
import { createLogger } from '../logger';
import {
  RegisterCardDto,
  CancelSubscriptionDto,
  SubscriptionPlan,
  BillingCycle,
} from '@whatres/shared';

const logger = createLogger();
const router = Router();

// ==================== VALIDATION SCHEMAS ====================

const buyerSchema = z.object({
  email: z.string().email('Geçersiz e-posta adresi'),
  name: z.string().min(1, 'Ad alanı boş olamaz').max(50),
  surname: z.string().min(1, 'Soyad alanı boş olamaz').max(50),
  gsmNumber: z
    .string()
    .min(10, 'Telefon numarası çok kısa')
    .max(20, 'Telefon numarası çok uzun'),
  identityNumber: z
    .string()
    .regex(/^\d{11}$/, 'TC Kimlik numarası 11 haneli olmalı'),
  city: z.string().min(1, 'Şehir alanı boş olamaz').max(50),
  country: z.string().min(1, 'Ülke alanı boş olamaz').max(50),
  address: z.string().min(5, 'Adres çok kısa').max(500),
  zipCode: z.string().min(1).max(10),
});

const checkoutFormSchema = z.object({
  planKey: z.enum(['TRIAL', 'SILVER', 'GOLD', 'PLATINUM'], {
    message: 'Geçersiz plan seçimi',
  }),
  billingCycle: z.enum(['MONTHLY', 'ANNUAL'], {
    message: 'Geçersiz faturalama dönemi',
  }),
  buyer: buyerSchema,
  callbackUrl: z.string().url('callbackUrl geçerli bir URL olmalı'),
});

const cancelSchema = z.object({
  immediate: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

const changePlanSchema = z.object({
  newPlan: z.enum(['TRIAL', 'SILVER', 'GOLD', 'PLATINUM'], {
    message: 'Geçersiz plan seçimi',
  }),
  billingCycle: z.enum(['MONTHLY', 'ANNUAL']).optional(),
});

/**
 * Helper: format a Zod error as a user-friendly response body.
 */
function zodErrorResponse(error: z.ZodError) {
  const first = error.issues[0];
  const field = first?.path.join('.');
  return {
    success: false as const,
    error: {
      code: 'INVALID_REQUEST',
      message: field ? `${field}: ${first.message}` : first?.message || 'Geçersiz istek',
      issues: error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    },
  };
}

// ==================== PUBLIC ROUTES ====================

/**
 * GET /api/billing/plans
 * Get available subscription plans (public)
 */
router.get('/plans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = billingService.getPlans();
    res.json({
      success: true,
      data: { plans },
    });
  } catch (error) {
    next(error);
  }
});

// ==================== PUBLIC PAYMENT WEBHOOK & CALLBACK ====================
// These must NOT require auth — iyzico is the caller, not our frontend.

/**
 * POST /api/billing/webhook/iyzico
 * Receives recurring payment events from iyzico (subscription renewal success,
 * failure, card update, etc.). Currently logs the payload structurally; full
 * event handling (mark subscription UNPAID, notify user, etc.) is still TODO.
 */
router.post('/webhook/iyzico', async (req: Request, res: Response) => {
  logger.info({ payload: req.body }, 'iyzico webhook received');
  // Acknowledge quickly so iyzico doesn't retry. Actual event processing
  // should eventually be handed to a queue worker.
  res.json({ status: 'received' });
});

/**
 * HTML-escape user-supplied or backend-supplied strings before embedding
 * them in the callback response HTML. Defensive against XSS — even though
 * messages today come from trusted backend code, a future change that pipes
 * user content through would not be exploitable. (Security audit 2026-04-15
 * finding #4.)
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * POST /api/billing/callback
 * Handle 3DS subscription checkout-form callback from iyzico.
 *
 * iyzico POSTs to this endpoint with form-encoded { token } after the user
 * completes the 3DS flow. We retrieve the subscription result server-side
 * and return an HTML page that postMessages the parent window (the billing
 * page opened the checkout in a popup).
 *
 * SECURITY: this endpoint is PUBLIC (iyzico is the caller, not our frontend).
 * Never trust req.body blindly — always re-fetch the result from iyzico
 * using the token. The token itself is an opaque one-time value.
 *
 * XSS defence: all user-visible strings are HTML-escaped before being
 * interpolated into the response body. postMessage uses JSON.stringify
 * which escapes quotes and special chars safely inside a script context.
 */
router.post('/callback', async (req: Request, res: Response) => {
  const token = (req.body?.token as string | undefined)?.trim();
  logger.info({ hasToken: Boolean(token) }, '3DS subscription callback received');

  const html = (success: boolean, message: string) => {
    const safeMessage = escapeHtml(message);
    return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <title>Ödeme Sonucu</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #f9fafb; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 16px; padding: 32px 40px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); text-align: center; max-width: 380px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h2 { margin: 0 0 8px; font-size: 1.2rem; color: #111827; }
    p { margin: 0; font-size: 0.9rem; color: #6b7280; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '✓' : '✗'}</div>
    <h2>${success ? 'Ödeme Başarılı' : 'Ödeme Başarısız'}</h2>
    <p>${safeMessage}</p>
  </div>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({
          type: 'WHATRES_BILLING_RESULT',
          success: ${success ? 'true' : 'false'},
          message: ${JSON.stringify(message.slice(0, 500))}
        }, '*');
      }
    } catch (e) {}
    setTimeout(function () {
      if (window.opener && !window.opener.closed) {
        window.close();
      } else {
        window.location.href = '/billing?status=${success ? 'success' : 'failed'}';
      }
    }, 1500);
  </script>
</body>
</html>`;
  };

  if (!token) {
    logger.warn('3DS callback: missing token in body');
    res.status(400).send(html(false, 'Token eksik — ödeme doğrulanamadı.'));
    return;
  }

  try {
    const result = await billingService.completeSubscriptionCheckout(token);
    if (result.success) {
      res.send(html(true, result.alreadyProcessed
        ? 'Aboneliğiniz zaten aktif.'
        : 'Aboneliğiniz başarıyla aktifleştirildi!'));
    } else {
      res.send(html(false, result.error || 'Ödeme tamamlanamadı.'));
    }
  } catch (error) {
    logger.error({ error, token }, '3DS callback processing error');
    res.send(html(false, 'İşlem sırasında bir hata oluştu. Lütfen destek ekibine ulaşın.'));
  }
});

// Some integrations send GET instead of POST on the callback URL — support both.
router.get('/callback', async (req: Request, res: Response) => {
  const token = (req.query?.token as string | undefined)?.trim();
  try {
    const result = token
      ? await billingService.completeSubscriptionCheckout(token)
      : { success: false, error: 'Token eksik' };
    const errMsg = (result.error || '').slice(0, 500);
    res.send(`<!DOCTYPE html><html><body><script>
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'WHATRES_BILLING_RESULT', success: ${result.success ? 'true' : 'false'}, message: ${JSON.stringify(errMsg)} }, '*');
        window.close();
      } else {
        window.location.href = '/billing?status=${result.success ? 'success' : 'failed'}';
      }
    </script></body></html>`);
  } catch (error) {
    logger.error({ error }, 'GET /callback error');
    res.status(500).send('Internal error');
  }
});

// ==================== PROTECTED ROUTES ====================

// All routes below require authentication
router.use(requireAuth);

/**
 * GET /api/billing/overview
 * Get billing overview (subscription, cards, transactions, usage)
 */
router.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const overview = await billingService.getBillingOverview(tenantId);
    res.json({
      success: true,
      data: overview,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/billing/subscription
 * Get current subscription
 */
router.get('/subscription', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const subscription = await billingService.getOrCreateSubscription(tenantId);
    res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/subscribe
 * DEPRECATED: direct card entry was moved to iyzico's hosted checkout form
 * for PCI-DSS compliance. Frontend must use /subscribe/checkout-form.
 */
router.post('/subscribe', async (_req: Request, res: Response) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'ENDPOINT_DEPRECATED',
      message: 'Bu uç nokta kaldırıldı. Lütfen /api/billing/subscribe/checkout-form kullanın (3DS ile güvenli ödeme).',
    },
  });
});

/**
 * POST /api/billing/subscribe/checkout-form
 * Get iyzico checkout form for subscription (supports 3DS).
 *
 * Idempotency: if a PENDING subscription transaction was created in the
 * last 60 seconds, reject the new request with 409 Conflict. Protects
 * against double-click race conditions on the subscribe button.
 */
router.post('/subscribe/checkout-form', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = checkoutFormSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(zodErrorResponse(parsed.error));
  }

  try {
    const tenantId = req.user!.tenantId;
    const { planKey, billingCycle, buyer, callbackUrl } = parsed.data;

    // Simple idempotency guard — block duplicate checkout attempts from the
    // same tenant within 60s
    const recent = await billingService.hasRecentPendingSubscription(tenantId, 60);
    if (recent) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'PAYMENT_IN_PROGRESS',
          message: 'Yakın zamanda başlatılmış bir ödeme işlemi var. Lütfen önceki ödeme penceresini tamamlayın veya 1 dakika bekleyip tekrar deneyin.',
        },
      });
    }

    const result = await billingService.getSubscriptionCheckoutForm(
      tenantId,
      planKey,
      billingCycle,
      buyer,
      callbackUrl,
    );

    if (result.success) {
      res.json({
        success: true,
        data: {
          checkoutFormContent: result.checkoutFormContent,
          token: result.token,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: { code: 'CHECKOUT_FORM_FAILED', message: result.error || 'Ödeme formu oluşturulamadı' },
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/cancel
 * Cancel subscription
 */
router.post('/cancel', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(zodErrorResponse(parsed.error));
  }

  try {
    const tenantId = req.user!.tenantId;
    const dto = parsed.data;

    const subscription = await billingService.cancelSubscription(tenantId, {
      immediate: dto.immediate ?? false,
      reason: dto.reason,
    });

    res.json({
      success: true,
      data: subscription,
      message: dto.immediate
        ? 'Abonelik hemen iptal edildi'
        : 'Abonelik, fatura döneminin sonunda iptal edilecek',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/change-plan
 * Change subscription plan
 */
router.post('/change-plan', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = changePlanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(zodErrorResponse(parsed.error));
  }

  try {
    const tenantId = req.user!.tenantId;
    const { newPlan, billingCycle } = parsed.data;

    const subscription = await billingService.changePlan(
      tenantId,
      newPlan,
      billingCycle,
    );

    res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/billing/usage
 * Get current usage
 */
router.get('/usage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    
    const [ordersUsage, messagesUsage] = await Promise.all([
      billingService.checkUsageLimit(tenantId, 'orders'),
      billingService.checkUsageLimit(tenantId, 'messages'),
    ]);

    res.json({
      success: true,
      data: {
        orders: ordersUsage,
        messages: messagesUsage,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==================== CARD ROUTES ====================

/**
 * GET /api/billing/cards
 * Get stored cards
 */
router.get('/cards', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const cards = await billingService.getStoredCards(tenantId);
    res.json({
      success: true,
      data: { cards },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/cards
 * Register a new card
 */
router.post('/cards', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const dto: RegisterCardDto = req.body;

    if (!dto.card || !dto.buyer) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'card and buyer are required' },
      });
    }

    const card = await billingService.registerCard(tenantId, dto);
    res.status(201).json({
      success: true,
      data: card,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/billing/cards/:cardId
 * Delete a stored card
 */
router.delete('/cards/:cardId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const { cardId } = req.params;

    await billingService.deleteCard(tenantId, cardId);
    res.json({
      success: true,
      message: 'Card deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/cards/:cardId/set-default
 * Set card as default
 */
router.post('/cards/:cardId/set-default', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const { cardId } = req.params;

    await billingService.setDefaultCard(tenantId, cardId);
    res.json({
      success: true,
      message: 'Default card updated',
    });
  } catch (error) {
    next(error);
  }
});

// ==================== TRANSACTION ROUTES ====================

/**
 * GET /api/billing/transactions
 * Get billing transactions
 */
router.get('/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await billingService.getTransactions(tenantId, limit, offset);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// (webhook + callback routes are registered above, before requireAuth)

export default router;

