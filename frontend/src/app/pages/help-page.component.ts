import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PressableDirective } from '../shared/directives/pressable.directive';

@Component({
  selector: 'app-help-page',
  standalone: true,
  imports: [CommonModule, RouterLink, PressableDirective],
  template: `
<div class="page railway-page">
  <div class="container account-wrap">
    <header class="railway-topbar">
      <div>
        <h1 class="railway-page-title">Help & Docs</h1>
        <p class="railway-page-sub">Quick guide for hosting on CloudBase</p>
      </div>
      <a routerLink="/dashboard" class="btn btn-ghost btn-sm" appPressable>← Dashboard</a>
    </header>

    <div class="help-grid">
      @for (s of sections; track s.title; let i = $index) {
        @if (i === 0) {
          <section class="panel svc-panel">
            <h3>{{ s.title }}</h3>
            <p class="muted u-text-13 u-mb-10">{{ s.body }}</p>
            @if (s.link) {
              <a class="btn btn-ghost btn-sm" appPressable [routerLink]="s.link" [queryParams]="s.queryParams || null">{{ s.cta }}</a>
            }
          </section>
        } @else {
          <!-- @defer: enter the body when the card scrolls into view -->
          @defer (on viewport; prefetch on idle) {
            <section class="panel svc-panel">
              <h3>{{ s.title }}</h3>
              <p class="muted u-text-13 u-mb-10">{{ s.body }}</p>
              @if (s.link) {
                <a class="btn btn-ghost btn-sm" appPressable [routerLink]="s.link" [queryParams]="s.queryParams || null">{{ s.cta }}</a>
              }
            </section>
          } @placeholder {
            <section class="panel svc-panel help-defer-placeholder">
              <p class="muted u-m-0">Loading…</p>
            </section>
          }
        }
      }
    </div>
  </div>
</div>
  `
})
export class HelpPageComponent {
  readonly sections = [
    {
      title: '1. Create a project',
      body: 'Projects are canvases. Use + New on the dashboard, then pick Empty, GitHub, Docker, or Database.',
      link: '/dashboard',
      cta: 'Open Dashboard',
      queryParams: undefined as Record<string, string> | undefined
    },
    {
      title: '2. Connect GitHub',
      body: 'Link GitHub in Account to deploy private repos and enable auto-deploy on push via GitHub Actions.',
      link: '/account',
      cta: 'Account → GitHub',
      queryParams: undefined as Record<string, string> | undefined
    },
    {
      title: '3. Deploy a service',
      body: 'Open a service → Deployments tab. Watch Logs, open Terminal when RUNNING, and manage Variables.',
      link: '/dashboard',
      cta: 'Go to projects',
      queryParams: undefined as Record<string, string> | undefined
    },
    {
      title: '4. Domains & networking',
      body: 'Each app service gets a random cloudbase*.cloudbase.website URL. Attach your own domain on the service Network tab.',
      link: '/dashboard',
      cta: 'Open projects',
      queryParams: undefined as Record<string, string> | undefined
    },
    {
      title: '5. Databases',
      body: 'Add a Database service, then copy the private connection URL from the service Overview (no public URL).',
      link: '/dashboard',
      cta: 'Open projects',
      queryParams: undefined as Record<string, string> | undefined
    },
    {
      title: '6. Plan & usage',
      body: 'Billing shows your Free plan limits (RAM, storage). Project, service, and deploy counts are open.',
      link: '/billing',
      cta: 'View Billing',
      queryParams: undefined as Record<string, string> | undefined
    }
  ];
}
