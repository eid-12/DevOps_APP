import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminService } from '../core/admin.service';
import { AuthService } from '../core/auth.service';
import { PortainerService, PortainerHostMetrics } from '../core/portainer.service';
import { UserAccount, AuditLogEntry, HostingSettings, HostingSettingsUpdate } from '../core/models';
import { IconComponent } from '../shared/icon.component';
import { StyledSelectComponent, StyledSelectOption } from '../shared/styled-select.component';
import { TimeAgoPipe } from '../shared/pipes/time-ago.pipe';
import { TruncatePipe } from '../shared/pipes/truncate.pipe';
import { PressableDirective } from '../shared/directives/pressable.directive';

type AdminTab = 'account' | 'hosting' | 'governance' | 'infrastructure' | 'audit';

const STRONG_PASSWORD = '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&#._-]).{8,}$';

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    StyledSelectComponent,
    TimeAgoPipe,
    TruncatePipe,
    PressableDirective
  ],
  template: `
    <div class="page">
      <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; margin-bottom: 28px;" class="page-header">
          <div>
            <p class="section-label">Admin Console</p>
            <h1 class="section-title">Platform Governance</h1>
            <p class="section-desc">Account, hosting tokens, users, and infrastructure.</p>
          </div>
          <button class="btn btn-ghost btn-sm" appPressable (click)="refreshActive()">↻ Refresh</button>
        </div>

        <div class="tabs">
          <button class="tab" appPressable [class.active]="tab() === 'infrastructure'" (click)="setTab('infrastructure')">Infrastructure</button>
          <button class="tab" appPressable [class.active]="tab() === 'governance'" (click)="setTab('governance')">User Governance</button>
          <button class="tab" appPressable [class.active]="tab() === 'audit'" (click)="setTab('audit')">Audit Trail</button>
          <button class="tab" appPressable [class.active]="tab() === 'hosting'" (click)="setTab('hosting')">Hosting</button>
          <button class="tab" appPressable [class.active]="tab() === 'account'" (click)="setTab('account')">Account</button>
        </div>

        <!-- Account Tab -->
        @if (tab() === 'account') {
          <section class="admin-account-grid">
            <div class="panel" style="padding: 20px;">
              <h3 style="margin-top:0">Profile</h3>
              <form #profileForm="ngForm" (ngSubmit)="saveAdminProfile(profileForm)" novalidate>
                <div class="field">
                  <label for="admin-name">Full name</label>
                  <input id="admin-name" name="name" required minlength="2" [(ngModel)]="adminName" #nameCtrl="ngModel" />
                  @if (nameCtrl.invalid && (nameCtrl.dirty || profileForm.submitted)) {
                    <small class="auth-error">Name is required (2+ characters).</small>
                  }
                </div>
                <div class="field">
                  <label for="admin-email">Email</label>
                  <input id="admin-email" [ngModel]="adminEmail" [ngModelOptions]="{standalone:true}" disabled readonly />
                </div>
                <div class="field">
                  <label>Role</label>
                  <span class="pill pill-red">ADMIN</span>
                </div>
                <button type="submit" class="btn btn-primary" appPressable [disabled]="savingProfile() || profileForm.invalid">
                  {{ savingProfile() ? 'Saving…' : 'Save Profile' }}
                </button>
              </form>
            </div>

            <div class="panel" style="padding: 20px;">
              <h3 style="margin-top:0">Security</h3>
              <form #pwdForm="ngForm" (ngSubmit)="saveAdminPassword(pwdForm)" novalidate>
                <div class="field">
                  <label for="admin-cur">Current password</label>
                  <input id="admin-cur" name="currentPassword" type="password" required [(ngModel)]="adminCurrentPassword" />
                </div>
                <div class="field">
                  <label for="admin-new">New password</label>
                  <input id="admin-new" name="newPassword" type="password" required [attr.pattern]="passwordPattern" [(ngModel)]="adminNewPassword" #np="ngModel" />
                  @if (np.errors?.['pattern'] && (np.dirty || pwdForm.submitted)) {
                    <small class="auth-error">Need upper, lower, digit, and special character (8+).</small>
                  }
                </div>
                <div class="field">
                  <label for="admin-confirm">Confirm password</label>
                  <input id="admin-confirm" name="confirmPassword" type="password" required [(ngModel)]="adminConfirmPassword" />
                  @if (adminConfirmPassword && adminNewPassword !== adminConfirmPassword) {
                    <small class="auth-error">Passwords do not match.</small>
                  }
                </div>
                <button type="submit" class="btn btn-primary" appPressable
                  [disabled]="savingPassword() || pwdForm.invalid || adminNewPassword !== adminConfirmPassword">
                  {{ savingPassword() ? 'Saving…' : 'Change Password' }}
                </button>
              </form>
            </div>

            @if (accountMessage()) {
              <div class="pill" style="padding:12px 16px;grid-column:1/-1;border-radius:12px"
                   [class.pill-emerald]="accountMessageKind()==='success'"
                   [class.pill-red]="accountMessageKind()==='error'">
                {{ accountMessage() }}
              </div>
            }
          </section>
        }

        <!-- Hosting Tab -->
        @if (tab() === 'hosting') {
          <section>
            <div class="panel" style="padding: 20px; margin-bottom: 16px;">
              <p class="muted" style="margin:0 0 12px;font-size:13px">
                Only fields you change are saved — the rest of the settings stay untouched.
                Leave blank secret/text fields alone to keep current values (blank never clears).
                @if (hosting(); as h) {
                  <span>
                    · Portainer {{ h.portainerApiKeyConfigured ? ('key ' + h.portainerApiKeyHint) : 'key not set' }}
                    · NPM {{ h.npmPasswordConfigured ? ('pass ' + h.npmPasswordHint) : 'pass not set' }}
                    · GitHub OAuth {{ h.githubClientSecretConfigured ? ('secret ' + h.githubClientSecretHint) : 'secret not set' }}
                    · Webhook {{ h.githubWebhookSecretConfigured ? ('secret ' + h.githubWebhookSecretHint) : 'secret not set' }}
                    · Docker Hub {{ h.dockerHubTokenConfigured ? ('token ' + h.dockerHubTokenHint) : 'token not set' }}
                  </span>
                }
              </p>

              @if (hostingLoading() && !hosting()) {
                <p class="muted">Loading hosting settings…</p>
              } @else if (!hosting()) {
                <p class="muted">Could not load hosting settings.</p>
              } @else {
                <form class="hosting-form" (ngSubmit)="saveHosting()" #hostingForm="ngForm">
                  <h3>Portainer</h3>
                  <div class="grid grid-4 admin-filters">
                    <div class="field"><label>URL</label><input [(ngModel)]="hostingDraft.portainerUrl" name="portainerUrl" /></div>
                    <div class="field"><label>API key (token)</label><input [(ngModel)]="hostingDraft.portainerApiKey" name="portainerApiKey" type="password" placeholder="Leave blank to keep" autocomplete="new-password" /></div>
                    <div class="field"><label>Endpoint ID</label><input [(ngModel)]="hostingDraft.portainerEndpointId" name="portainerEndpointId" /></div>
                  </div>

                  <h3>Nginx Proxy Manager</h3>
                  <div class="grid grid-4 admin-filters">
                    <div class="field" style="display:flex;align-items:flex-end;gap:8px">
                      <label style="display:flex;align-items:center;gap:8px;margin:0">
                        <input type="checkbox" [(ngModel)]="hostingDraft.npmEnabled" name="npmEnabled" /> Enabled
                      </label>
                    </div>
                    <div class="field"><label>URL</label><input [(ngModel)]="hostingDraft.npmUrl" name="npmUrl" /></div>
                    <div class="field"><label>Email</label><input [(ngModel)]="hostingDraft.npmEmail" name="npmEmail" /></div>
                    <div class="field"><label>Password</label><input [(ngModel)]="hostingDraft.npmPassword" name="npmPassword" type="password" placeholder="Leave blank to keep" autocomplete="new-password" /></div>
                    <div class="field"><label>Certificate ID</label><input [(ngModel)]="hostingDraft.npmCertificateId" name="npmCertificateId" /></div>
                    <div class="field" style="display:flex;align-items:flex-end">
                      <label style="display:flex;align-items:center;gap:8px;margin:0">
                        <input type="checkbox" [(ngModel)]="hostingDraft.npmSslForced" name="npmSslForced" /> Force SSL
                      </label>
                    </div>
                  </div>

                  <h3>GitHub OAuth</h3>
                  <div class="grid grid-4 admin-filters">
                    <div class="field"><label>Client ID</label><input [(ngModel)]="hostingDraft.githubClientId" name="githubClientId" /></div>
                    <div class="field"><label>Client secret</label><input [(ngModel)]="hostingDraft.githubClientSecret" name="githubClientSecret" type="password" placeholder="Leave blank to keep" autocomplete="new-password" /></div>
                    <div class="field"><label>Redirect URI</label><input [(ngModel)]="hostingDraft.githubRedirectUri" name="githubRedirectUri" /></div>
                    <div class="field"><label>Scopes</label><input [(ngModel)]="hostingDraft.githubScopes" name="githubScopes" /></div>
                    <div class="field"><label>Webhook secret</label><input [(ngModel)]="hostingDraft.githubWebhookSecret" name="githubWebhookSecret" type="password" placeholder="Leave blank to keep" autocomplete="new-password" /></div>
                  </div>

                  <h3>Docker Hub</h3>
                  <div class="grid grid-4 admin-filters">
                    <div class="field"><label>Username</label><input [(ngModel)]="hostingDraft.dockerHubUsername" name="dockerHubUsername" /></div>
                    <div class="field"><label>Token</label><input [(ngModel)]="hostingDraft.dockerHubToken" name="dockerHubToken" type="password" placeholder="Leave blank to keep" autocomplete="new-password" /></div>
                    <div class="field"><label>Namespace</label><input [(ngModel)]="hostingDraft.dockerHubNamespace" name="dockerHubNamespace" /></div>
                  </div>

                  <h3>Platform</h3>
                  <div class="grid grid-4 admin-filters">
                    <div class="field"><label>Base domain</label><input [(ngModel)]="hostingDraft.baseDomain" name="baseDomain" /></div>
                    <div class="field"><label>Public API URL</label><input [(ngModel)]="hostingDraft.publicApiUrl" name="publicApiUrl" placeholder="https://api.cloudbase.website" /></div>
                    <div class="field"><label>Docker network</label><input [(ngModel)]="hostingDraft.dockerNetwork" name="dockerNetwork" /></div>
                    <div class="field"><label>Volume root</label><input [(ngModel)]="hostingDraft.volumeRoot" name="volumeRoot" /></div>
                  </div>

                  <div style="display:flex;gap:10px;align-items:center;margin-top:16px;flex-wrap:wrap">
                    <button type="submit" class="btn btn-primary" appPressable [disabled]="savingHosting() || !hostingHasChanges()">
                      {{ savingHosting() ? 'Saving…' : 'Save Hosting Settings' }}
                    </button>
                    @if (hostingMessage()) {
                      <span class="pill" [class.pill-emerald]="hostingMessageKind()==='success'" [class.pill-red]="hostingMessageKind()==='error'" style="padding:8px 12px;border-radius:10px">
                        {{ hostingMessage() }}
                      </span>
                    }
                  </div>
                </form>
              }
            </div>
          </section>
        }

        <!-- Governance Tab -->
        @if (tab() === 'governance') {
          <section>
            <div class="panel" style="padding: 18px; margin-bottom: 16px;">
              <div class="grid grid-4 admin-filters">
                <div class="field">
                  <label>Search Users</label>
                  <input [(ngModel)]="searchQuery" (ngModelChange)="resetPage()" placeholder="Name or email">
                </div>
                <div class="field">
                  <label>Role</label>
                  <app-styled-select [(value)]="roleFilter" [options]="roleFilterOptions" (valueChange)="resetPage()" />
                </div>
                <div class="field">
                  <label>Account Status</label>
                  <app-styled-select [(value)]="accountStatusFilter" [options]="accountStatusFilterOptions" (valueChange)="resetPage()" />
                </div>
                <div class="field">
                  <label>Deployment</label>
                  <app-styled-select [(value)]="deploymentFilter" [options]="deploymentFilterOptions" (valueChange)="resetPage()" />
                </div>
                <div class="field">
                  <label>Email</label>
                  <app-styled-select [(value)]="emailFilter" [options]="emailFilterOptions" (valueChange)="resetPage()" />
                </div>
                <div class="field">
                  <label>Items per page</label>
                  <app-styled-select [(value)]="pageSize" [options]="pageSizeOptions" (valueChange)="resetPage()" />
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
                  @for (user of pagedUsers(); track user.id) {
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

            @if (filteredUsers().length > 0) {
              <div class="admin-pager" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 12px;">
                <span class="muted" style="font-size: 13px;">
                  Showing {{ pageRangeLabel() }} of {{ filteredUsers().length }}
                </span>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <button class="btn btn-sm btn-ghost" type="button" (click)="prevPage()" [disabled]="pageIndex <= 0">Previous</button>
                  <span class="muted" style="font-size: 13px;">Page {{ pageIndex + 1 }} / {{ totalPages() }}</span>
                  <button class="btn btn-sm btn-ghost" type="button" (click)="nextPage()" [disabled]="pageIndex >= totalPages() - 1">Next</button>
                </div>
              </div>
            }

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
        <!-- Audit Tab — @defer when the tab is selected -->
        @if (tab() === 'audit') {
          <section>
            @defer (when tab() === 'audit'; prefetch on idle) {
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
                        <td class="muted" [attr.title]="formatAuditTime(log.timestamp)">{{ log.timestamp | timeAgo }}</td>
                        <td>
                          <div class="cell-strong">{{ log.actorName }}</div>
                          <div class="muted" style="font-size: 12px;">{{ log.actorEmail }}</div>
                        </td>
                        <td>
                          <span [class]="auditActionClass(log.action)">{{ auditActionLabel(log.action) }}</span>
                        </td>
                        <td class="cell-strong">{{ log.target }}</td>
                        <td class="muted" [attr.title]="log.details">{{ log.details | truncate:72 }}</td>
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
            } @placeholder {
              <div class="panel muted" style="padding: 24px; text-align: center;">Loading audit trail…</div>
            }
          </section>
        }
      </div>
    </div>
  `
})
export class AdminPageComponent implements OnInit {
  private readonly adminService = inject(AdminService);
  private readonly auth = inject(AuthService);
  private readonly portainerService = inject(PortainerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

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

  readonly hosting = signal<HostingSettings | null>(null);
  readonly hostingLoading = signal(false);
  readonly savingHosting = signal(false);
  readonly hostingMessage = signal('');
  readonly hostingMessageKind = signal<'success' | 'error'>('success');

  readonly savingProfile = signal(false);
  readonly savingPassword = signal(false);
  readonly accountMessage = signal('');
  readonly accountMessageKind = signal<'success' | 'error'>('success');

  adminName = '';
  adminEmail = '';
  adminCurrentPassword = '';
  adminNewPassword = '';
  adminConfirmPassword = '';
  readonly passwordPattern = STRONG_PASSWORD;

  hostingDraft: {
    portainerUrl: string;
    portainerApiKey: string;
    portainerEndpointId: string;
    npmEnabled: boolean;
    npmUrl: string;
    npmEmail: string;
    npmPassword: string;
    npmCertificateId: string;
    npmSslForced: boolean;
    githubClientId: string;
    githubClientSecret: string;
    githubRedirectUri: string;
    githubScopes: string;
    githubWebhookSecret: string;
    dockerHubUsername: string;
    dockerHubToken: string;
    dockerHubNamespace: string;
    baseDomain: string;
    publicApiUrl: string;
    dockerNetwork: string;
    volumeRoot: string;
  } = this.emptyHostingDraft();

  searchQuery = '';
  roleFilter = 'ALL';
  accountStatusFilter = 'ALL';
  deploymentFilter = 'ALL';
  emailFilter = 'ALL';
  pageSize = '5';
  pageIndex = 0;

  readonly roleFilterOptions: StyledSelectOption[] = [
    { label: 'All roles', value: 'ALL', icon: 'pi pi-users' },
    { label: 'Admin', value: 'ADMIN', icon: 'pi pi-shield' },
    { label: 'User', value: 'USER', icon: 'pi pi-user' }
  ];
  readonly accountStatusFilterOptions: StyledSelectOption[] = [
    { label: 'All statuses', value: 'ALL', icon: 'pi pi-filter' },
    { label: 'Pending Activation', value: 'PENDING_ACTIVATION', icon: 'pi pi-clock' },
    { label: 'Active', value: 'ACTIVE', icon: 'pi pi-check-circle' },
    { label: 'Suspended', value: 'SUSPENDED', icon: 'pi pi-ban' }
  ];
  readonly deploymentFilterOptions: StyledSelectOption[] = [
    { label: 'All access', value: 'ALL', icon: 'pi pi-filter' },
    { label: 'Enabled', value: 'ENABLED', icon: 'pi pi-play' },
    { label: 'Disabled', value: 'DISABLED', icon: 'pi pi-pause' }
  ];
  readonly emailFilterOptions: StyledSelectOption[] = [
    { label: 'All emails', value: 'ALL', icon: 'pi pi-envelope' },
    { label: 'Verified', value: 'VERIFIED', icon: 'pi pi-check-circle' },
    { label: 'Unverified', value: 'UNVERIFIED', icon: 'pi pi-exclamation-circle' }
  ];
  readonly pageSizeOptions: StyledSelectOption[] = [
    { label: '5', value: '5', icon: 'pi pi-list' },
    { label: '10', value: '10', icon: 'pi pi-list' },
    { label: '25', value: '25', icon: 'pi pi-list' },
    { label: '50', value: '50', icon: 'pi pi-list' }
  ];

  ngOnInit() {
    const user = this.auth.user();
    this.adminName = user?.name ?? '';
    this.adminEmail = user?.email ?? '';

    this.route.queryParamMap.subscribe(params => {
      const t = params.get('tab');
      const next: AdminTab =
        t === 'account' || t === 'hosting' || t === 'governance' || t === 'infrastructure' || t === 'audit'
          ? t
          : 'infrastructure';
      if (this.tab() !== next) {
        this.tab.set(next);
      }
      if (next === 'hosting') this.loadHosting();
      if (next === 'infrastructure') this.loadPortainerMetrics();
    });

    this.loadAll();
  }

  setTab(next: AdminTab) {
    this.tab.set(next);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: next },
      queryParamsHandling: 'merge'
    });
  }

  refreshActive() {
    this.loadAll();
    if (this.tab() === 'hosting') this.loadHosting();
    if (this.tab() === 'infrastructure') this.loadPortainerMetrics();
  }

  loadHosting() {
    this.hostingLoading.set(true);
    this.adminService.hostingSettings().subscribe({
      next: s => {
        this.hosting.set(s);
        this.applyHostingDraft(s);
        this.hostingLoading.set(false);
      },
      error: e => {
        this.hostingLoading.set(false);
        this.hostingMessageKind.set('error');
        this.hostingMessage.set(e?.error?.message ?? 'Failed to load hosting settings.');
      }
    });
  }

  saveHosting() {
    const payload = this.buildHostingPatch();
    if (!Object.keys(payload).length) {
      this.hostingMessageKind.set('success');
      this.hostingMessage.set('No changes to save.');
      return;
    }

    this.savingHosting.set(true);
    this.hostingMessage.set('');
    this.adminService.updateHostingSettings(payload).subscribe({
      next: s => {
        this.hosting.set(s);
        this.applyHostingDraft(s);
        this.savingHosting.set(false);
        this.hostingMessageKind.set('success');
        const n = Object.keys(payload).length;
        this.hostingMessage.set(
          n === 1
            ? 'Saved 1 field. Other settings were left unchanged.'
            : `Saved ${n} fields. Other settings were left unchanged.`
        );
      },
      error: e => {
        this.savingHosting.set(false);
        this.hostingMessageKind.set('error');
        this.hostingMessage.set(e?.error?.message ?? 'Failed to save hosting settings.');
      }
    });
  }

  /** True when the draft differs from the last loaded settings (or a secret was typed). */
  hostingHasChanges(): boolean {
    return Object.keys(this.buildHostingPatch()).length > 0;
  }

  /** Partial patch: only keys the admin actually changed. */
  private buildHostingPatch(): HostingSettingsUpdate {
    const baseline = this.hosting();
    if (!baseline) return {};

    const d = this.hostingDraft;
    const patch: HostingSettingsUpdate = {};

    const text = (v: string | null | undefined) => (v ?? '').trim();
    const setText = (
      key: keyof HostingSettingsUpdate,
      draftVal: string,
      currentVal: string | null | undefined
    ) => {
      const next = text(draftVal);
      const cur = text(currentVal);
      // Blank draft = keep current (never clear other settings by accident).
      if (!next) return;
      if (next !== cur) {
        (patch as Record<string, string>)[key as string] = next;
      }
    };
    const setSecret = (key: keyof HostingSettingsUpdate, draftVal: string) => {
      if (text(draftVal)) {
        (patch as Record<string, string>)[key as string] = text(draftVal);
      }
    };

    setText('portainerUrl', d.portainerUrl, baseline.portainerUrl);
    setSecret('portainerApiKey', d.portainerApiKey);
    setText('portainerEndpointId', d.portainerEndpointId, baseline.portainerEndpointId);

    if (d.npmEnabled !== baseline.npmEnabled) patch.npmEnabled = d.npmEnabled;
    setText('npmUrl', d.npmUrl, baseline.npmUrl);
    setText('npmEmail', d.npmEmail, baseline.npmEmail);
    setSecret('npmPassword', d.npmPassword);
    setText('npmCertificateId', d.npmCertificateId, baseline.npmCertificateId);
    if (d.npmSslForced !== baseline.npmSslForced) patch.npmSslForced = d.npmSslForced;

    setText('githubClientId', d.githubClientId, baseline.githubClientId);
    setSecret('githubClientSecret', d.githubClientSecret);
    setText('githubRedirectUri', d.githubRedirectUri, baseline.githubRedirectUri);
    setText('githubScopes', d.githubScopes, baseline.githubScopes);
    setSecret('githubWebhookSecret', d.githubWebhookSecret);

    setText('dockerHubUsername', d.dockerHubUsername, baseline.dockerHubUsername);
    setSecret('dockerHubToken', d.dockerHubToken);
    setText('dockerHubNamespace', d.dockerHubNamespace, baseline.dockerHubNamespace);

    setText('baseDomain', d.baseDomain, baseline.baseDomain);
    setText('publicApiUrl', d.publicApiUrl, baseline.publicApiUrl);
    setText('dockerNetwork', d.dockerNetwork, baseline.dockerNetwork);
    setText('volumeRoot', d.volumeRoot, baseline.volumeRoot);

    return patch;
  }

  saveAdminProfile(form: NgForm) {
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }
    this.savingProfile.set(true);
    this.auth.updateProfile({ name: this.adminName.trim(), email: this.adminEmail }).subscribe({
      next: user => {
        this.adminName = user.name;
        this.adminEmail = user.email;
        this.savingProfile.set(false);
        this.accountMessageKind.set('success');
        this.accountMessage.set('Profile updated.');
      },
      error: e => {
        this.savingProfile.set(false);
        this.accountMessageKind.set('error');
        this.accountMessage.set(e?.error?.message ?? 'Failed to update profile.');
      }
    });
  }

  saveAdminPassword(form: NgForm) {
    if (form.invalid || this.adminNewPassword !== this.adminConfirmPassword) {
      form.control.markAllAsTouched();
      return;
    }
    this.savingPassword.set(true);
    this.auth.changePassword({
      currentPassword: this.adminCurrentPassword,
      newPassword: this.adminNewPassword
    }).subscribe({
      next: () => {
        this.savingPassword.set(false);
        this.adminCurrentPassword = '';
        this.adminNewPassword = '';
        this.adminConfirmPassword = '';
        form.resetForm();
        this.accountMessageKind.set('success');
        this.accountMessage.set('Password changed.');
      },
      error: e => {
        this.savingPassword.set(false);
        this.accountMessageKind.set('error');
        this.accountMessage.set(e?.error?.message ?? 'Failed to change password.');
      }
    });
  }

  private emptyHostingDraft() {
    return {
      portainerUrl: '',
      portainerApiKey: '',
      portainerEndpointId: '1',
      npmEnabled: false,
      npmUrl: '',
      npmEmail: '',
      npmPassword: '',
      npmCertificateId: '0',
      npmSslForced: false,
      githubClientId: '',
      githubClientSecret: '',
      githubRedirectUri: '',
      githubScopes: '',
      githubWebhookSecret: '',
      dockerHubUsername: '',
      dockerHubToken: '',
      dockerHubNamespace: '',
      baseDomain: '',
      publicApiUrl: '',
      dockerNetwork: '',
      volumeRoot: ''
    };
  }

  private applyHostingDraft(s: HostingSettings) {
    this.hostingDraft = {
      portainerUrl: s.portainerUrl || '',
      portainerApiKey: '',
      portainerEndpointId: s.portainerEndpointId || '1',
      npmEnabled: !!s.npmEnabled,
      npmUrl: s.npmUrl || '',
      npmEmail: s.npmEmail || '',
      npmPassword: '',
      npmCertificateId: s.npmCertificateId || '0',
      npmSslForced: !!s.npmSslForced,
      githubClientId: s.githubClientId || '',
      githubClientSecret: '',
      githubRedirectUri: s.githubRedirectUri || '',
      githubScopes: s.githubScopes || '',
      githubWebhookSecret: '',
      dockerHubUsername: s.dockerHubUsername || '',
      dockerHubToken: '',
      dockerHubNamespace: s.dockerHubNamespace || '',
      baseDomain: s.baseDomain || '',
      publicApiUrl: s.publicApiUrl || '',
      dockerNetwork: s.dockerNetwork || '',
      volumeRoot: s.volumeRoot || ''
    };
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

  pageSizeNumber(): number {
    const n = Number(this.pageSize);
    return Number.isFinite(n) && n > 0 ? n : 5;
  }

  totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredUsers().length / this.pageSizeNumber()));
  }

  pagedUsers() {
    const size = this.pageSizeNumber();
    const maxPage = Math.max(0, this.totalPages() - 1);
    if (this.pageIndex > maxPage) this.pageIndex = maxPage;
    const start = this.pageIndex * size;
    return this.filteredUsers().slice(start, start + size);
  }

  pageRangeLabel(): string {
    const total = this.filteredUsers().length;
    if (!total) return '0–0';
    const size = this.pageSizeNumber();
    const start = this.pageIndex * size + 1;
    const end = Math.min(total, (this.pageIndex + 1) * size);
    return `${start}–${end}`;
  }

  resetPage() {
    this.pageIndex = 0;
  }

  prevPage() {
    if (this.pageIndex > 0) this.pageIndex -= 1;
  }

  nextPage() {
    if (this.pageIndex < this.totalPages() - 1) this.pageIndex += 1;
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
      ROLE_CHANGED: 'Role Changed',
      HOSTING_SETTINGS_UPDATED: 'Hosting Settings'
    };
    return labels[action] ?? action;
  }

  auditActionClass(action: AuditLogEntry['action']) {
    switch (action) {
      case 'ACCOUNT_ACTIVATED':
      case 'DEPLOY_ACCESS_ENABLED':
      case 'PROJECT_CREATED':
      case 'SERVICE_DEPLOYED':
      case 'HOSTING_SETTINGS_UPDATED':
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
