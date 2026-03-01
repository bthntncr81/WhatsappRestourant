import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './guards/auth.guard';

export const routes: Routes = [
  // Public routes
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.component').then((m) => m.LoginComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./pages/register/register.component').then((m) => m.RegisterComponent),
    canActivate: [guestGuard],
  },

  // Protected routes
  {
    path: '',
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'menu',
    loadComponent: () =>
      import('./pages/menu/menu.component').then((m) => m.MenuComponent),
    canActivate: [roleGuard(['OWNER', 'ADMIN'])],
  },
  {
    path: 'inbox',
    loadComponent: () =>
      import('./pages/inbox/inbox.component').then((m) => m.InboxComponent),
    canActivate: [roleGuard(['OWNER', 'ADMIN', 'AGENT'])],
  },
  {
    path: 'orders',
    loadComponent: () =>
      import('./pages/orders/orders.component').then((m) => m.OrdersComponent),
    canActivate: [roleGuard(['OWNER', 'ADMIN', 'AGENT'])],
  },
  {
    path: 'print-jobs',
    loadComponent: () =>
      import('./pages/print-jobs/print-jobs.component').then((m) => m.PrintJobsComponent),
    canActivate: [roleGuard(['OWNER', 'ADMIN'])],
  },
  {
    path: 'stores',
    loadComponent: () =>
      import('./pages/stores/stores.component').then((m) => m.StoresComponent),
    canActivate: [roleGuard(['OWNER', 'ADMIN'])],
  },
  {
    path: 'me',
    loadComponent: () => import('./pages/me/me.component').then((m) => m.MeComponent),
    canActivate: [authGuard],
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'chatbot',
    loadComponent: () =>
      import('./pages/chatbot/chatbot.component').then((m) => m.ChatbotComponent),
    canActivate: [authGuard],
  },
  {
    path: 'billing',
    loadComponent: () =>
      import('./pages/billing/billing.component').then((m) => m.BillingComponent),
    canActivate: [roleGuard(['OWNER', 'ADMIN'])],
  },
  {
    path: 'surveys',
    loadComponent: () =>
      import('./pages/surveys/surveys.component').then((m) => m.SurveysComponent),
    canActivate: [roleGuard(['OWNER', 'ADMIN'])],
  },
  {
    path: 'campaigns',
    loadComponent: () =>
      import('./pages/campaigns/campaigns.component').then((m) => m.CampaignsComponent),
    canActivate: [roleGuard(['OWNER', 'ADMIN'])],
  },

  // Wildcard
  {
    path: '**',
    redirectTo: '',
  },
];
