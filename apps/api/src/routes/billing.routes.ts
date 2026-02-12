import { Router, Request, Response, NextFunction } from 'express';
import { billingService } from '../services/billing.service';
import { requireAuth } from '../middleware/auth.middleware';
import { createLogger } from '../logger';
import {
  SubscribeWithNewCardDto,
  RegisterCardDto,
  CancelSubscriptionDto,
  SubscriptionPlan,
  BillingCycle,
} from '@whatres/shared';

const logger = createLogger();
const router = Router();

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
 * Subscribe to a plan with new card
 */
router.post('/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const dto: SubscribeWithNewCardDto = req.body;

    // Validate required fields
    if (!dto.planKey || !dto.billingCycle || !dto.card || !dto.buyer) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Missing required fields' },
      });
    }

    const result = await billingService.subscribeWithNewCard(tenantId, dto);

    if (result.success) {
      res.json({
        success: true,
        data: {
          status: 'Success',
          message: 'Subscription activated successfully',
          subscription: result.subscription,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: { code: 'PAYMENT_FAILED', message: result.error },
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/billing/subscribe/checkout-form
 * Get checkout form for subscription (supports 3DS)
 */
router.post('/subscribe/checkout-form', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const { planKey, billingCycle, buyer, callbackUrl } = req.body;

    if (!planKey || !billingCycle || !buyer || !callbackUrl) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Missing required fields' },
      });
    }

    const result = await billingService.getSubscriptionCheckoutForm(
      tenantId,
      planKey as SubscriptionPlan,
      billingCycle as BillingCycle,
      buyer,
      callbackUrl
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
        error: { code: 'CHECKOUT_FORM_FAILED', message: result.error },
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
  try {
    const tenantId = req.user!.tenantId;
    const dto: CancelSubscriptionDto = req.body;

    const subscription = await billingService.cancelSubscription(tenantId, {
      immediate: dto.immediate ?? false,
      reason: dto.reason,
    });

    res.json({
      success: true,
      data: subscription,
      message: dto.immediate 
        ? 'Subscription cancelled immediately' 
        : 'Subscription will be cancelled at end of billing period',
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
  try {
    const tenantId = req.user!.tenantId;
    const { newPlan, billingCycle } = req.body;

    if (!newPlan) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'newPlan is required' },
      });
    }

    const subscription = await billingService.changePlan(
      tenantId,
      newPlan as SubscriptionPlan,
      billingCycle as BillingCycle | undefined
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

// ==================== WEBHOOK ROUTES ====================

/**
 * POST /api/billing/webhook/iyzico
 * Handle iyzico webhook notifications
 */
router.post('/webhook/iyzico', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body;
    
    logger.info({ payload }, 'Received iyzico webhook');

    // TODO: Implement webhook handling for:
    // - Subscription payment success/failure
    // - Subscription cancellation
    // - Subscription upgrade
    // - Card updates

    // For now, just acknowledge receipt
    res.json({ status: 'received' });
  } catch (error) {
    logger.error({ error }, 'Webhook processing error');
    next(error);
  }
});

/**
 * POST /api/billing/callback
 * Handle 3DS callback from iyzico
 */
router.post('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { paymentId, conversationId, mdStatus, status, token } = req.body;
    
    logger.info({ paymentId, conversationId, mdStatus, status }, '3DS callback received');

    // TODO: Complete 3DS payment flow
    // 1. Verify the callback
    // 2. Update subscription status
    // 3. Return HTML that posts message to parent window

    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Ödeme Sonucu</title></head>
      <body>
        <script>
          if (window.opener) {
            window.opener.postMessage({
              type: 'PAYMENT_RESULT',
              success: ${status === 'success'},
              paymentId: '${paymentId || ''}',
              mdStatus: '${mdStatus || ''}'
            }, '*');
            window.close();
          } else {
            window.location.href = '/billing?status=${status === 'success' ? 'success' : 'failed'}';
          }
        </script>
        <p>İşlem tamamlandı. Bu pencere otomatik olarak kapanacak...</p>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    logger.error({ error }, '3DS callback error');
    next(error);
  }
});

export default router;

