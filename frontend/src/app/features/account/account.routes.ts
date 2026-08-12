import { Routes } from '@angular/router';
import { authenticatedGuard } from '../../core/auth.guard';

export const ACCOUNT_ROUTES: Routes = [
  {
    path: '',
    title: 'Account · CloudBase',
    canActivate: [authenticatedGuard],
    loadComponent: () =>
      import('../../pages/account-page.component').then(m => m.AccountPageComponent)
  }
];
