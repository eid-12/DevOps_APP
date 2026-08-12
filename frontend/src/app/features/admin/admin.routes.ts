import { Routes } from '@angular/router';
import { adminGuard } from '../../core/auth.guard';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    title: 'Admin · CloudBase',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('../../pages/admin-page.component').then(m => m.AdminPageComponent)
  }
];
