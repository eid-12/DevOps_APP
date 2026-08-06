import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../core/auth.service';
import { GitHubOAuthService } from '../core/github-oauth.service';
import { ApiToken, NotificationPrefs, UsageSummary } from '../core/models';
import { HighlightDirective } from '../shared/highlight.directive';

@Component({
  selector: 'app-account-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    InputTextModule,
    PasswordModule,
    TagModule,
    MessageModule,
    HighlightDirective
  ],
  template: `
<div class="page railway-page">
  <div class="container account-wrap">
    <header class="railway-topbar">
      <div>
        <h1 class="railway-page-title">Account</h1>
        <p class="railway-page-sub">Integrations, security, usage, and preferences</p>
      </div>
      <div class="railway-topbar-actions flex align-items-center gap-2">
        <a routerLink="/billing" class="btn btn-ghost btn-sm">Billing</a>
        <p-button label="Dashboard" icon="pi pi-arrow-left" [outlined]="true" size="small" (onClick)="router.navigate(['/dashboard'])" />
      </div>
    </header>

    @if (message()) {
      <p-message
        class="mb-3 w-full"
        [severity]="tone() === 'error' ? 'error' : 'success'"
        [text]="message()"
        styleClass="w-full"
      />
    }

    <div class="account-grid">
      <!-- GitHub -->
      <section class="panel svc-panel account-span-2" appHighlight="violet">
        <div class="svc-panel-head">
          <h3>GitHub</h3>
          <p-tag
            [value]="githubConnected() ? 'Connected' : 'Not connected'"
            [severity]="githubConnected() ? 'success' : 'warning'"
          />
        </div>

        @if (githubConnected()) {
          <div class="github-connected">
            @if (auth.user()?.github?.avatarUrl) {
              <img
                class="github-avatar-img"
                [src]="auth.user()!.github!.avatarUrl"
                [alt]="auth.user()?.github?.username || 'GitHub'"
                width="44"
                height="44"
                referrerpolicy="no-referrer"
              />
            } @else {
              <div class="github-avatar" aria-hidden="true">GH</div>
            }
            <div>
              <strong>{{ auth.user()?.github?.displayName || ('@' + (auth.user()?.github?.username || 'github')) }}</strong>
              @if (auth.user()?.github?.displayName && auth.user()?.github?.username) {
                <div class="muted" style="font-size:13px;margin-top:2px">&#64;{{ auth.user()?.github?.username }}</div>
              }
              <p class="muted" style="margin:4px 0 0;font-size:13px">
                Connected {{ auth.user()?.github?.connectedAt | date:'medium' }}
                · scopes: {{ (auth.user()?.github?.scopes || []).join(', ') }}
              </p>
            </div>
          </div>
          <div class="modal-actions" style="margin-top:14px">
            <p-button
              label="Disconnect"
              severity="danger"
              [outlined]="true"
              [loading]="githubBusy()"
              (onClick)="disconnectGitHub()"
            />
          </div>
        } @else {
          <p class="muted" style="margin-bottom:14px;font-size:13px">
            Connect GitHub to deploy private repositories, enable auto-deploy on push, and sync branches.
          </p>
          @if (githubOAuth.isConfigured()) {
            <p-button
              label="Connect with GitHub"
              icon="pi pi-github"
              [loading]="githubBusy()"
              (onClick)="connectGitHubOAuth()"
            />
            <p class="muted" style="margin-top:10px;font-size:12px">
              Authorizes on GitHub, then exchanges the code via
              <code>POST /api/auth/github/exchange</code>.
            </p>
          } @else {
            <div class="pill pill-amber railway-alert" style="margin-bottom:12px">
              Set <code>environment.githubClientId</code> to enable OAuth.
            </div>
          }
        }
      </section>

      <!-- Profile -->
      <section class="panel svc-panel">
        <h3>Profile</h3>
        <div class="field flex flex-column gap-2">
          <label for="acc-name">Full name</label>
          <input id="acc-name" pInputText [(ngModel)]="name" autocomplete="name" class="w-full" />
        </div>
        <div class="field flex flex-column gap-2">
          <label for="acc-email">Email</label>
          <input
            id="acc-email"
            pInputText
            [ngModel]="email"
            name="accountEmail"
            type="email"
            autocomplete="email"
            readonly
            disabled
            class="w-full"
          />
          <p class="muted" style="margin:0;font-size:12px">Login email — cannot be changed.</p>
        </div>
        <div class="modal-actions" style="margin-top:14px">
          <p-button label="Save Profile" [loading]="savingProfile()" (onClick)="saveProfile()" />
        </div>
      </section>

      <!-- Security -->
      <section class="panel svc-panel">
        <h3>Security</h3>
        <div class="field flex flex-column gap-2">
          <label for="acc-cur">Current password</label>
          <p-password
            inputId="acc-cur"
            [(ngModel)]="currentPassword"
            [feedback]="false"
            [toggleMask]="true"
            styleClass="w-full"
            inputStyleClass="w-full"
            autocomplete="current-password"
          />
        </div>
        <div class="field flex flex-column gap-2">
          <label for="acc-new">New password</label>
          <p-password
            inputId="acc-new"
            [(ngModel)]="newPassword"
            [feedback]="true"
            [toggleMask]="true"
            styleClass="w-full"
            inputStyleClass="w-full"
            autocomplete="new-password"
          />
        </div>
        <div class="field flex flex-column gap-2">
          <label for="acc-confirm">Confirm new password</label>
          <p-password
            inputId="acc-confirm"
            [(ngModel)]="confirmPassword"
            [feedback]="false"
            [toggleMask]="true"
            styleClass="w-full"
            inputStyleClass="w-full"
            autocomplete="new-password"
          />
        </div>
        <div class="modal-actions" style="margin-top:14px">
          <p-button label="Change Password" [loading]="savingPassword()" (onClick)="savePassword()" />
        </div>
      </section>

      <!-- Usage -->
      <section class="panel svc-panel account-span-2">
        <div class="svc-panel-head">
          <h3>Usage</h3>
          <a routerLink="/billing" class="btn btn-ghost btn-sm">Billing →</a>
        </div>
        @if (usage(); as u) {
          <div class="usage-grid">
            <div class="usage-card">
              <span class="metric-label">Projects</span>
              <strong>{{ u.projects }} / 2</strong>
              <div class="meter"><span [style.width.%]="pct(u.projects, 2)"></span></div>
            </div>
            <div class="usage-card">
              <span class="metric-label">Services</span>
              <strong>{{ u.runningServices }}/{{ u.services }} online · max 3</strong>
              <div class="meter"><span [style.width.%]="pct(u.services, 3)"></span></div>
            </div>
            <div class="usage-card">
              <span class="metric-label">Deployments (month)</span>
              <strong>{{ u.deploymentsThisMonth }} / 20</strong>
              <div class="meter"><span [style.width.%]="pct(u.deploymentsThisMonth, 20)"></span></div>
            </div>
            <div class="usage-card">
              <span class="metric-label">CPU</span>
              <strong>{{ u.cpuMilliUsed }}m / {{ u.cpuMilliLimit }}m</strong>
              <div class="meter"><span [style.width.%]="pct(u.cpuMilliUsed, u.cpuMilliLimit)"></span></div>
            </div>
            <div class="usage-card">
              <span class="metric-label">Memory</span>
              <strong>{{ u.memoryMbUsed }} / {{ u.memoryMbLimit }} MB</strong>
              <div class="meter"><span [style.width.%]="pct(u.memoryMbUsed, u.memoryMbLimit)"></span></div>
            </div>
            <div class="usage-card">
              <span class="metric-label">Storage</span>
              <strong>{{ u.storageGbUsed }} / {{ u.storageGbLimit }} GB</strong>
              <div class="meter"><span [style.width.%]="pct(u.storageGbUsed, u.storageGbLimit)"></span></div>
            </div>
          </div>
        }
      </section>

      <!-- Notifications -->
      <section class="panel svc-panel">
        <h3>Notifications</h3>
        <label class="toggle-field"><input type="checkbox" [(ngModel)]="notif.emailDeployments" /><span>Email on successful deploys</span></label>
        <label class="toggle-field"><input type="checkbox" [(ngModel)]="notif.emailFailures" /><span>Email on failed deploys</span></label>
        <label class="toggle-field"><input type="checkbox" [(ngModel)]="notif.emailWeeklyUsage" /><span>Weekly usage summary</span></label>
        <div class="modal-actions" style="margin-top:14px">
          <button type="button" class="btn btn-primary" (click)="saveNotif()" [disabled]="savingNotif()">
            {{ savingNotif() ? 'Saving…' : 'Save Preferences' }}
          </button>
        </div>
      </section>

      <!-- Access -->
      <section class="panel svc-panel">
        <h3>Access status</h3>
        <dl class="svc-dl">
          <div><dt>Role</dt><dd>{{ auth.user()?.role }}</dd></div>
          <div><dt>Account</dt><dd>{{ auth.user()?.accountStatus }}</dd></div>
          <div>
            <dt>Deploy</dt>
            <dd>
              <span class="pill" [class]="auth.user()?.deploymentEnabled ? 'pill-green' : 'pill-amber'">
                {{ auth.user()?.deploymentEnabled ? 'Enabled' : 'Disabled' }}
              </span>
            </dd>
          </div>
          <div>
            <dt>GitHub</dt>
            <dd>
              <span class="pill" [class]="githubConnected() ? 'pill-green' : 'pill-amber'">
                {{ githubConnected() ? 'Linked' : 'Not linked' }}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <!-- API tokens -->
      <section class="panel svc-panel account-span-2">
        <div class="svc-panel-head">
          <h3>API Tokens</h3>
          <button type="button" class="btn btn-ghost btn-sm" (click)="createToken()" [disabled]="tokenBusy()">+ New Token</button>
        </div>
        <p class="muted" style="margin-bottom:12px;font-size:13px">Use tokens for CI/CD and the CloudBase CLI.</p>
        @if (newTokenSecret()) {
          <div class="pill pill-amber railway-alert" style="display:block;margin-bottom:12px">
            Copy this token now — it won’t be shown again:<br>
            <code class="mono">{{ newTokenSecret() }}</code>
          </div>
        }
        <div class="token-list">
          @for (t of tokens(); track t.id) {
            <div class="token-row">
              <div>
                <strong>{{ t.name }}</strong>
                <div class="muted mono" style="font-size:12px">{{ t.prefix }}…</div>
              </div>
              <div class="muted" style="font-size:12px">
                Created {{ t.createdAt | date:'mediumDate' }}
                @if (t.lastUsedAt) { · Last used {{ t.lastUsedAt | date:'short' }} }
              </div>
              <button type="button" class="btn btn-ghost btn-sm danger" (click)="revokeToken(t)">Revoke</button>
            </div>
          } @empty {
            <p class="muted">No tokens yet.</p>
          }
        </div>
      </section>
    </div>
  </div>
</div>
  `
})
export class AccountPageComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly githubOAuth = inject(GitHubOAuthService);
  readonly router = inject(Router);

  name = '';
  email = '';
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  githubUsername = '';
  tokenName = '';
  notif: NotificationPrefs = {
    emailDeployments: true,
    emailFailures: true,
    emailWeeklyUsage: false
  };

  readonly savingProfile = signal(false);
  readonly savingPassword = signal(false);
  readonly savingNotif = signal(false);
  readonly githubBusy = signal(false);
  readonly tokenBusy = signal(false);
  readonly message = signal('');
  readonly tone = signal<'ok' | 'error'>('ok');
  readonly usage = signal<UsageSummary | null>(null);
  readonly tokens = signal<ApiToken[]>([]);
  readonly newTokenSecret = signal('');

  ngOnInit() {
    const user = this.auth.user();
    if (!user) {
      this.router.navigate(['/auth']);
      return;
    }
    this.name = user.name;
    this.email = user.email;
    this.githubUsername = user.email.split('@')[0] || '';
    this.notif = { ...(user.notifications ?? this.notif) };
    this.auth.usage().subscribe({ next: u => this.usage.set(u) });
    this.refreshTokens();
  }

  githubConnected(): boolean {
    return !!this.auth.user()?.github?.connected;
  }

  pct(used: number, limit: number): number {
    return Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  }

  connectGitHubOAuth() {
    this.githubBusy.set(true);
    try {
      this.githubOAuth.startLogin();
    } catch (e) {
      this.githubBusy.set(false);
      this.flash((e as Error).message || 'Could not start GitHub OAuth', 'error');
    }
  }

  connectGitHub() {
    this.githubBusy.set(true);
    this.auth.connectGitHub(this.githubUsername).subscribe({
      next: () => {
        this.githubBusy.set(false);
        this.flash('GitHub connected', 'ok');
      },
      error: e => {
        this.githubBusy.set(false);
        this.flash(e?.error?.message ?? 'Connect failed', 'error');
      }
    });
  }

  disconnectGitHub() {
    if (!confirm('Disconnect GitHub? Auto-deploy from private repos will stop working until you reconnect.')) return;
    this.githubBusy.set(true);
    this.githubOAuth.clearPending();
    this.auth.disconnectGitHub().subscribe({
      next: () => {
        this.githubBusy.set(false);
        this.flash('GitHub disconnected', 'ok');
      },
      error: e => {
        this.githubBusy.set(false);
        this.flash(e?.error?.message ?? 'Disconnect failed', 'error');
      }
    });
  }

  saveProfile() {
    if (!this.name.trim()) {
      this.flash('Name is required', 'error');
      return;
    }
    const email = this.auth.user()?.email || this.email;
    this.savingProfile.set(true);
    this.auth.updateProfile({ name: this.name.trim(), email }).subscribe({
      next: user => {
        this.name = user.name;
        this.email = user.email;
        this.savingProfile.set(false);
        this.flash('Profile updated', 'ok');
      },
      error: e => {
        this.savingProfile.set(false);
        this.flash(e?.error?.message ?? 'Failed to update profile', 'error');
      }
    });
  }

  savePassword() {
    if (!this.currentPassword || !this.newPassword) {
      this.flash('Fill all password fields', 'error');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.flash('New passwords do not match', 'error');
      return;
    }
    if (this.newPassword.length < 6) {
      this.flash('New password must be at least 6 characters', 'error');
      return;
    }
    this.savingPassword.set(true);
    this.auth.changePassword({
      currentPassword: this.currentPassword,
      newPassword: this.newPassword
    }).subscribe({
      next: () => {
        this.savingPassword.set(false);
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.flash('Password changed', 'ok');
      },
      error: e => {
        this.savingPassword.set(false);
        this.flash(e?.error?.message ?? 'Failed to change password', 'error');
      }
    });
  }

  saveNotif() {
    this.savingNotif.set(true);
    this.auth.updateNotifications(this.notif).subscribe({
      next: () => {
        this.savingNotif.set(false);
        this.flash('Notification preferences saved', 'ok');
      },
      error: e => {
        this.savingNotif.set(false);
        this.flash(e?.error?.message ?? 'Failed to save', 'error');
      }
    });
  }

  refreshTokens() {
    this.auth.listApiTokens().subscribe({ next: t => this.tokens.set(t) });
  }

  createToken() {
    const name = prompt('Token name', 'CI token');
    if (!name?.trim()) return;
    this.tokenBusy.set(true);
    this.auth.createApiToken(name.trim()).subscribe({
      next: result => {
        this.tokenBusy.set(false);
        this.newTokenSecret.set(result.secret);
        this.refreshTokens();
        this.flash('API token created', 'ok');
      },
      error: e => {
        this.tokenBusy.set(false);
        this.flash(e?.error?.message ?? 'Failed to create token', 'error');
      }
    });
  }

  revokeToken(token: ApiToken) {
    if (!confirm(`Revoke token “${token.name}”?`)) return;
    this.auth.revokeApiToken(token.id).subscribe({
      next: () => {
        this.refreshTokens();
        this.flash('Token revoked', 'ok');
      },
      error: e => this.flash(e?.error?.message ?? 'Revoke failed', 'error')
    });
  }

  private flash(msg: string, tone: 'ok' | 'error') {
    this.message.set(msg);
    this.tone.set(tone);
  }
}
