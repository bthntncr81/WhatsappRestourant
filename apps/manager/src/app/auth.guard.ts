import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AdminService } from './admin.service';

export const authGuard: CanActivateFn = () => {
  const admin = inject(AdminService);
  const router = inject(Router);
  if (admin.isAuthenticated()) return true;
  router.navigate(['/login']);
  return false;
};

export const guestGuard: CanActivateFn = () => {
  const admin = inject(AdminService);
  const router = inject(Router);
  if (!admin.isAuthenticated()) return true;
  router.navigate(['/']);
  return false;
};
