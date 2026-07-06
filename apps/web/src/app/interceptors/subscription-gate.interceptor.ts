import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { DialogService } from '../shared/dialog.service';

const REASON_COPY: Record<string, { title: string; message: string }> = {
  EXPIRED: {
    title: 'Hesabınız Askıya Alındı',
    message:
      'Aboneliğinizin ödemesi yapılmadığı için hesabınız askıya alınmıştır. ' +
      'WhatsApp botunuz şu anda müşterilerinize yanıt VERMİYOR ve panel özelliklerine erişiminiz kısıtlandı.\n\n' +
      'Hizmete kaldığınız yerden devam etmek için lütfen aboneliğinizi yenileyin.',
  },
  UNPAID: {
    title: 'Hesabınız Askıya Alındı',
    message:
      'Ödenmemiş faturanız nedeniyle 2 günlük ödeme süreniz dolmuş ve hesabınız askıya alınmıştır. ' +
      'WhatsApp botunuz müşterilerinize yanıt VERMİYOR.\n\n' +
      'Hizmeti yeniden başlatmak için lütfen ödemenizi tamamlayın.',
  },
  CANCELLED: {
    title: 'Aboneliğiniz İptal Edildi',
    message:
      'Aboneliğiniz iptal edilmiştir. WhatsApp botunuz müşterilerinize yanıt VERMİYOR ve panel erişiminiz kısıtlandı.\n\n' +
      'Yeniden aktifleştirmek için bir plan seçin.',
  },
};

export const subscriptionGateInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const dialog = inject(DialogService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const code = error.error?.error?.code;

      if (error.status === 403 && code === 'SUBSCRIPTION_INACTIVE') {
        const reason: string = error.error.error.reason || 'EXPIRED';
        const copy = REASON_COPY[reason] || {
          title: 'Hesabınız Askıya Alındı',
          message: error.error.error.message || 'Aboneliğiniz aktif değil.',
        };

        // Big, blocking, deduped modal — a single key keeps a burst of 403s
        // from stacking identical dialogs.
        dialog.alertOnce('subscription-inactive', copy.message, {
          title: copy.title,
          variant: 'danger',
          size: 'large',
          dismissible: false,
          confirmText: 'Aboneliği Yenile',
        }).then(() => router.navigate(['/billing']));

        router.navigate(['/billing']);
      }

      if (error.status === 403 && code === 'PLAN_LIMIT_REACHED') {
        // Plan quota hit (e.g. trying to open a 3rd store on a 2-store plan).
        // Big, upgrade-focused modal — dismissible, with an "upgrade" CTA that
        // routes to billing. Deduped so rapid retries don't stack.
        const message = error.error.error.message || 'Plan limitinize ulaştınız.';
        dialog
          .confirm(message, {
            title: 'Plan Limitine Ulaşıldı',
            variant: 'warning',
            size: 'large',
            confirmText: 'Planı Yükselt',
            cancelText: 'Vazgeç',
            dedupeKey: 'plan-limit-reached',
          })
          .then((upgrade) => {
            if (upgrade) router.navigate(['/billing']);
          });
      }

      return throwError(() => error);
    })
  );
};
