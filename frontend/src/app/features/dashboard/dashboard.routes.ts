import { Routes } from '@angular/router';
import { authenticatedGuard } from '../../core/auth.guard';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    title: 'Dashboard · CloudBase',
    canActivate: [authenticatedGuard],
    data: { preload: true },
    loadComponent: () =>
      import('../../pages/dashboard-page.component').then(m => m.DashboardPageComponent)
  }
];
