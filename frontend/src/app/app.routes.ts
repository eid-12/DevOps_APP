import { Routes } from '@angular/router';
import {
  authenticatedGuard,
  authenticatedMatch,
  adminGuard,
  adminMatch,
  guestGuard
} from './core/auth.guard';

/**
 * CloudBase router — feature routes are lazy-loaded (loadChildren / loadComponent).
 * canMatch blocks chunk download; canActivate re-checks before activation.
 * Typing a URL without a valid JWT redirects to /auth.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./layouts/main-layout.component').then(m => m.MainLayoutComponent),
    children: [
      {
        path: '',
        canActivate: [guestGuard],
        loadChildren: () =>
          import('./features/landing/landing.routes').then(m => m.LANDING_ROUTES)
      },
      {
        path: 'auth',
        loadChildren: () =>
          import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES)
      },
      {
        path: 'dashboard',
        canMatch: [authenticatedMatch],
        canActivate: [authenticatedGuard],
        data: { preload: true },
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES)
      },
      {
        path: 'projects',
        canMatch: [authenticatedMatch],
        canActivate: [authenticatedGuard],
        data: { preload: true },
        loadChildren: () =>
          import('./features/projects/projects.routes').then(m => m.PROJECTS_ROUTES)
      },
      {
        path: 'account',
        canMatch: [authenticatedMatch],
        canActivate: [authenticatedGuard],
        loadChildren: () =>
          import('./features/account/account.routes').then(m => m.ACCOUNT_ROUTES)
      },
      {
        path: 'billing',
        canMatch: [authenticatedMatch],
        canActivate: [authenticatedGuard],
        loadChildren: () =>
          import('./features/billing/billing.routes').then(m => m.BILLING_ROUTES)
      },
      {
        path: 'help',
        canMatch: [authenticatedMatch],
        canActivate: [authenticatedGuard],
        loadChildren: () =>
          import('./features/help/help.routes').then(m => m.HELP_ROUTES)
      },
      {
        path: 'admin',
        canMatch: [adminMatch],
        canActivate: [adminGuard],
        loadChildren: () =>
          import('./features/admin/admin.routes').then(m => m.ADMIN_ROUTES)
      },
      { path: 'wizard', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'activity', redirectTo: 'billing', pathMatch: 'full' }
    ]
  },
  { path: '**', redirectTo: '' }
];
