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
        <h1 class="railway-page-title">Billing</h1>
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
            <li>Up to <strong>{{ p.projectsLimit }}</strong> projects</li>
            <li>Up to <strong>{{ p.servicesLimit }}</strong> services</li>
            <li><strong>{{ p.memoryMbLimit }} MB</strong> RAM pool</li>
            <li><strong>{{ p.storageGbLimit }} GB</strong> storage</li>
            <li><strong>{{ p.deploymentsLimit }}</strong> deploys / month</li>
            <li>Random *.cloudbase.website URLs + custom domains</li>
            <li>Community support</li>
          </ul>

          <div class="pill pill-amber" style="margin-top:16px;display:block">
            Pro is coming later. Every account uses Free for now.
          </div>
        }
      </section>

      <section class="panel svc-panel">
        <h3>Usage</h3>
        @if (usage(); as u) {
          <div class="billing-usage-list">
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">Projects</span>
                <strong>{{ u.projects }} / {{ plan()?.projectsLimit }}</strong>
              </div>
              <div class="meter"><span [style.width.%]="pct(u.projects, plan()?.projectsLimit)"></span></div>
            </div>
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">Services</span>
                <strong>{{ u.services }} / {{ plan()?.servicesLimit }}</strong>
              </div>
              <div class="meter"><span [style.width.%]="pct(u.services, plan()?.servicesLimit)"></span></div>
            </div>
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">Memory</span>
                <strong>{{ u.memoryMbUsed }} / {{ plan()?.memoryMbLimit }} MB</strong>
              </div>
              <div class="meter"><span [style.width.%]="pct(u.memoryMbUsed, plan()?.memoryMbLimit)"></span></div>
            </div>
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">Storage</span>
                <strong>{{ u.storageGbUsed }} / {{ plan()?.storageGbLimit }} GB</strong>
              </div>
              <div class="meter"><span [style.width.%]="pct(u.storageGbUsed, plan()?.storageGbLimit)"></span></div>
            </div>
            <div class="billing-usage-row">
              <div>
                <span class="metric-label">Deployments this month</span>
                <strong>{{ u.deploymentsThisMonth }} / {{ plan()?.deploymentsLimit }}</strong>
              </div>
              <div class="meter"><span [style.width.%]="pct(u.deploymentsThisMonth, plan()?.deploymentsLimit)"></span></div>
            </div>
          </div>
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

  ngOnInit() {
    if (!this.auth.user()) {
      this.router.navigate(['/auth']);
      return;
    }
    this.auth.getPlan().subscribe({ next: p => this.plan.set(p) });
    this.auth.usage().subscribe({ next: u => this.usage.set(u) });
  }

  pct(used: number, limit?: number): number {
    return Math.min(100, Math.round((used / Math.max(1, limit ?? 1)) * 100));
  }
}
