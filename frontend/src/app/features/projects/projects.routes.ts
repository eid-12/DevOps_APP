import { Routes } from '@angular/router';
import { authenticatedGuard } from '../../core/auth.guard';

/** Developer project canvas + service detail pages */
export const PROJECTS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: '/dashboard'
  },
  {
    path: ':projectId',
    title: 'Project · CloudBase',
    canActivate: [authenticatedGuard],
    data: { preload: true },
    loadComponent: () =>
      import('../../pages/project-detail-page.component').then(m => m.ProjectDetailPageComponent)
  },
  {
    path: ':projectId/services/:serviceId',
    title: 'Service · CloudBase',
    canActivate: [authenticatedGuard],
    data: { preload: true },
    loadComponent: () =>
      import('../../pages/service-detail-page.component').then(m => m.ServiceDetailPageComponent)
  }
];
