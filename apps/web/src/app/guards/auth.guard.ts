import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }

  // Onboarding guard: if not completed, redirect to /onboarding
  // Skip this check if we're already on the onboarding page
  const tenant = authService.tenant();
  if (tenant && tenant.onboardingCompleted === false && route.routeConfig?.path !== 'onboarding') {
    router.navigate(['/onboarding']);
    return false;
  }

  return true;
};

export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/']);
  return false;
};

export const roleGuard = (allowedRoles: string[]): CanActivateFn => {
  return (route) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (!authService.isAuthenticated()) {
      router.navigate(['/login']);
      return false;
    }

    // Onboarding guard
    const tenant = authService.tenant();
    if (tenant && tenant.onboardingCompleted === false && route.routeConfig?.path !== 'onboarding') {
      router.navigate(['/onboarding']);
      return false;
    }

    if (authService.hasRole(allowedRoles)) {
      return true;
    }

    router.navigate(['/']);
    return false;
  };
};


