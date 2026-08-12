import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const STATE_KEY = 'cloudbase.github.oauth.state';
const PENDING_KEY = 'cloudbase.github.oauth.pending';

export interface GitHubOAuthPending {
  code: string;
  state: string;
  receivedAt: string;
}

export interface GitHubProfileFromApi {
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  scopes?: string[];
}

/**
 * Frontend GitHub OAuth:
 * 1) Redirect to GitHub authorize
 * 2) Capture ?code= on /auth/github/callback
 * 3) POST code → backend /api/auth/github/exchange (secret stays on server)
 *
 * Note: GitHub always reuses the browser's signed-in user. Switching accounts
 * requires signing out of GitHub itself (CloudBase cannot override that session).
 */
@Injectable({ providedIn: 'root' })
export class GitHubOAuthService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiBaseUrl || '/api';
  private readonly pendingState = signal<GitHubOAuthPending | null>(this.readPending());

  readonly pending = computed(() => this.pendingState());
  readonly hasPendingCode = computed(() => !!this.pendingState()?.code);

  get clientId(): string {
    return (environment as { githubClientId?: string }).githubClientId?.trim() ?? '';
  }

  get redirectUri(): string {
    return (
      (environment as { githubRedirectUri?: string }).githubRedirectUri?.trim() ||
      `${window.location.origin}/auth/github/callback`
    );
  }

  get scopes(): string {
    return (environment as { githubScopes?: string }).githubScopes?.trim() || 'read:user repo user:email';
  }

  isConfigured(): boolean {
    return this.clientId.length > 0;
  }

  /** GitHub sign-out page (user must confirm). */
  logoutUrl(): string {
    return 'https://github.com/logout';
  }

  /** Revoke this OAuth App for the current GitHub user. */
  revokeAppUrl(): string {
    const id = this.clientId;
    return id
      ? `https://github.com/settings/connections/applications/${encodeURIComponent(id)}`
      : 'https://github.com/settings/applications';
  }

  /**
   * Start GitHub OAuth (authorize URL).
   * Does not clear the browser GitHub session — call {@link logoutUrl} first when switching accounts.
   */
  startLogin(_opts?: { forceAccountPick?: boolean }): void {
    if (!this.isConfigured()) {
      throw new Error('Set environment.githubClientId to your GitHub OAuth App Client ID.');
    }

    const state = this.createState();
    sessionStorage.setItem(STATE_KEY, state);

    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', this.clientId);
    authorize.searchParams.set('redirect_uri', this.redirectUri);
    authorize.searchParams.set('scope', this.scopes);
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('allow_signup', 'true');

    window.location.assign(authorize.toString());
  }

  openLogoutTab(): void {
    window.open(this.logoutUrl(), '_blank', 'noopener,noreferrer');
  }

  openRevokeTab(): void {
    window.open(this.revokeAppUrl(), '_blank', 'noopener,noreferrer');
  }

  captureCallback(params: { code: string | null; state: string | null; error: string | null }): GitHubOAuthPending {
    if (params.error) {
      this.clearPending();
      throw new Error(params.error);
    }
    if (!params.code) {
      throw new Error('GitHub did not return an authorization code.');
    }

    const expected = sessionStorage.getItem(STATE_KEY);
    if (!expected || !params.state || expected !== params.state) {
      this.clearPending();
      throw new Error('OAuth state mismatch — possible CSRF. Start Connect with GitHub again.');
    }

    const pending: GitHubOAuthPending = {
      code: params.code,
      state: params.state,
      receivedAt: new Date().toISOString()
    };

    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    this.pendingState.set(pending);
    return pending;
  }

  /** POST { code } → backend → real GitHub username + avatar (uses client secret server-side). */
  exchangeCode(code: string): Observable<GitHubProfileFromApi> {
    return this.http.post<GitHubProfileFromApi>(`${this.apiBase}/auth/github/exchange`, { code });
  }

  getPendingForBackend(): GitHubOAuthPending | null {
    return this.pendingState() ?? this.readPending();
  }

  clearPending(): void {
    sessionStorage.removeItem(PENDING_KEY);
    sessionStorage.removeItem(STATE_KEY);
    this.pendingState.set(null);
  }

  private createState(): string {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  private readPending(): GitHubOAuthPending | null {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as GitHubOAuthPending;
    } catch {
      return null;
    }
  }
}
