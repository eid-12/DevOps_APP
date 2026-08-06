import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../core/admin.service';
import { PortainerService, PortainerHostMetrics } from '../core/portainer.service';
import { UserAccount, AuditLogEntry } from '../core/models';
import { IconComponent } from '../shared/icon.component';

type AdminTab = 'governance' | 'infrastructure' | 'audit';

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="page">
      <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; margin-bottom: 28px;" class="page-header">
          <div>
            <p class="section-label">Admin Console</p>
            <h1 class="section-title">Platform Governance</h1>
            <p class="section-desc">Manage users and monitor infrastructure health.</p>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="loadAll(); loadPortainerMetrics()">↻ Refresh</button>
        </div>

        <div class="tabs">
          <button class="tab" [class.active]="tab() === 'infrastructure'" (click)="tab.set('infrastructure')">Infrastructure</button>
          <button class="tab" [class.active]="tab() === 'governance'" (click)="tab.set('governance')">User Governance</button>
          <button class="tab" [class.active]="tab() === 'audit'" (click)="tab.set('audit')">Audit Trail</button>
        </div>

        <!-- Governance Tab -->
        @if (tab() === 'governance') {
          <section>
            <div class="panel" style="padding: 18px; margin-bottom: 16px;">
              <div class="grid grid-4 admin-filters">
                <div class="field">
                  <label>Search Users</label>
                  <input [(ngModel)]="searchQuery" placeholder="Name or email">
                </div>
                <div class="field">
                  <label>Role</label>
                  <select [(ngModel)]="roleFilter" class="admin-filter-select">
                    <option value="ALL">All roles</option>
                    <option value="ADMIN">Admin</option>
                    <option value="USER">User</option>
                  </select>
                </div>
                <div class="field">
                  <label>Account Status</label>
                  <select [(ngModel)]="accountStatusFilter" class="admin-filter-select">
                    <option value="ALL">All statuses</option>
                    <option value="PENDING_ACTIVATION">Pending Activation</option>
                    <option value="ACTIVE">Active</option>
                    <option value="SUSPENDED">Suspended</option>
                  </select>
                </div>
                <div class="field">
                  <label>Deployment</label>
                  <select [(ngModel)]="deploymentFilter" class="admin-filter-select">
                    <option value="ALL">All access</option>
                    <option value="ENABLED">Enabled</option>
                    <option value="DISABLED">Disabled</option>
                  </select>
                </div>
                <div class="field">
                  <label>Email</label>
                  <select [(ngModel)]="emailFilter" class="admin-filter-select">
                    <option value="ALL">All emails</option>
                    <option value="VERIFIED">Verified</option>
                    <option value="UNVERIFIED">Unverified</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="panel table-scroll">
              <table class="data-table audit-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Email Status</th>
                    <th>Role</th>
                    <th>Account Status</th>
                    <th>Deployment Status</th>
                    <th>Account Actions</th>
                    <th>Access / Role</th>
                  </tr>
                </thead>
                <tbody>
                  @for (user of filteredUsers(); track user.id) {
                    <tr>
                      <td class="cell-strong">{{ user.name }}</td>
                      <td class="muted">{{ user.email }}</td>
                      <td>
                        <span [class]="emailVerifiedClass(user)">{{ emailVerifiedLabel(user) }}</span>
                      </td>
                      <td><span [class]="roleClass(user)">{{ user.role }}</span></td>
                      <td><span [class]="accountStatusClass(user)">{{ accountStatusLabel(user) }}</span></td>
                      <td><span [class]="deploymentStatusClass(user)">{{ deploymentStatusLabel(user) }}</span></td>
                      <td>
                        <div class="admin-actions-stack">
                          <button
                            class="btn btn-sm btn-ghost"
                            (click)="activateAccount(user)"
                            [disabled]="user.accountStatus === 'ACTIVE' || !user.emailVerified"
                            [title]="!user.emailVerified ? 'User must verify email first' : 'Mark account active'"
                          >
                            Activate
                          </button>
                          <button class="btn btn-sm btn-danger-soft" (click)="suspendAccount(user)" [disabled]="user.accountStatus === 'SUSPENDED'">
                            Suspend
                          </button>
                          <button class="btn btn-sm btn-ghost" (click)="sendPasswordReset(user)">
                            Reset Password
                          </button>
                        </div>
                      </td>
                      <td>
                        <div class="admin-actions-stack">
                          @if (user.role !== 'ADMIN') {
                            <button
                              class="btn btn-sm"
                              [class.btn-primary]="!user.deploymentEnabled"
                              [class.btn-ghost]="user.deploymentEnabled"
                              (click)="toggleAccess(user)"
                              [disabled]="user.accountStatus !== 'ACTIVE' || !user.emailVerified"
                              [title]="user.deploymentEnabled ? 'Lock deployments' : 'Approve deployments for this user'"
                            >
                              {{ user.deploymentEnabled ? 'Disable Deploy' : 'Enable Deploy' }}
                            </button>
                          }
                          <button class="btn btn-sm btn-ghost" (click)="toggleRole(user)">
                            {{ user.role === 'ADMIN' ? 'Make User' : 'Make Admin' }}
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                  @if (filteredUsers().length === 0) {
                    <tr>
                      <td colspan="8" class="muted" style="text-align: center; padding: 24px;">No users match the current filters.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            @if (governanceMessage()) {
              <div class="pill" [class.pill-emerald]="governanceMessageKind() === 'success'" [class.pill-red]="governanceMessageKind() === 'error'"
                   style="padding: 12px 16px; margin-top: 16px; border-radius: 12px;">
                {{ governanceMessage() }}
              </div>
            }
          </section>
        }

        <!-- Infrastructure Tab -->
        @if (tab() === 'infrastructure') {
          <section>
            <div class="metrics-bar">
              <span class="pill" [class.pill-emerald]="portainerOk()" [class.pill-red]="!portainerOk()" [class.pill-dot]="portainerOk()">
                {{ portainerOk() ? 'Live from Portainer' : 'Portainer offline' }}
              </span>
              <button class="btn btn-ghost btn-sm" (click)="loadPortainerMetrics()" [disabled]="metricsLoading()">
                {{ metricsLoading() ? 'Refreshing...' : '↻ Refresh metrics' }}
              </button>
            </div>

            @if (portainerError()) {
              <div class="pill pill-red" style="padding: 12px 16px; margin-bottom: 16px; border-radius: 12px;">
                {{ portainerError() }}
              </div>
            }

            @if (metricsLoading() && !portainer()) {
              <div class="grid grid-4">
                @for (label of metricLabels; track label) {
                  <div class="panel stat-card">
                    <div class="stat-value">—</div>
                    <div class="stat-label">{{ label }}</div>
                  </div>
                }
              </div>
            }

            @if (portainer(); as info) {
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
                    @if (info.unhealthyContainers) {
                      <span class="pill pill-red">{{ info.unhealthyContainers }} unhealthy</span>
                    }
                    @if (stoppedContainers(info) > 0) {
                      <span class="pill pill-slate">{{ stoppedContainers(info) }} stopped</span>
                    }
                  </div>
                </div>
              </div>
            }
          </section>
        }

        <!-- Audit Trail Tab -->
        @if (tab() === 'audit') {
          <section>
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
                  @for (log of auditLogs(); track log.id) {
                    <tr>
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
                  }
                  @if (auditLogs().length === 0) {
                    <tr>
                      <td colspan="5" class="muted" style="text-align: center; padding: 24px;">No audit events yet.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
      </div>
    </div>
  `
})
export class AdminPageComponent implements OnInit {
  private readonly adminService = inject(AdminService);
  private readonly portainerService = inject(PortainerService);

  readonly tab = signal<AdminTab>('infrastructure');
  readonly users = signal<UserAccount[]>([]);
  readonly auditLogs = signal<AuditLogEntry[]>([]);
  readonly portainer = signal<PortainerHostMetrics | null>(null);
  readonly metricsLoading = signal(false);
  readonly portainerOk = signal(false);
  readonly portainerError = signal('');
  readonly metricLabels = ['Active Containers', 'Active Stacks', 'Docker Images', 'Volumes'];
  readonly governanceMessage = signal('');
  readonly governanceMessageKind = signal<'success' | 'error'>('success');

  searchQuery = '';
  roleFilter: 'ALL' | UserAccount['role'] = 'ALL';
  accountStatusFilter: 'ALL' | UserAccount['accountStatus'] = 'ALL';
  deploymentFilter: 'ALL' | 'ENABLED' | 'DISABLED' = 'ALL';
  emailFilter: 'ALL' | 'VERIFIED' | 'UNVERIFIED' = 'ALL';

  ngOnInit() {
    this.loadAll();
    this.loadPortainerMetrics();
  }

  loadAll() {
    this.adminService.users().subscribe({
      next: users => this.users.set(users ?? []),
      error: e => {
        this.users.set([]);
        this.setGovernanceMessage(e?.error?.message ?? 'Failed to load users from API.', 'error');
      }
    });
    this.adminService.auditLogs().subscribe({
      next: logs => this.auditLogs.set(logs ?? []),
      error: () => this.auditLogs.set([])
    });
  }

  loadPortainerMetrics() {
    this.metricsLoading.set(true);
    this.portainerError.set('');
    this.portainerService.getHostMetrics().subscribe(metrics => {
      this.metricsLoading.set(false);
      this.portainer.set(metrics);
      this.portainerOk.set(metrics.connected && !metrics.error);
      if (metrics.error) this.portainerError.set(metrics.error);
    });
  }

  toggleAccess(user: UserAccount) {
    this.adminService.setDeploymentAccess(user.id, !user.deploymentEnabled).subscribe({
      next: () => { this.setGovernanceMessage(`Deploy ${user.deploymentEnabled ? 'disabled' : 'enabled'} for ${user.name}.`); this.loadAll(); },
      error: e => this.setGovernanceMessage(e?.error?.message ?? 'Failed.', 'error')
    });
  }

  activateAccount(user: UserAccount) {
    if (!user.emailVerified) {
      this.setGovernanceMessage('Cannot activate until the user verifies their email.', 'error');
      return;
    }
    this.adminService.setAccountStatus(user.id, 'ACTIVE').subscribe({
      next: () => { this.setGovernanceMessage(`${user.name} is now active.`); this.loadAll(); },
      error: e => this.setGovernanceMessage(e?.error?.message ?? 'Failed.', 'error')
    });
  }

  suspendAccount(user: UserAccount) {
    this.adminService.setAccountStatus(user.id, 'SUSPENDED').subscribe({
      next: () => { this.setGovernanceMessage(`${user.name} suspended.`); this.loadAll(); },
      error: e => this.setGovernanceMessage(e?.error?.message ?? 'Failed.', 'error')
    });
  }

  sendPasswordReset(user: UserAccount) {
    this.adminService.sendPasswordReset(user.id).subscribe({
      next: (res) => {
        const msg = (res as { message?: string })?.message ?? `Password reset link sent to ${user.email}.`;
        this.setGovernanceMessage(msg);
        this.loadAll();
      },
      error: e => this.setGovernanceMessage(e?.error?.message ?? 'Failed to send reset link.', 'error')
    });
  }

  toggleRole(user: UserAccount) {
    const nextRole = user.role === 'ADMIN' ? 'USER' : 'ADMIN';
    this.adminService.updateRole(user.id, nextRole).subscribe({
      next: () => { this.setGovernanceMessage(`${user.name} role → ${nextRole}.`); this.loadAll(); },
      error: e => this.setGovernanceMessage(e?.error?.message ?? 'Failed.', 'error')
    });
  }

  stoppedContainers(info: PortainerHostMetrics) {
    return Math.max(info.totalContainers - info.runningContainers, 0);
  }

  filteredUsers() {
    const q = this.searchQuery.trim().toLowerCase();
    return this.users().filter(user => {
      const matchQ = !q || user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q);
      const matchRole = this.roleFilter === 'ALL' || user.role === this.roleFilter;
      const matchStatus = this.accountStatusFilter === 'ALL' || user.accountStatus === this.accountStatusFilter;
      const matchDeploy = this.deploymentFilter === 'ALL'
        || (this.deploymentFilter === 'ENABLED' && user.deploymentEnabled)
        || (this.deploymentFilter === 'DISABLED' && !user.deploymentEnabled);
      const verified = !!user.emailVerified;
      const matchEmail = this.emailFilter === 'ALL'
        || (this.emailFilter === 'VERIFIED' && verified)
        || (this.emailFilter === 'UNVERIFIED' && !verified);
      return matchQ && matchRole && matchStatus && matchDeploy && matchEmail;
    });
  }

  roleClass(user: UserAccount) { return user.role === 'ADMIN' ? 'pill pill-violet' : 'pill pill-indigo'; }
  accountStatusLabel(user: UserAccount) {
    return { PENDING_ACTIVATION: 'Pending Activation', ACTIVE: 'Active', SUSPENDED: 'Suspended' }[user.accountStatus];
  }
  accountStatusClass(user: UserAccount) {
    return { PENDING_ACTIVATION: 'pill pill-amber', ACTIVE: 'pill pill-emerald', SUSPENDED: 'pill pill-red' }[user.accountStatus];
  }
  deploymentStatusLabel(user: UserAccount) { return user.deploymentEnabled ? 'Enabled' : 'Disabled'; }
  deploymentStatusClass(user: UserAccount) { return user.deploymentEnabled ? 'pill pill-emerald' : 'pill pill-red'; }
  emailVerifiedLabel(user: UserAccount) { return user.emailVerified ? 'Verified' : 'Unverified'; }
  emailVerifiedClass(user: UserAccount) { return user.emailVerified ? 'pill pill-emerald' : 'pill pill-amber'; }

  formatAuditTime(timestamp: string) {
    return new Date(timestamp).toLocaleString();
  }

  auditActionLabel(action: AuditLogEntry['action']) {
    const labels: Record<AuditLogEntry['action'], string> = {
      PROJECT_CREATED: 'Project Created',
      SERVICE_CREATED: 'Service Created',
      SERVICE_DEPLOYED: 'Service Deployed',
      SERVICE_STOPPED: 'Service Stopped',
      SERVICE_DELETED: 'Service Deleted',
      DEPLOY_ACCESS_ENABLED: 'Deploy Enabled',
      DEPLOY_ACCESS_DISABLED: 'Deploy Disabled',
      ACCOUNT_ACTIVATED: 'Account Activated',
      ACCOUNT_SUSPENDED: 'Account Suspended',
      PASSWORD_RESET_SENT: 'Password Reset',
      ROLE_CHANGED: 'Role Changed'
    };
    return labels[action] ?? action;
  }

  auditActionClass(action: AuditLogEntry['action']) {
    switch (action) {
      case 'ACCOUNT_ACTIVATED':
      case 'DEPLOY_ACCESS_ENABLED':
      case 'PROJECT_CREATED':
      case 'SERVICE_DEPLOYED':
        return 'pill pill-emerald';
      case 'ACCOUNT_SUSPENDED':
      case 'DEPLOY_ACCESS_DISABLED':
      case 'SERVICE_DELETED':
        return 'pill pill-red';
      case 'ROLE_CHANGED':
        return 'pill pill-violet';
      case 'SERVICE_CREATED':
        return 'pill pill-indigo';
      default:
        return 'pill pill-slate';
    }
  }

  private setGovernanceMessage(message: string, kind: 'success' | 'error' = 'success') {
    this.governanceMessageKind.set(kind);
    this.governanceMessage.set(message);
  }
}
