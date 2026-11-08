import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { PlanInfo, UsageSummary } from '../core/models';

@Component({
  selector: 'app-billing-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
<div class="page railway-page">
  <div class="container account-wrap">
    <header class="railway-topbar">
      <div>
        <h1 class="railway-page-title">Usage &amp; plan</h1>
        <p class="railway-page-sub">Free plan usage and limits</p>
      </div>
      <div class="railway-topbar-actions">
        <a routerLink="/account" class="btn btn-ghost btn-sm">Account</a>
        <a routerLink="/dashboard" class="btn btn-ghost btn-sm">← Dashboard</a>
      </div>
    </header>

    <div class="billing-grid">
      <section class="panel svc-panel">
        <div class="svc-panel-head">
          <h3>Plan</h3>
          <span class="pill pill-indigo">Free</span>
        </div>

        @if (plan(); as p) {
          <div class="plan-hero">
            <strong>{{ p.name }}</strong>
            <span>{{ p.priceLabel }}</span>
          </div>

          <ul class="plan-features">
            <li><strong>{{ p.memoryMbLimit }} MB</strong> RAM pool (enforced)</li>
            @if (usage()?.cpuMilliLimit) {
              <li><strong>{{ cores(usage()!.cpuMilliLimit) }}</strong> CPU pool (enforced)</li>
            }
            <li><strong>{{ p.storageGbLimit }} GB</strong> storage (enforced)</li>
            <li>Suggested: <strong>{{ p.projectsLimit }}</strong> projects, <strong>{{ p.servicesLimit }}</strong> services — not enforced</li>
            <li>Deploys per month — not limited</li>
            <li>Random cloudbase*.cloudbase.website URLs + custom domains</li>
            <li>Community support</li>
          </ul>

          <p class="plan-note">Every account is on the Free plan. There is nothing to pay and no upgrade to buy.</p>
        } @else if (planError()) {
          <p class="muted">Could not load plan details. Refresh the page to try again.</p>
        } @else {
          <p class="muted">Loading plan…</p>
        }
      </section>

      <section class="panel svc-panel">
        <h3>Usage</h3>
        @if (usage(); as u) {
          <div class="billing-usage-list">
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">Projects</span>
                <strong>{{ u.projects }}</strong>
              </div>
            </div>
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">Services</span>
                <strong>{{ u.services }}</strong>
              </div>
            </div>
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">Memory</span>
                <strong>{{ u.memoryMbUsed }} / {{ u.memoryMbLimit }} MB</strong>
              </div>
              <div class="meter"><span [style.width.%]="pct(u.memoryMbUsed, u.memoryMbLimit)"></span></div>
            </div>
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">CPU</span>
                <strong>{{ u.cpuMilliUsed }}m / {{ u.cpuMilliLimit }}m</strong>
              </div>
              <div class="meter"><span [style.width.%]="pct(u.cpuMilliUsed, u.cpuMilliLimit)"></span></div>
            </div>
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">Storage</span>
                <strong>{{ u.storageGbUsed }} / {{ u.storageGbLimit }} GB</strong>
              </div>
              <div class="meter"><span [style.width.%]="pct(u.storageGbUsed, u.storageGbLimit)"></span></div>
            </div>
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">Deployments this month</span>
                <strong>{{ u.deploymentsThisMonth }}</strong>
              </div>
            </div>
          </div>
        } @else if (usageError()) {
          <p class="muted">Could not load usage. Refresh the page to try again.</p>
        } @else {
          <p class="muted">Loading usage…</p>
        }
      </section>
    </div>
  </div>
</div>
  `
})
export class BillingPageComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly router = inject(Router);

  readonly plan = signal<PlanInfo | null>(null);
  readonly usage = signal<UsageSummary | null>(null);
  readonly planError = signal(false);
  readonly usageError = signal(false);

  ngOnInit() {
    if (!this.auth.user()) {
      this.router.navigate(['/auth']);
      return;
    }
    this.auth.getPlan().subscribe({ next: p => this.plan.set(p), error: () => this.planError.set(true) });
    this.auth.usage().subscribe({ next: u => this.usage.set(u), error: () => this.usageError.set(true) });
  }

  cores(milli: number): string {
    const n = milli / 1000;
    return `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? 'core' : 'cores'}`;
  }

  pct(used: number, limit?: number): number {
    return Math.min(100, Math.round((used / Math.max(1, limit ?? 1)) * 100));
  }
}
