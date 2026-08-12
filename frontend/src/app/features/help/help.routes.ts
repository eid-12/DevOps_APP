import { Routes } from '@angular/router';
import { authenticatedGuard } from '../../core/auth.guard';

export const HELP_ROUTES: Routes = [
  {
    path: '',
    title: 'Help · CloudBase',
    canActivate: [authenticatedGuard],
    loadComponent: () =>
      import('../../pages/help-page.component').then(m => m.HelpPageComponent)
  }
];
