import { Routes } from '@angular/router';
import { authenticatedGuard, guestGuard } from '../../core/auth.guard';

/** Sign-in / register / reset + GitHub OAuth callback */
export const AUTH_ROUTES: Routes = [
  {
    path: '',
    title: 'Sign in · CloudBase',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('../../pages/auth-page.component').then(m => m.AuthPageComponent)
  },
  {
    path: 'github/callback',
    title: 'Connecting GitHub…',
    canActivate: [authenticatedGuard],
    loadComponent: () =>
      import('../../pages/github-callback-page.component').then(m => m.GitHubCallbackPageComponent)
  }
];
