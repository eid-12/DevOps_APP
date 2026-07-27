import { Routes } from '@angular/router';
import { LandingPageComponent } from './pages/landing-page.component';
import { AuthPageComponent } from './pages/auth-page.component';
import { WizardPageComponent } from './pages/wizard-page.component';
import { DashboardPageComponent } from './pages/dashboard-page.component';
import { AdminPageComponent } from './pages/admin-page.component';
import { adminGuard, developerGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', component: LandingPageComponent },
  { path: 'auth', component: AuthPageComponent },
  { path: 'wizard', component: WizardPageComponent, canActivate: [developerGuard] },
  { path: 'dashboard', component: DashboardPageComponent, canActivate: [developerGuard] },
  { path: 'admin', component: AdminPageComponent, canActivate: [adminGuard] },
  { path: '**', redirectTo: '' }
];
