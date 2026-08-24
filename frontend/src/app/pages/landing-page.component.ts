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
  portainerStatus: string;
  npmStatus: string;
  tunnelStatus: string;
  activeContainers: number;
  totalContainers: number;
  stacks: number;
  images: number;
  volumes: number;
  hostCpu: string;
  hostRam: string;
  dockerVersion: string;
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
            <p class="hero-note">No credit card required · Runs on your own hardware</p>

            <div class="live-bar">
              <span>{{ liveStatus() }}</span>
              <span>·</span>
              <span>CPU cores: {{ hostCpu() }}</span>
              <span>·</span>
              <span>RAM: {{ hostRam() }}</span>
              <span>·</span>
              <span>Docker: {{ dockerVersion() }}</span>
              <span>·</span>
              <span>{{ connectionLabel() }}</span>
            </div>
          </div>

          <div class="terminal">
            <div class="terminal-bar">
              <span class="terminal-dot red"></span>
              <span class="terminal-dot yellow"></span>
              <span class="terminal-dot green"></span>
              <span class="terminal-title">bash — cloudbase&#64;wsl-ubuntu</span>
            </div>
            <div class="terminal-body">
              <div><span class="prompt">cloudbase&#64;wsl:~$</span> <span class="cmd">{{ typedCommand() }}</span><span class="cursor">▊</span></div>
              <div *ngFor="let line of visibleLines()" [class]="line.cls">{{ line.text }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Platform Metrics -->
      <section class="container section-spaced-sm">
        <div class="metrics-bar">
          <span class="pill" [class.pill-emerald]="portainerOk()" [class.pill-red]="!portainerOk()" [class.pill-dot]="portainerOk()">
            {{ portainerOk() ? 'Live from Portainer' : 'Portainer offline' }}
          </span>
          <button class="btn btn-ghost btn-sm" (click)="loadPortainerMetrics()" [disabled]="metricsLoading()">
            {{ metricsLoading() ? 'Refreshing...' : '↻ Refresh metrics' }}
          </button>
        </div>
        <div class="grid grid-4">
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
            <h3 style="margin: 0 0 10px;">{{ feat.title }}</h3>
            <p class="muted" style="margin: 0; font-size: 14px; line-height: 1.65;">{{ feat.desc }}</p>
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
  readonly liveStatus = signal('Connecting to Mini PC...');
  readonly hostCpu = signal('—');
  readonly hostRam = signal('—');
  readonly dockerVersion = signal('—');
  readonly connectionLabel = signal('Checking...');

  readonly steps: Array<{ icon: IconName; tone: IconTone; title: string; desc: string }> = [
    { icon: 'github-link', tone: 'indigo', title: 'Link GitHub', desc: 'Connect your repository in one click using OAuth. CloudBase reads your code — nothing else.' },
    { icon: 'shield-check', tone: 'emerald', title: 'Admin Approves', desc: 'An admin activates your account, sets CPU & RAM quotas, and unlocks deployment capability.' },
    { icon: 'rocket', tone: 'violet', title: 'Automatic Deployment', desc: 'Every git push builds a new image and updates your live container automatically. SSL included.' }
  ];

  readonly features: Array<{ icon: IconName; tone: IconTone; title: string; desc: string; tags: string[] }> = [
    { icon: 'pipeline', tone: 'amber', title: 'Automated Pipelines', desc: 'GitHub Actions builds on every push. CloudBase injects Dockerfiles, workflows, and secrets — then Watchtower keeps containers current.', tags: ['Webhooks', 'CI/CD', 'Docker Hub'] },
    { icon: 'lock-shield', tone: 'emerald', title: 'Absolute Isolation', desc: 'Each project runs in a sandboxed container with a dynamically provisioned MySQL or PostgreSQL database. No cross-contamination.', tags: ['WSL2', 'Portainer', 'Per-Project DB'] },
    { icon: 'terminal-live', tone: 'sky', title: 'Real-time Streaming', desc: 'WebSocket-powered live console logs and active container shell access via xterm.js — monitor builds as they happen.', tags: ['WebSockets', 'xterm.js', 'Live Stats'] }
  ];

  readonly stack = [
    { role: 'Host OS', name: 'Windows 11 + WSL2' },
    { role: 'Container Runtime', name: 'Docker Desktop' },
    { role: 'Container API', name: 'Portainer CE' },
    { role: 'Reverse Proxy', name: 'Nginx Proxy Manager' },
    { role: 'Secure Ingress', name: 'Cloudflare Tunnel' },
    { role: 'Backend API', name: 'Spring Boot' },
    { role: 'Frontend UI', name: 'Angular 18+' },
    { role: 'Build Runner', name: 'GitHub Actions' }
  ];

  readonly terminalLines = [
    { text: 'Injecting Dockerfile → pushed to repo ✓', cls: 'success' },
    { text: 'GitHub Actions triggered → building image...', cls: '' },
    { text: '✓ Image built: cloudbase/portfolio-a9f1:latest', cls: 'success' },
    { text: '✓ Stack deployed via Portainer API', cls: 'success' },
    { text: '✓ SSL issued → portfolio.cloudbase.site', cls: 'success' },
    { text: '══ Live in 14.3 s ══', cls: 'highlight' }
  ];

  readonly fullCommand = 'cloudbase deploy ./portfolio-website --framework=angular';
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
            portainerStatus: 'disconnected',
            npmStatus: 'error',
            tunnelStatus: 'unknown',
            activeContainers: 0,
            totalContainers: 0,
            stacks: 0,
            images: 0,
            volumes: 0,
            hostCpu: '—',
            hostRam: '—',
            dockerVersion: '—'
          } satisfies PlatformStatus)
        )
      )
      .subscribe((metrics) => {
        this.metricsLoading.set(false);
        this.portainerOk.set(metrics.online);

        if (!metrics.online) {
          this.liveStatus.set('Portainer unreachable');
          this.connectionLabel.set('Offline');
          this.hostCpu.set('—');
          this.hostRam.set('—');
          this.dockerVersion.set('—');
          this.stats.set([
            { value: '— / —', label: 'Active Containers' },
            { value: '—', label: 'Active Stacks' },
            { value: '—', label: 'Docker Images' },
            { value: '—', label: 'Volumes' }
          ]);
          return;
        }

        this.liveStatus.set('Live from Mini PC');
        this.connectionLabel.set('System Healthy');
        this.hostCpu.set(metrics.hostCpu || '—');
        this.hostRam.set(metrics.hostRam || '—');
        this.dockerVersion.set(metrics.dockerVersion || '—');
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
