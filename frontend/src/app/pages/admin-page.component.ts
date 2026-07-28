import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../core/admin.service';
import { PortainerService, PortainerHostMetrics } from '../core/portainer.service';
import { ProjectRecord, UserAccount, AuditLogEntry } from '../core/models';
import { IconComponent } from '../shared/icon.component';

type AdminTab = 'governance' | 'approvals' | 'infrastructure' | 'audit';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="page">
      <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; margin-bottom: 28px;" class="page-header">
          <div>
            <p class="section-label">Admin Console</p>
            <h1 class="section-title">Platform Governance</h1>
            <p class="section-desc">Manage users, approve deployments, and monitor infrastructure health.</p>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="loadAll(); loadPortainerMetrics()">↻ Refresh</button>
        </div>

        <div class="tabs">
          <button class="tab" [class.active]="tab() === 'infrastructure'" (click)="tab.set('infrastructure')">Infrastructure</button>
          <button class="tab" [class.active]="tab() === 'approvals'" (click)="tab.set('approvals')">
            Pending Approvals
            <span *ngIf="pendingProjects().length" class="pill pill-amber" style="margin-left: 6px; padding: 2px 8px;">{{ pendingProjects().length }}</span>
          </button>
          <button class="tab" [class.active]="tab() === 'governance'" (click)="tab.set('governance')">User Governance</button>
          <button class="tab" [class.active]="tab() === 'audit'" (click)="tab.set('audit')">Audit Trail</button>
        </div>

        <section *ngIf="tab() === 'governance'">
          <div class="panel table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Deploy Access</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let user of users()">
                  <td class="cell-strong">{{ user.name }}</td>
                  <td class="muted">{{ user.email }}</td>
                  <td>
                    <span [class]="user.role === 'ADMIN' ? 'pill pill-violet' : 'pill pill-indigo'">{{ user.role }}</span>
                  </td>
                  <td>
                    <span [class]="user.deploymentEnabled ? 'pill pill-emerald' : 'pill pill-red'">
                      {{ user.deploymentEnabled ? 'Enabled' : 'Disabled' }}
                    </span>
                  </td>
                  <td class="cell-actions">
                    <button class="btn btn-sm" [class.btn-primary]="!user.deploymentEnabled" [class.btn-ghost]="user.deploymentEnabled" (click)="toggleAccess(user)">
                      {{ user.deploymentEnabled ? 'Disable' : 'Enable Deploy' }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section *ngIf="tab() === 'approvals'">
          <div *ngIf="pendingProjects().length === 0" class="panel" style="padding: 48px; text-align: center;">
            <div class="empty-state-icon">
              <app-icon name="check-circle" tone="emerald" size="lg"></app-icon>
            </div>
            <h3 style="margin: 0;">No pending approvals</h3>
            <p class="muted" style="margin: 8px 0 0;">All project requests have been processed.</p>
          </div>

          <div class="grid" style="gap: 20px;">
            <article class="panel panel-glow" style="padding: 28px;" *ngFor="let project of pendingProjects()">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
                <div>
                  <span class="pill pill-amber">Pending Approval</span>
                  <h3 style="margin: 12px 0 6px;">{{ project.name }}</h3>
                  <div class="muted" style="font-size: 13px;">Developer: {{ project.ownerName }}</div>
                </div>
                <span class="pill pill-indigo">{{ project.framework }}</span>
              </div>

              <div class="grid grid-2" style="margin: 20px 0;">
                <div class="meta-box">
                  <strong>Repository</strong>
                  <span style="font-size: 13px;">{{ project.repository }}</span>
                </div>
                <div class="meta-box">
                  <strong>Subdomain</strong>
                  <span style="font-size: 13px;">{{ project.subdomain }}</span>
                </div>
              </div>

              <div class="panel" style="padding: 16px; margin-bottom: 20px;">
                <p class="section-label" style="margin-bottom: 12px;">Configure Resource Quotas</p>
                <div class="grid grid-2">
                  <div class="field">
                    <label>CPU Limit (cores)</label>
                    <input type="text" [(ngModel)]="quotaCpu" placeholder="0.5">
                  </div>
                  <div class="field">
                    <label>RAM Limit</label>
                    <input type="text" [(ngModel)]="quotaRam" placeholder="512 MB">
                  </div>
                </div>
              </div>

              <div style="display: flex; gap: 10px;">
                <button class="btn btn-primary btn-with-icon" (click)="approve(project)">
                  <app-icon name="rocket" tone="violet" size="sm"></app-icon>
                  Approve &amp; Provision Stack
                </button>
              </div>
            </article>
          </div>
        </section>

        <section *ngIf="tab() === 'infrastructure'">
          <div class="metrics-bar">
            <span class="pill" [class.pill-emerald]="portainerOk()" [class.pill-red]="!portainerOk()" [class.pill-dot]="portainerOk()">
              {{ portainerOk() ? 'Live from Portainer' : 'Portainer offline' }}
            </span>
            <button class="btn btn-ghost btn-sm" (click)="loadPortainerMetrics()" [disabled]="metricsLoading()">
              {{ metricsLoading() ? 'Refreshing...' : '↻ Refresh metrics' }}
            </button>
          </div>

          <div *ngIf="portainerError()" class="pill pill-red" style="padding: 12px 16px; margin-bottom: 16px; border-radius: 12px;">
            {{ portainerError() }}
          </div>

          <div *ngIf="metricsLoading() && !portainer()" class="grid grid-4">
            <div class="panel stat-card" *ngFor="let label of metricLabels">
              <div class="stat-value">—</div>
              <div class="stat-label">{{ label }}</div>
            </div>
          </div>

          <ng-container *ngIf="portainer() as info">
            <div class="live-bar" style="margin-bottom: 20px;">
              <span>{{ info.endpointName }}</span>
              <span>·</span>
              <span>Endpoint #{{ info.endpointId }}</span>
              <span>·</span>
              <span>CPU: {{ info.totalCpu || '—' }} cores</span>
              <span>·</span>
              <span>RAM: {{ info.totalMemoryGb || '—' }} GB</span>
              <span>·</span>
              <span>Docker {{ info.dockerVersion }}</span>
            </div>

            <div class="grid grid-4">
              <div class="panel stat-card">
                <div class="stat-value">{{ info.runningContainers }} / {{ info.totalContainers }}</div>
                <div class="stat-label">Active Containers</div>
              </div>
              <div class="panel stat-card">
                <div class="stat-value">{{ info.stacks }}</div>
                <div class="stat-label">Active Stacks</div>
              </div>
              <div class="panel stat-card">
                <div class="stat-value">{{ info.images }}</div>
                <div class="stat-label">Docker Images</div>
              </div>
              <div class="panel stat-card">
                <div class="stat-value">{{ info.volumes }}</div>
                <div class="stat-label">Volumes</div>
              </div>
            </div>

            <div class="panel infra-summary">
              <div class="infra-summary-item">
                <span class="section-label">Connection</span>
                <span [class]="info.connected ? 'pill pill-emerald' : 'pill pill-red'">
                  {{ info.connected ? 'Connected' : 'Offline' }}
                </span>
              </div>
              <div class="infra-summary-item">
                <span class="section-label">Container Health</span>
                <div class="infra-summary-tags">
                  <span class="pill pill-emerald">{{ info.healthyContainers }} healthy</span>
                  <span *ngIf="info.unhealthyContainers" class="pill pill-red">{{ info.unhealthyContainers }} unhealthy</span>
                  <span *ngIf="stoppedContainers(info) > 0" class="pill pill-slate">{{ stoppedContainers(info) }} stopped</span>
                </div>
              </div>
            </div>
          </ng-container>
        </section>

        <section *ngIf="tab() === 'audit'">
          <div class="panel table-scroll">
            <table class="data-table audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let log of auditLogs()">
                  <td class="muted">{{ formatAuditTime(log.timestamp) }}</td>
                  <td>
                    <div class="cell-strong">{{ log.actorName }}</div>
                    <div class="muted" style="font-size: 12px;">{{ log.actorEmail }}</div>
                  </td>
                  <td>
                    <span [class]="auditActionClass(log.action)">{{ auditActionLabel(log.action) }}</span>
                  </td>
                  <td class="cell-strong">{{ log.target }}</td>
                  <td class="muted">{{ log.details }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `
})
export class AdminPageComponent implements OnInit {
  private readonly adminService = inject(AdminService);
  private readonly portainerService = inject(PortainerService);

  readonly tab = signal<AdminTab>('infrastructure');
  readonly users = signal<UserAccount[]>([]);
  readonly pendingProjects = signal<ProjectRecord[]>([]);
  readonly portainer = signal<PortainerHostMetrics | null>(null);
  readonly metricsLoading = signal(false);
  readonly portainerOk = signal(false);
  readonly portainerError = signal('');
  readonly metricLabels = ['Active Containers', 'Active Stacks', 'Docker Images', 'Volumes'];
  readonly auditLogs = signal<AuditLogEntry[]>([]);

  quotaCpu = '0.5';
  quotaRam = '512 MB';

  ngOnInit() {
    this.loadAll();
    this.loadPortainerMetrics();
  }

  loadAll() {
    this.adminService.users().subscribe((users) => this.users.set(users));
    this.adminService.pendingProjects().subscribe((projects) => this.pendingProjects.set(projects));
    this.adminService.auditLogs().subscribe((logs) => this.auditLogs.set(logs));
  }

  loadPortainerMetrics() {
    this.metricsLoading.set(true);
    this.portainerError.set('');

    this.portainerService.getHostMetrics().subscribe((metrics) => {
      this.metricsLoading.set(false);
      this.portainer.set(metrics);
      this.portainerOk.set(metrics.connected && !metrics.error);

      if (metrics.error) {
        this.portainerError.set(metrics.error);
      }
    });
  }

  toggleAccess(user: UserAccount) {
    this.adminService.setDeploymentAccess(user.id, !user.deploymentEnabled).subscribe(() => this.loadAll());
  }

  approve(project: ProjectRecord) {
    this.adminService.approveProject(project.id, { memory: this.quotaRam, cpu: this.quotaCpu }).subscribe(() => this.loadAll());
  }

  stoppedContainers(info: PortainerHostMetrics) {
    return Math.max(info.totalContainers - info.runningContainers, 0);
  }

  formatAuditTime(timestamp: string) {
    return new Date(timestamp).toLocaleString();
  }

  auditActionLabel(action: AuditLogEntry['action']) {
    switch (action) {
      case 'PROJECT_APPROVED': return 'Project Approved';
      case 'DEPLOY_ACCESS_ENABLED': return 'Deploy Enabled';
      case 'DEPLOY_ACCESS_DISABLED': return 'Deploy Disabled';
    }
  }

  auditActionClass(action: AuditLogEntry['action']) {
    switch (action) {
      case 'PROJECT_APPROVED': return 'pill pill-emerald';
      case 'DEPLOY_ACCESS_ENABLED': return 'pill pill-indigo';
      case 'DEPLOY_ACCESS_DISABLED': return 'pill pill-red';
    }
  }
}
