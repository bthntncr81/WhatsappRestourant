import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent),
    canActivate: [guestGuard],
  },
  {
    path: '',
    loadComponent: () => import('./pages/shell.component').then((m) => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'tenants',
        loadComponent: () => import('./pages/tenants.component').then((m) => m.TenantsComponent),
      },
      {
        path: 'tenants/:id',
        loadComponent: () => import('./pages/tenant-detail.component').then((m) => m.TenantDetailComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
