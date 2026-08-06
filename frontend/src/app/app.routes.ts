import { Routes } from '@angular/router';
import { LandingPageComponent } from './pages/landing-page.component';
import { AuthPageComponent } from './pages/auth-page.component';
import { DashboardPageComponent } from './pages/dashboard-page.component';
import { AdminPageComponent } from './pages/admin-page.component';
import { ProjectDetailPageComponent } from './pages/project-detail-page.component';
import { ServiceDetailPageComponent } from './pages/service-detail-page.component';
import { AccountPageComponent } from './pages/account-page.component';
import { BillingPageComponent } from './pages/billing-page.component';
import { HelpPageComponent } from './pages/help-page.component';
import { GitHubCallbackPageComponent } from './pages/github-callback-page.component';
import { adminGuard, authenticatedGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', component: LandingPageComponent },
  { path: 'auth', component: AuthPageComponent },
  /** Public: GitHub redirects here with ?code=&state= (no JWT required). */
  { path: 'auth/github/callback', component: GitHubCallbackPageComponent },
  { path: 'wizard', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardPageComponent, canActivate: [authenticatedGuard] },
  { path: 'account', component: AccountPageComponent, canActivate: [authenticatedGuard] },
  { path: 'activity', redirectTo: 'billing', pathMatch: 'full' },
  { path: 'billing', component: BillingPageComponent, canActivate: [authenticatedGuard] },
  { path: 'help', component: HelpPageComponent, canActivate: [authenticatedGuard] },
  { path: 'projects/:projectId/services/:serviceId', component: ServiceDetailPageComponent, canActivate: [authenticatedGuard] },
  { path: 'projects/:projectId', component: ProjectDetailPageComponent, canActivate: [authenticatedGuard] },
  { path: 'admin', component: AdminPageComponent, canActivate: [adminGuard] },
  { path: '**', redirectTo: '' }
];
