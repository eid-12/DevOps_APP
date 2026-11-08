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
      @for (s of sections; track s.title) {
        <section class="panel svc-panel">
          <h3>{{ s.title }}</h3>
          <p class="muted u-text-13 u-mb-10">{{ s.body }}</p>
          @if (s.link) {
            <a class="btn btn-ghost btn-sm" appPressable [routerLink]="s.link">{{ s.cta }}</a>
          }
        </section>
      }
    </div>
  </div>
</div>
  `
})
export class HelpPageComponent {
  readonly sections: ReadonlyArray<{ title: string; body: string; link: string; cta: string }> = [
    {
      title: '1. Get Deploy access',
      body: 'New accounts can sign in and look around, but creating and deploying services stays locked until an admin enables Deploy for your account. The dashboard shows a notice while it is locked.',
      link: '/dashboard',
      cta: 'Open Dashboard'
    },
    {
      title: '2. Create a project',
      body: 'Projects are canvases. Use + New on the dashboard, then pick Empty, GitHub, Docker, or Database.',
      link: '/dashboard',
      cta: 'Open Dashboard'
    },
    {
      title: '3. Connect GitHub',
      body: 'Link GitHub in Account, then pick a repository you can push to. CloudBase adds a Dockerfile if there is none, a build workflow and a webhook, so every push deploys.',
      link: '/account',
      cta: 'Account → GitHub'
    },
    {
      title: '4. Deploy a service',
      body: 'Open a service → Deployments tab. Watch Logs, open Terminal when RUNNING, and manage Variables.',
      link: '/dashboard',
      cta: 'Go to projects'
    },
    {
      title: '5. Domains & networking',
      body: 'Each app service gets a random cloudbase*.cloudbase.website URL. Attach your own domain on the service Network tab.',
      link: '/dashboard',
      cta: 'Open projects'
    },
    {
      title: '6. Databases',
      body: 'Add a Database service, then copy the private connection URL from the service Overview (no public URL).',
      link: '/dashboard',
      cta: 'Open projects'
    },
    {
      title: '7. Plan & usage',
      body: 'Usage shows your Free plan pool: RAM, CPU and storage are enforced; project, service and deploy counts are not.',
      link: '/billing',
      cta: 'View usage'
    }
  ];
}
