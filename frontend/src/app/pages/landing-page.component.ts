import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../core/auth.service';
import { IconComponent, IconName, IconTone } from '../shared/icon.component';
import { environment } from '../../environments/environment';
import { catchError, of, timeout } from 'rxjs';

interface PlatformStatus {
  online: boolean;
  activeContainers: number;
  totalContainers: number;
  stacks: number;
  images: number;
  volumes: number;
}

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent],
  template: `
    <div class="page">
      <!-- Hero -->
      <section class="container hero">
        <div class="hero-grid">
          <div>
            <span class="pill pill-emerald pill-dot">Now live on cloudbase.website · Self-hosted · Zero cloud bills</span>
            <h1 class="hero-title">
              Deploy Your Apps on Our <span>Private Cloud Infrastructure</span> In Seconds.
            </h1>
            <p class="hero-sub">
              Zero configuration. Automated GitHub pipelines. Isolated Docker containers.
              Running entirely on secure private hardware — no AWS, no GCP, no cloud bills.
            </p>
            <div class="hero-actions">
              <a *ngIf="!auth.isAuthenticated()" routerLink="/auth" [queryParams]="{ mode: 'register' }" class="btn btn-primary btn-lg">Get Started Free</a>
              <a *ngIf="auth.isAuthenticated() && !auth.isAdmin()" routerLink="/dashboard" class="btn btn-primary btn-lg">Open Dashboard</a>
              <a *ngIf="auth.isAdmin()" routerLink="/admin" class="btn btn-primary btn-lg">Open Admin Console</a>
              <a *ngIf="!auth.isAuthenticated()" routerLink="/auth" [queryParams]="{ mode: 'login' }" class="btn btn-ghost btn-lg">Sign In</a>
              <a *ngIf="auth.isAuthenticated() && !auth.isAdmin()" routerLink="/dashboard" class="btn btn-ghost btn-lg">My Projects</a>
            </div>
            <p class="hero-note">No credit card required · Free plan for every account</p>

            <div class="live-bar" role="status" aria-live="polite">
              <span>{{ liveStatus() }}</span>
              <span>·</span>
              <span>{{ connectionLabel() }}</span>
            </div>
          </div>

          <div class="terminal" aria-hidden="true">
            <div class="terminal-bar">
              <span class="terminal-dot red"></span>
              <span class="terminal-dot yellow"></span>
              <span class="terminal-dot green"></span>
              <span class="terminal-title">bash — ~/portfolio</span>
            </div>
            <div class="terminal-body">
              <div><span class="prompt">you&#64;laptop:~/portfolio$</span> <span class="cmd">{{ typedCommand() }}</span><span class="cursor">▊</span></div>
              <div *ngFor="let line of visibleLines()" [class]="line.cls">{{ line.text }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Platform Metrics -->
      <section class="container section-spaced-sm">
        <div class="metrics-bar">
          <span class="pill" [class.pill-emerald]="portainerOk()" [class.pill-red]="!portainerOk()" [class.pill-dot]="portainerOk()">
            {{ portainerOk() ? 'Live platform status' : 'Status unavailable' }}
          </span>
          <button class="btn btn-ghost btn-sm" (click)="loadPortainerMetrics()" [disabled]="metricsLoading()">
            {{ metricsLoading() ? 'Refreshing...' : '↻ Refresh metrics' }}
          </button>
        </div>
        <div class="grid grid-4 landing-stats">
          <div class="panel stat-card" *ngFor="let stat of stats()">
            <div class="stat-value">{{ stat.value }}</div>
            <div class="stat-label">{{ stat.label }}</div>
          </div>
        </div>
      </section>

      <!-- How It Works -->
      <section class="container section-spaced">
        <p class="section-label">How It Works</p>
        <h2 class="section-title">Infrastructure Flow</h2>
        <div class="steps-flow section-gap">
          <ng-container *ngFor="let step of steps; let i = index; let last = last">
            <article class="panel step-card">
              <app-icon [name]="step.icon" [tone]="step.tone" size="lg"></app-icon>
              <div class="pill pill-slate">0{{ i + 1 }}</div>
              <h3>{{ step.title }}</h3>
              <p class="muted">{{ step.desc }}</p>
            </article>
            <div class="step-arrow" *ngIf="!last" aria-hidden="true">→</div>
          </ng-container>
        </div>
      </section>

      <!-- Core Capabilities -->
      <section class="container section-spaced">
        <p class="section-label">Core Capabilities</p>
        <h2 class="section-title">Everything you need, nothing you don't</h2>
        <div class="grid grid-3 section-gap">
          <article class="panel panel-glow feature-card" *ngFor="let feat of features">
            <app-icon [name]="feat.icon" [tone]="feat.tone"></app-icon>
            <h3 class="feature-card-title">{{ feat.title }}</h3>
            <p class="muted feature-card-desc">{{ feat.desc }}</p>
            <div class="feature-tags">
              <span class="pill pill-indigo" *ngFor="let tag of feat.tags">{{ tag }}</span>
            </div>
          </article>
        </div>
      </section>

      <!-- Infrastructure Stack -->
      <section class="container section-spaced">
        <p class="section-label">Infrastructure Stack</p>
        <h2 class="section-title">Battle-tested open-source, zero vendor lock-in</h2>
        <div class="stack-grid section-gap">
          <div class="stack-badge" *ngFor="let item of stack">
            <strong>{{ item.role }}</strong>
            {{ item.name }}
          </div>
        </div>
      </section>
    </div>
  `
})
export class LandingPageComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  readonly stats = signal([
    { value: '— / —', label: 'Active Containers' },
    { value: '—', label: 'Active Stacks' },
    { value: '—', label: 'Docker Images' },
    { value: '—', label: 'Volumes' }
  ]);

  readonly metricsLoading = signal(false);
  readonly portainerOk = signal(false);
  readonly liveStatus = signal('Checking platform status…');
  readonly connectionLabel = signal('One moment');

  readonly steps: Array<{ icon: IconName; tone: IconTone; title: string; desc: string }> = [
    { icon: 'github-link', tone: 'indigo', title: 'Link GitHub', desc: 'Connect GitHub with OAuth and pick a repository you can push to. CloudBase adds a Dockerfile if it has none, a build workflow and a deploy webhook.' },
    { icon: 'shield-check', tone: 'emerald', title: 'Admin Approves', desc: 'An admin enables Deploy for your account. Every account gets the same fixed RAM, CPU and storage pool.' },
    { icon: 'rocket', tone: 'violet', title: 'Automatic Deployment', desc: 'Every git push builds a new image with GitHub Actions and rolls out your container over HTTPS.' }
  ];

  readonly features: Array<{ icon: IconName; tone: IconTone; title: string; desc: string; tags: string[] }> = [
    { icon: 'pipeline', tone: 'amber', title: 'Automated Pipelines', desc: 'GitHub Actions builds on every push and publishes the image to the GitHub Container Registry of that same repository. CloudBase never writes secrets into your repository.', tags: ['Webhooks', 'GitHub Actions', 'GHCR'] },
    { icon: 'lock-shield', tone: 'emerald', title: 'Project Isolation', desc: 'Each project gets its own Docker network and every service its own container with CPU and RAM limits. Add PostgreSQL, MySQL, MongoDB or Redis as private services.', tags: ['Per-project network', 'Resource limits', 'Private databases'] },
    { icon: 'terminal-live', tone: 'sky', title: 'Live deploy trail', desc: 'Watch Queued → Building → Deploying → Verify on the service page, then open container logs and an HTTP shell when the stack is running.', tags: ['Deploy stages', 'Logs', 'Exec'] }
  ];

  readonly stack = [
    // Product-level choices only: naming the host OS, runtime or admin panels would help attackers fingerprint it.
    { role: 'Containers', name: 'Docker' },
    { role: 'Edge & HTTPS', name: 'Cloudflare' },
    { role: 'Builds', name: 'GitHub Actions' },
    { role: 'Registry', name: 'GitHub Container Registry' },
    { role: 'Databases', name: 'PostgreSQL · MySQL · MongoDB · Redis' },
    { role: 'Platform', name: 'Spring Boot · Angular' }
  ];

  readonly terminalLines = [
    { text: 'GitHub Actions → building image...', cls: '' },
    { text: '✓ Published ghcr.io/you/portfolio:3f9c2a1', cls: 'success' },
    { text: '✓ Webhook received → deploy queued', cls: 'success' },
    { text: '✓ Container started on an isolated network', cls: 'success' },
    { text: '✓ HTTPS live → cloudbase8472.cloudbase.website', cls: 'success' },
    { text: '══ Deploy succeeded ══', cls: 'highlight' }
  ];

  readonly fullCommand = 'git push origin main';
  readonly typedCommand = signal('');
  readonly visibleLines = signal<{ text: string; cls: string }[]>([]);

  private timers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit() {
    this.runTerminalAnimation();
    this.loadPortainerMetrics();
  }

  ngOnDestroy() {
    this.timers.forEach(clearTimeout);
  }

  loadPortainerMetrics() {
    this.metricsLoading.set(true);
    const base = environment.apiBaseUrl || '/api';
    this.http
      .get<PlatformStatus>(`${base}/public/platform-status`, {
        headers: { 'X-Skip-Spinner': '1' }
      })
      .pipe(
        timeout(10000),
        catchError(() =>
          of({
            online: false,
            activeContainers: 0,
            totalContainers: 0,
            stacks: 0,
            images: 0,
            volumes: 0
          } satisfies PlatformStatus)
        )
      )
      .subscribe((metrics) => {
        this.metricsLoading.set(false);
        this.portainerOk.set(metrics.online);

        if (!metrics.online) {
          this.liveStatus.set('Live status is unavailable right now');
          this.connectionLabel.set('Deployed apps keep running');
          this.stats.set([
            { value: '— / —', label: 'Active Containers' },
            { value: '—', label: 'Active Stacks' },
            { value: '—', label: 'Docker Images' },
            { value: '—', label: 'Volumes' }
          ]);
          return;
        }

        this.liveStatus.set('All systems operational');
        this.connectionLabel.set(`${metrics.activeContainers} containers running`);
        this.stats.set([
          {
            value: `${metrics.activeContainers} / ${metrics.totalContainers || metrics.activeContainers}`,
            label: 'Active Containers'
          },
          { value: `${metrics.stacks}`, label: 'Active Stacks' },
          { value: `${metrics.images}`, label: 'Docker Images' },
          { value: `${metrics.volumes}`, label: 'Volumes' }
        ]);
      });
  }

  private runTerminalAnimation() {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.typedCommand.set(this.fullCommand);
      this.visibleLines.set([...this.terminalLines]);
      return;
    }
    let charIndex = 0;
    const typeChar = () => {
      if (charIndex <= this.fullCommand.length) {
        this.typedCommand.set(this.fullCommand.slice(0, charIndex));
        charIndex++;
        this.timers.push(setTimeout(typeChar, 45));
      } else {
        this.revealLines();
      }
    };
    this.timers.push(setTimeout(typeChar, 600));
  }

  private revealLines() {
    this.terminalLines.forEach((line, i) => {
      this.timers.push(setTimeout(() => {
        this.visibleLines.update(lines => [...lines, line]);
      }, 400 + i * 500));
    });
  }
}
