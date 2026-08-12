import { Routes } from '@angular/router';

/** Public marketing home */
export const LANDING_ROUTES: Routes = [
  {
    path: '',
    title: 'CloudBase',
    loadComponent: () =>
      import('../../pages/landing-page.component').then(m => m.LandingPageComponent)
  }
];
