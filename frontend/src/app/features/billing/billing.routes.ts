import { Routes } from '@angular/router';
import { authenticatedGuard } from '../../core/auth.guard';

export const BILLING_ROUTES: Routes = [
  {
    path: '',
    title: 'Billing · CloudBase',
    canActivate: [authenticatedGuard],
    loadComponent: () =>
      import('../../pages/billing-page.component').then(m => m.BillingPageComponent)
  }
];
