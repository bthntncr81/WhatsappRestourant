import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AdminService } from './admin.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const admin = inject(AdminService);
  const router = inject(Router);
  const token = admin.token();

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((err) => {
      if (err.status === 401 && !req.url.endsWith('/login')) {
        admin.logout();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
