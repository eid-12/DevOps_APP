import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { GitHubOAuthService } from '../core/github-oauth.service';

/**
 * GitHub redirects here with ?code=&state=.
 * Frontend posts the code to Spring Boot /api/auth/github/exchange.
 */
@Component({
  selector: 'app-github-callback-page',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="page railway-page">
  <div class="container" style="max-width:560px;padding-top:48px">
    <section class="panel svc-panel">
      <h1 class="railway-page-title" style="font-size:22px;margin-bottom:8px">GitHub</h1>

      @if (status() === 'working') {
        <p class="muted">Exchanging authorization code…</p>
      }

      @if (status() === 'ok') {
        <div class="pill pill-green railway-alert">Connected as &#64;{{ login() }}</div>
        <p class="muted" style="font-size:13px;margin:12px 0">Opening Account…</p>
      }

      @if (status() === 'error') {
        <div class="pill pill-red railway-alert">{{ error() }}</div>
        <div class="modal-actions" style="margin-top:16px">
          <button type="button" class="btn btn-ghost" (click)="goAccount()">Back to Account</button>
        </div>
      }
    </section>
  </div>
</div>
  `
})
export class GitHubCallbackPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly githubOAuth = inject(GitHubOAuthService);
  private readonly auth = inject(AuthService);

  readonly status = signal<'working' | 'ok' | 'error'>('working');
  readonly error = signal('');
  readonly login = signal('');

  ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    try {
      const pending = this.githubOAuth.captureCallback({
        code: q.get('code'),
        state: q.get('state'),
        error: q.get('error_description') || q.get('error')
      });

      if (!this.auth.isAuthenticated()) {
        throw new Error('Please log in to CloudBase first, then connect GitHub again.');
      }

      this.githubOAuth.exchangeCode(pending.code).subscribe({
        next: profile => {
          this.auth.completeGitHubOAuthLink({
            username: profile.username,
            displayName: profile.displayName || undefined,
            avatarUrl: profile.avatarUrl || undefined,
            scopes: profile.scopes
          });
          this.githubOAuth.clearPending();
          this.login.set(profile.username);
          this.status.set('ok');
          // Prefer server truth (persisted token + profile)
          this.auth.refreshMe().subscribe({
            next: () => setTimeout(() => this.router.navigateByUrl('/account'), 500),
            error: () => setTimeout(() => this.router.navigateByUrl('/account'), 500)
          });
        },
        error: err => {
          this.error.set(
            err?.error?.message ||
              err?.message ||
              'Could not exchange GitHub code. Is the backend running with client-secret configured?'
          );
          this.status.set('error');
        }
      });
    } catch (e) {
      this.error.set((e as Error).message || 'OAuth callback failed');
      this.status.set('error');
    }
  }

  goAccount() {
    this.router.navigateByUrl('/account');
  }
}
