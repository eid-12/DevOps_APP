import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-help-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
<div class="page railway-page">
  <div class="container account-wrap">
    <header class="railway-topbar">
      <div>
        <h1 class="railway-page-title">Help & Docs</h1>
        <p class="railway-page-sub">Quick guide for hosting on CloudBase</p>
      </div>
      <a routerLink="/dashboard" class="btn btn-ghost btn-sm">← Dashboard</a>
    </header>

    <div class="help-grid">
      @for (s of sections; track s.title) {
        <section class="panel svc-panel">
          <h3>{{ s.title }}</h3>
          <p class="muted" style="font-size:13px;margin-bottom:10px">{{ s.body }}</p>
          @if (s.link) {
            <a class="btn btn-ghost btn-sm" [routerLink]="s.link">{{ s.cta }}</a>
          }
        </section>
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
      cta: 'Open Dashboard'
    },
    {
      title: '2. Connect GitHub',
      body: 'Link GitHub in Account to deploy private repos and enable auto-deploy on push.',
      link: '/account',
      cta: 'Account → GitHub'
    },
    {
      title: '3. Deploy a service',
      body: 'Open a service → Deploy. Watch Logs, open Terminal when RUNNING, and manage Variables.',
      link: '/dashboard',
      cta: 'Go to projects'
    },
    {
      title: '4. Domains & networking',
      body: 'Each app service gets a random numeric *.cloudbase.website URL. Attach your own domain under Network.',
      link: '/help',
      cta: 'Stay here'
    },
    {
      title: '5. Databases',
      body: 'Add a Database service, then copy the private connection URL from the service Overview.',
      link: '/help',
      cta: 'OK'
    },
    {
      title: '6. CLI & tokens',
      body: 'Create API tokens in Account for CI/CD. Billing shows plan limits.',
      link: '/billing',
      cta: 'View Billing'
    }
  ];
}
