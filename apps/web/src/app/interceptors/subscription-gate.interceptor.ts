import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { DialogService } from '../shared/dialog.service';

export const subscriptionGateInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const dialog = inject(DialogService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 403 && error.error?.error?.code === 'SUBSCRIPTION_INACTIVE') {
        const message = error.error.error.message || 'Aboneliğiniz aktif değil.';
        dialog.error(message);
        router.navigate(['/billing']);
      }
      return throwError(() => error);
    })
  );
};
