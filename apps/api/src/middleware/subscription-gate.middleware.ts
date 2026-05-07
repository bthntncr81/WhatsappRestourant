import { Request, Response, NextFunction } from 'express';
import { billingService } from '../services/billing.service';

/**
 * Middleware that blocks API access when the tenant's subscription is expired/cancelled/unpaid.
 * Allows billing endpoints through so the tenant can reactivate.
 */
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.tenantId;
  if (!tenantId) return next();

  // Always allow billing, auth, and webhook endpoints
  const path = req.path.toLowerCase();
  if (path.startsWith('/billing') || path.startsWith('/auth') || path.startsWith('/whatsapp')) {
    return next();
  }

  try {
    const result = await billingService.isSubscriptionActive(tenantId);

    if (!result.active) {
      const messages: Record<string, string> = {
        EXPIRED: 'Aboneliğinizin süresi dolmuş. Lütfen planınızı yenileyiniz.',
        CANCELLED: 'Aboneliğiniz iptal edilmiş. Yeniden aktifleştirmek için plan seçiniz.',
        UNPAID: 'Ödenmemiş faturanız bulunmaktadır. Lütfen ödeme yapınız.',
      };

      return res.status(403).json({
        success: false,
        error: {
          code: 'SUBSCRIPTION_INACTIVE',
          reason: result.reason,
          message: messages[result.reason!] || 'Abonelik aktif değil.',
        },
      });
    }

    // Attach subscription info to request for downstream use
    (req as any).subscriptionPlan = result.plan;
    (req as any).daysRemaining = result.daysRemaining;
    next();
  } catch {
    // Don't block on billing service errors — fail open
    next();
  }
}
