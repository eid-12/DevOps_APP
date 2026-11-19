import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../core/auth.service';
import { PublicLocaleService } from '../core/public-locale.service';
import { IconComponent, IconName, IconTone } from '../shared/icon.component';
import { environment } from '../../environments/environment';
import { catchError, of, timeout } from 'rxjs';
interface PlatformStatus { online: boolean; activeContainers: number; totalContainers: number; stacks: number; images: number; volumes: number; }
const stepIcons: IconName[] = ['github-link', 'shield-check', 'rocket'];
const stepTones: IconTone[] = ['indigo', 'emerald', 'violet'];
const featureIcons: IconName[] = ['pipeline', 'lock-shield', 'terminal-live'];
const featureTones: IconTone[] = ['amber', 'emerald', 'sky'];
@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent],
  template: `
    <div class="page">
      <section class="container hero">
        <div class="hero-grid">
          <div>
            <span class="pill pill-emerald pill-dot">{{ copy().badge }}</span>
            <h1 class="hero-title">{{ copy().headline }} <span>{{ copy().highlight }}</span></h1>
            <p class="hero-sub">{{ copy().description }}</p>
            <div class="hero-actions">
              <a *ngIf="!auth.isAuthenticated()" routerLink="/auth" [queryParams]="{ mode: 'register' }" class="btn btn-primary btn-lg">{{ copy().register }}</a>
              <a *ngIf="auth.isAuthenticated() && !auth.isAdmin()" routerLink="/dashboard" class="btn btn-primary btn-lg">{{ copy().dashboard }}</a>
              <a *ngIf="auth.isAdmin()" routerLink="/admin" class="btn btn-primary btn-lg">{{ copy().admin }}</a>
              <a *ngIf="!auth.isAuthenticated()" routerLink="/auth" [queryParams]="{ mode: 'login' }" class="btn btn-ghost btn-lg">{{ copy().login }}</a>
            </div>
            <p class="hero-note">{{ copy().note }}</p>
            <div class="live-bar" role="status" aria-live="polite"><span>{{ liveStatus() }}</span><span>·</span><span>{{ connectionLabel() }}</span></div>
          </div>
          <div class="terminal" aria-hidden="true" dir="ltr">
            <div class="terminal-bar"><span class="terminal-dot red"></span><span class="terminal-dot yellow"></span><span class="terminal-dot green"></span><span class="terminal-title">bash — ~/portfolio</span></div>
            <div class="terminal-body">
              <div><span class="prompt">you&#64;laptop:~/portfolio$</span> <span class="cmd">{{ typedCommand() }}</span><span class="cursor">▊</span></div>
              <div *ngFor="let line of visibleLines()" [class]="line.cls">{{ line.text }}</div>
            </div>
          </div>
        </div>
      </section>
      <section class="container section-spaced-sm">
        <div class="metrics-bar">
          <span class="pill" [class.pill-emerald]="portainerOk()" [class.pill-red]="!portainerOk()" [class.pill-dot]="portainerOk()">{{ portainerOk() ? copy().live : copy().unavailable }}</span>
          <button class="btn btn-ghost btn-sm" (click)="loadPortainerMetrics()" [disabled]="metricsLoading()">{{ metricsLoading() ? copy().refreshing : copy().refresh }}</button>
        </div>
        <div class="grid grid-4 landing-stats"><div class="panel stat-card" *ngFor="let stat of stats()"><div class="stat-value">{{ stat.value }}</div><div class="stat-label">{{ stat.label }}</div></div></div>
      </section>
      <section class="container section-spaced">
        <p class="section-label">{{ copy().how }}</p><h2 class="section-title">{{ copy().flow }}</h2>
        <div class="steps-flow section-gap">
          <ng-container *ngFor="let step of steps(); let i = index; let last = last">
            <article class="panel step-card"><app-icon [name]="step.icon" [tone]="step.tone" size="lg"></app-icon><div class="pill pill-slate">0{{ i + 1 }}</div><h3>{{ step.title }}</h3><p class="muted">{{ step.desc }}</p></article>
            <div class="step-arrow" *ngIf="!last" aria-hidden="true">{{ copy().arrow }}</div>
          </ng-container>
        </div>
      </section>
      <section class="container section-spaced">
        <p class="section-label">{{ copy().capabilities }}</p><h2 class="section-title">{{ copy().capabilitiesTitle }}</h2>
        <div class="grid grid-3 section-gap"><article class="panel panel-glow feature-card" *ngFor="let feat of features()">
          <app-icon [name]="feat.icon" [tone]="feat.tone"></app-icon><h3 class="feature-card-title">{{ feat.title }}</h3><p class="muted feature-card-desc">{{ feat.desc }}</p>
          <div class="feature-tags"><span class="pill pill-indigo" *ngFor="let tag of feat.tags">{{ tag }}</span></div>
        </article></div>
      </section>
      <section class="container section-spaced">
        <p class="section-label">{{ copy().infrastructure }}</p><h2 class="section-title">{{ copy().stackTitle }}</h2>
        <div class="stack-grid section-gap"><div class="stack-badge" *ngFor="let item of stack()"><strong>{{ item.role }}</strong>{{ item.name }}</div></div>
      </section>
      <section class="container section-spaced">
        <h2 class="section-title">{{ copy().projects }}</h2>
        <div class="grid grid-2 section-gap">
          <a class="panel public-project-link" [href]="locale.language() === 'ar' ? 'https://mawrid.cloudbase.website/ar/' : 'https://mawrid.cloudbase.website/'">{{ copy().mawrid }}</a>
          <a class="panel public-project-link" href="https://maps.cloudbase.website/">{{ copy().maps }}</a>
        </div>
      </section>
    </div>
  `
})
export class LandingPageComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  readonly locale = inject(PublicLocaleService);
  readonly copy = this.locale.copy;
  private readonly http = inject(HttpClient);
  private readonly metrics = signal<PlatformStatus | null>(null);
  readonly metricsLoading = signal(false);
  readonly portainerOk = computed(() => this.metrics()?.online ?? false);
  readonly liveStatus = computed(() => !this.metrics() ? this.copy().checking : this.portainerOk() ? this.copy().online : this.copy().offline);
  readonly connectionLabel = computed(() => !this.metrics() ? this.copy().moment : this.portainerOk() ? this.copy().runningCount.replace('{count}', String(this.metrics()!.activeContainers)) : this.copy().keepRunning);
  readonly stats = computed(() => {
    const m = this.metrics(), c = this.copy().statLabels, ok = m?.online;
    return [{ value: ok ? String(m.activeContainers) + ' / ' + String(m.totalContainers || m.activeContainers) : '— / —', label: c.containers },
      { value: ok ? String(m.stacks) : '—', label: c.stacks }, { value: ok ? String(m.images) : '—', label: c.images }, { value: ok ? String(m.volumes) : '—', label: c.volumes }];
  });
  readonly steps = computed(() => this.copy().steps.map((s, i) => ({ title: s[0], desc: s[1], icon: stepIcons[i], tone: stepTones[i] })));
  readonly features = computed<Array<{title: string; desc: string; tags: string[]; icon: IconName; tone: IconTone}>>(() => this.copy().features.map((f, i) => ({ ...f, tags: [...f.tags], icon: featureIcons[i], tone: featureTones[i] })));
  readonly stack = computed(() => ['Docker', 'Cloudflare', 'GitHub Actions', 'GHCR', 'PostgreSQL · MySQL · MongoDB · Redis', 'Spring Boot · Angular'].map((name, i) => ({ name, role: this.copy().stackRoles[i] })));
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
  readonly visibleLines = signal<{text: string; cls: string}[]>([]);
  private timers: ReturnType<typeof setTimeout>[] = [];
  ngOnInit() { this.runTerminalAnimation(); this.loadPortainerMetrics(); }
  ngOnDestroy() { this.timers.forEach(clearTimeout); }
  loadPortainerMetrics() {
    this.metricsLoading.set(true);
    const base = environment.apiBaseUrl || '/api';
    this.http.get<PlatformStatus>(base + '/public/platform-status', { headers: { 'X-Skip-Spinner': '1' } })
      .pipe(timeout(10000), catchError(() => of({online:false,activeContainers:0,totalContainers:0,stacks:0,images:0,volumes:0} satisfies PlatformStatus)))
      .subscribe(m => { this.metrics.set(m); this.metricsLoading.set(false); });
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
