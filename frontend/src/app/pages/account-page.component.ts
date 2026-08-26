import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../core/auth.service';
import { GitHubOAuthService } from '../core/github-oauth.service';
import { ApiToken, NotificationPrefs, UsageSummary } from '../core/models';
import { environment } from '../../environments/environment';
import { AutofocusDirective } from '../shared/directives/autofocus.directive';
import { CopyTextDirective } from '../shared/directives/copy-text.directive';
import { PressableDirective } from '../shared/directives/pressable.directive';
import { TimeAgoPipe } from '../shared/pipes/time-ago.pipe';

/** Same regex used by auth Reactive Forms Validators.pattern(). */
const STRONG_PASSWORD_PATTERN = '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&#._-]).{8,}$';

@Component({
  selector: 'app-account-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    InputTextModule,
    TagModule,
    MessageModule,
    AutofocusDirective,
    CopyTextDirective,
    PressableDirective,
    TimeAgoPipe
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
      <section id="github-connect" class="panel svc-panel account-span-2">
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
                <div class="muted u-text-13 u-mt-2">&#64;{{ auth.user()?.github?.username }}</div>
              }
              <p class="muted u-text-13 u-mt-4">
                Connected {{ auth.user()?.github?.connectedAt | timeAgo }}
                · scopes: {{ (auth.user()?.github?.scopes || []).join(', ') }}
              </p>
            </div>
          </div>
          <div class="modal-actions u-mt-14 u-flex u-flex-wrap u-gap-8">
            <p-button
              label="Switch GitHub account"
              severity="secondary"
              [outlined]="true"
              [loading]="githubBusy()"
              (onClick)="switchGitHubAccount()"
            />
            <p-button
              label="Disconnect"
              severity="danger"
              [outlined]="true"
              [loading]="githubBusy()"
              (onClick)="disconnectGitHub()"
            />
          </div>
        } @else if (githubSwitchOpen()) {
          <div class="github-switch-wizard">
            <p class="pill pill-amber railway-alert pill-block u-mb-14">
              GitHub keeps the old user signed in inside this browser. CloudBase cannot override that.
              Sign out of GitHub first, then connect the new account.
            </p>
            <ol class="github-switch-steps">
              <li>
                <strong>Sign out of GitHub</strong>
                <p class="muted">Opens GitHub — click <em>Sign out</em> and confirm.</p>
                <button type="button" class="btn btn-ghost btn-sm" (click)="githubOAuth.openLogoutTab()">
                  1. Open GitHub logout
                </button>
              </li>
              <li>
                <strong>Revoke old app access (recommended)</strong>
                <p class="muted">Removes CloudBase from the previous GitHub user.</p>
                <button type="button" class="btn btn-ghost btn-sm" (click)="githubOAuth.openRevokeTab()">
                  2. Open GitHub app settings
                </button>
              </li>
              <li>
                <strong>Connect the new account</strong>
                <p class="muted">Only after you signed out — otherwise GitHub will send you back to the first user.</p>
                <button type="button" class="btn btn-primary btn-sm" (click)="connectAfterSwitch()" [disabled]="githubBusy()">
                  3. Connect new GitHub account
                </button>
              </li>
            </ol>
            <button type="button" class="btn btn-ghost btn-sm u-mt-8" (click)="cancelGitHubSwitch()">
              Cancel
            </button>
          </div>
        } @else {
          <p class="muted u-mb-14 u-text-13">
            Connect GitHub to deploy private repositories, enable auto-deploy on push, and sync branches.
          </p>
          @if (githubOAuth.isConfigured()) {
            <p-button
              label="Connect with GitHub"
              icon="pi pi-github"
              [loading]="githubBusy()"
              (onClick)="connectGitHubOAuth()"
            />
            <p class="muted u-mt-10 u-text-12 u-lh-145">
              If the wrong GitHub user keeps coming back, use <strong>Switch GitHub account</strong> after connecting once,
              or sign out at github.com/logout first.
            </p>
          } @else {
            <div class="pill pill-amber railway-alert u-mb-12">
              GitHub OAuth is not configured. An admin must set the Client ID under Hosting.
            </div>
          }
        }
      </section>

      <!-- Profile (template-driven) -->
      <section class="panel svc-panel">
        <h3>Profile</h3>
        <form #profileForm="ngForm" (ngSubmit)="saveProfile(profileForm)" novalidate>
          <div class="field flex flex-column gap-2">
            <label for="acc-name">Full name</label>
            <input
              id="acc-name"
              name="name"
              pInputText
              class="w-full"
              autocomplete="name"
              required
              minlength="2"
              pattern="^.{2,80}$"
              [(ngModel)]="name"
              #nameCtrl="ngModel"
              [appAutofocus]="true"
              [class.ng-invalid-show]="nameCtrl.invalid && (nameCtrl.dirty || nameCtrl.touched || profileForm.submitted)"
            />
            @if (nameCtrl.invalid && (nameCtrl.dirty || nameCtrl.touched || profileForm.submitted)) {
              <small class="auth-error">Name must be 2–80 characters.</small>
            }
          </div>
          <div class="field flex flex-column gap-2">
            <label for="acc-email">Email</label>
            <input
              id="acc-email"
              pInputText
              [ngModel]="email"
              [ngModelOptions]="{ standalone: true }"
              name="accountEmail"
              type="email"
              autocomplete="email"
              readonly
              disabled
              class="w-full"
            />
            <p class="muted u-m-0 u-text-12">Login email — cannot be changed.</p>
          </div>
          <div class="modal-actions u-mt-14">
            <button type="submit" class="btn btn-primary" appPressable [disabled]="savingProfile() || profileForm.invalid">
              {{ savingProfile() ? 'Saving…' : 'Save Profile' }}
            </button>
          </div>
        </form>
      </section>

      <!-- Security — Template-Driven Form + pattern attribute (contrast with Auth Reactive Forms) -->
      <section class="panel svc-panel">
        <h3>Security</h3>
        <form #pwdForm="ngForm" (ngSubmit)="savePassword(pwdForm)" novalidate class="account-pwd-form">
          <div class="field flex flex-column gap-2">
            <label for="acc-cur">Current password</label>
            <input
              id="acc-cur"
              name="currentPassword"
              type="password"
              class="w-full"
              autocomplete="current-password"
              required
              [(ngModel)]="currentPassword"
              #curCtrl="ngModel"
            />
            @if (curCtrl.invalid && (curCtrl.dirty || pwdForm.submitted)) {
              <small class="auth-error">Current password is required.</small>
            }
          </div>
          <div class="field flex flex-column gap-2">
            <label for="acc-new">New password</label>
            <small class="muted">8+ characters with upper, lower, digit, and special character</small>
            <input
              id="acc-new"
              name="newPassword"
              type="password"
              class="w-full"
              autocomplete="new-password"
              required
              [attr.pattern]="passwordPattern"
              [(ngModel)]="newPassword"
              #newCtrl="ngModel"
            />
            @if (newCtrl.errors?.['required'] && (newCtrl.dirty || pwdForm.submitted)) {
              <small class="auth-error">New password is required.</small>
            }
            @if (newCtrl.errors?.['pattern'] && (newCtrl.dirty || pwdForm.submitted)) {
              <small class="auth-error">Password must include upper, lower, digit, and special character.</small>
            }
          </div>
          <div class="field flex flex-column gap-2">
            <label for="acc-confirm">Confirm new password</label>
            <input
              id="acc-confirm"
              name="confirmPassword"
              type="password"
              class="w-full"
              autocomplete="new-password"
              required
              [(ngModel)]="confirmPassword"
              #confirmCtrl="ngModel"
            />
            @if (confirmCtrl.invalid && (confirmCtrl.dirty || pwdForm.submitted)) {
              <small class="auth-error">Confirm your new password.</small>
            }
            @if (confirmPassword && newPassword !== confirmPassword) {
              <small class="auth-error">New passwords do not match.</small>
            }
          </div>
          <div class="modal-actions u-mt-14">
            <button
              type="submit"
              class="btn btn-primary"
              appPressable
              [disabled]="savingPassword() || pwdForm.invalid || newPassword !== confirmPassword"
            >
              {{ savingPassword() ? 'Saving…' : 'Change Password' }}
            </button>
          </div>
        </form>
      </section>

      <!-- Usage — @defer until meters enter the viewport -->
      <section class="panel svc-panel account-span-2">
        <div class="svc-panel-head">
          <h3>Usage</h3>
          <a routerLink="/billing" class="btn btn-ghost btn-sm">Billing →</a>
        </div>
        @defer (on viewport; prefetch on idle) {
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
                <strong>{{ u.deploymentsThisMonth }}</strong>
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
          } @else {
            <p class="muted u-py-8">{{ usageError() || 'Loading usage…' }}</p>
          }
        } @placeholder {
          <p class="muted u-py-8">Loading usage…</p>
        }
      </section>

      <!-- Notifications -->
      <section class="panel svc-panel">
        <h3>Notifications</h3>
        <p class="muted u-text-13 u-mb-12 u-lh-145">
          In-app alerts always work. Email alerts send when Resend is enabled on this host.
        </p>
        <label class="toggle-field"><input type="checkbox" [(ngModel)]="notif.emailDeployments" /><span>Email on successful deploys</span></label>
        <label class="toggle-field"><input type="checkbox" [(ngModel)]="notif.emailFailures" /><span>Email on failed deploys</span></label>
        <label class="toggle-field"><input type="checkbox" [(ngModel)]="notif.emailWeeklyUsage" /><span>Weekly usage summary (saved for later)</span></label>
        <div class="modal-actions u-mt-14">
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
              <span class="pill" [class]="auth.hasDeployAccess() ? 'pill-green' : 'pill-red'">
                {{ auth.hasDeployAccess() ? 'Enabled' : 'Locked' }}
              </span>
            </dd>
          </div>
          @if (!auth.hasDeployAccess() && auth.user()?.role !== 'ADMIN') {
            <div class="u-span-all">
              <div class="pill pill-red railway-alert pill-block">
                Deploy access is locked. Create, deploy, edit, stop, and delete actions are blocked until an admin clicks Enable Deploy on your account.
              </div>
            </div>
          }
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

      <!-- API tokens (mock mode only — real tokens not shipped yet) -->
      @if (!useApi) {
      <section class="panel svc-panel account-span-2">
        <div class="svc-panel-head">
          <h3>API Tokens</h3>
          <button type="button" class="btn btn-ghost btn-sm" (click)="createToken()" [disabled]="tokenBusy()">+ New Token</button>
        </div>
        <p class="muted u-mb-12 u-text-13">Use tokens for CI/CD and the CloudBase CLI.</p>
        @if (newTokenSecret()) {
          <div class="pill pill-amber railway-alert u-block u-mb-12">
            Copy this token now — it won’t be shown again:<br>
            <code class="mono" [appCopyText]="newTokenSecret()!">{{ newTokenSecret() }}</code>
          </div>
        }
        <div class="token-list">
          @for (t of tokens(); track t.id) {
            <div class="token-row">
              <div>
                <strong>{{ t.name }}</strong>
                <div class="muted mono u-text-12">{{ t.prefix }}…</div>
              </div>
              <div class="muted u-text-12">
                Created {{ t.createdAt | timeAgo }}
                @if (t.lastUsedAt) { · Last used {{ t.lastUsedAt | timeAgo }} }
              </div>
              <button type="button" class="btn btn-ghost btn-sm danger" (click)="revokeToken(t)">Revoke</button>
            </div>
          } @empty {
            <p class="muted">No tokens yet.</p>
          }
        </div>
      </section>
      } @else {
      <section class="panel svc-panel account-span-2">
        <div class="svc-panel-head"><h3>API Tokens</h3></div>
        <p class="muted u-text-13">Deploy from the dashboard or GitHub Actions. Personal CLI tokens are not part of this release.</p>
      </section>
      }
    </div>
  </div>
</div>
  `
})
export class AccountPageComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly githubOAuth = inject(GitHubOAuthService);
  readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly useApi = !!(environment as { useApi?: boolean }).useApi;

  name = '';
  email = '';
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  githubUsername = '';
  tokenName = '';
  readonly passwordPattern = STRONG_PASSWORD_PATTERN;
  notif: NotificationPrefs = {
    emailDeployments: true,
    emailFailures: true,
    emailWeeklyUsage: false
  };

  readonly savingProfile = signal(false);
  readonly savingPassword = signal(false);
  readonly savingNotif = signal(false);
  readonly githubBusy = signal(false);
  readonly githubSwitchOpen = signal(false);
  readonly tokenBusy = signal(false);
  readonly message = signal('');
  readonly tone = signal<'ok' | 'error'>('ok');
  readonly usage = signal<UsageSummary | null>(null);
  readonly usageError = signal('');
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
    this.auth.usage().subscribe({
      next: u => {
        this.usage.set(u);
        this.usageError.set('');
      },
      error: () => this.usageError.set('Could not load usage')
    });
    this.refreshTokens();

    // Deep-link from create flow: land on Account GitHub section — do NOT auto-redirect to github.com
    if (this.route.snapshot.queryParamMap.get('connect') === 'github' && !this.githubConnected()) {
      queueMicrotask(() => {
        const el = document.getElementById('github-connect');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
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

  /**
   * GitHub reuses the browser session — we cannot silently switch users.
   * Disconnect, then show steps: logout on GitHub → connect again.
   */
  switchGitHubAccount() {
    if (!confirm(
      'Switch GitHub account?\n\n'
      + '1) CloudBase will disconnect the current link.\n'
      + '2) You must Sign out of GitHub in this browser.\n'
      + '3) Then connect the new account.\n\n'
      + 'Without signing out of GitHub, it will keep returning the first user.'
    )) return;

    this.githubBusy.set(true);
    this.githubOAuth.clearPending();
    this.auth.disconnectGitHub().subscribe({
      next: () => {
        this.githubBusy.set(false);
        this.githubSwitchOpen.set(true);
        this.flash('Disconnected. Sign out of GitHub (step 1), then connect the new account.', 'ok');
      },
      error: e => {
        this.githubBusy.set(false);
        this.flash(e?.error?.message ?? 'Disconnect failed', 'error');
      }
    });
  }

  connectAfterSwitch() {
    this.githubBusy.set(true);
    try {
      this.githubOAuth.startLogin();
    } catch (e) {
      this.githubBusy.set(false);
      this.flash((e as Error).message || 'Could not start GitHub OAuth', 'error');
    }
  }

  cancelGitHubSwitch() {
    this.githubSwitchOpen.set(false);
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

  saveProfile(form?: NgForm) {
    if (form && form.invalid) {
      form.control.markAllAsTouched();
      this.flash('Fix the highlighted profile fields', 'error');
      return;
    }
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

  savePassword(form?: NgForm) {
    if (form && form.invalid) {
      form.control.markAllAsTouched();
      this.flash('Fix the highlighted password fields', 'error');
      return;
    }
    if (!this.currentPassword || !this.newPassword) {
      this.flash('Fill all password fields', 'error');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.flash('New passwords do not match', 'error');
      return;
    }
    if (!new RegExp(STRONG_PASSWORD_PATTERN).test(this.newPassword)) {
      this.flash('Password must be 8+ chars with upper, lower, digit, and special character', 'error');
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
        form?.resetForm();
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
