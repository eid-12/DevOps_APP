import { Routes } from '@angular/router';

/** Public marketing home */
export const LANDING_ROUTES: Routes = [
  {
    path: '',
    title: "CloudBase | \u0643\u0644\u0627\u0648\u062f \u0628\u064a\u0633 \u2014 Private Cloud App Deployment",
    loadComponent: () =>
      import('../../pages/landing-page.component').then(m => m.LandingPageComponent)
  }
];
