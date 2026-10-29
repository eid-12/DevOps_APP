import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { Observable, of, shareReplay, throwError } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import {
  AuthResponse,
  GitHubConnection,
  GitHubRepo,
  InAppNotification,
  NotificationPrefs,
  UsageSummary,
  UserAccount,
  PlanInfo
} from './models';
import { environment } from '../../environments/environment';

interface JwtPayload {
  sub?: string;
  role?: string;
  purpose?: string;
  exp?: number;
  iat?: number;
}

/** Default mock / fallback session length when JWT exp is missing (2 hours). */
const DEFAULT_SESSION_MS = 2 * 60 * 60 * 1000;
const WARN_BEFORE_MS = 5 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly messages = inject(MessageService);
  private readonly apiBase = environment.apiBaseUrl || '/api';

  private readonly tokenState = signal<string>(localStorage.getItem('cloudbase.token') ?? '');
  private readonly userState = signal<UserAccount | null>(this.bootstrapSession());
  private readonly sessionExpiresAtState = signal<number | null>(this.readStoredExpiry());

  /** Avoid hammering /auth/me on every route change. */
  private sessionValidatedAt = 0;
  private sessionInflight: Observable<UserAccount | null> | null = null;
  private readonly sessionTtlMs = 20_000;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private warnTimer: ReturnType<typeof setTimeout> | null = null;

  readonly token = computed(() => this.tokenState());
  readonly user = computed(() => this.userState());
  readonly isAuthenticated = computed(() => this.hasValidToken() && !!this.userState());
  readonly isAdmin = computed(() => this.userState()?.role === 'ADMIN');
  /** Epoch ms when the current access token expires. */
  readonly sessionExpiresAt = computed(() => this.sessionExpiresAtState());

  constructor() {
    if (this.hasValidToken()) {
      const exp =
        this.sessionExpiresAtState() ??
        this.resolveExpiryMs(null, this.tokenState());
      this.scheduleSessionTimers(exp);
    } else if (localStorage.getItem('cloudbase.token')) {
      // Stale / expired storage from a previous visit
      this.logout();
    }
  }

  /** Token present, structurally valid, not expired, not a special-purpose JWT. */
  hasValidToken(): boolean {
    const token = this.tokenState().trim();
    if (!token) return false;

    const payload = this.parseJwtPayload(token);
    const expMs =
      payload?.exp != null
        ? payload.exp * 1000
        : this.sessionExpiresAtState() ?? this.readStoredExpiry();
    if (expMs != null && expMs <= Date.now() + 5_000) {
      return false;
    }

    if (!payload) return false;
    if (payload.purpose) return false;
    return true;
  }

  /**
   * Confirms the session with the API (or mock store).
   * Use from route guards — do not trust localStorage alone.
   */
  ensureSession(opts?: {
    forceRefresh?: boolean;
    requireAdmin?: boolean;
  }): Observable<UserAccount | null> {
    if (!this.hasValidToken()) {
      this.logout();
      return of(null);
    }

    const force = !!opts?.forceRefresh || !!opts?.requireAdmin;
    if (force) {
      this.sessionValidatedAt = 0;
      this.sessionInflight = null;
    }

    const fresh = Date.now() - this.sessionValidatedAt < this.sessionTtlMs;
    if (!force && fresh && this.userState()) {
      return of(this.userState());
    }

    if (!force && this.sessionInflight) {
      return this.sessionInflight;
    }

    this.sessionInflight = this.refreshMe().pipe(
      map(user => {
        this.sessionValidatedAt = Date.now();
        if (user.accountStatus === 'SUSPENDED') {
          this.logout();
          return null;
        }
        return user;
      }),
      catchError(() => {
        this.logout();
        return of(null);
      }),
      finalize(() => {
        this.sessionInflight = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    return this.sessionInflight;
  }

  parseJwtPayload(token: string): JwtPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json) as JwtPayload;
    } catch {
      return null;
    }
  }

  login(payload: { email: string; password: string }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiBase}/auth/login`, payload).pipe(
      map(res => this.normalizeAuthResponse(res)),
      tap(result => this.persistSession(result)),
      catchError(err => throwError(() => err))
    );
  }

  register(payload: { name: string; email: string; password: string }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiBase}/auth/register`, payload).pipe(
      map(res => this.normalizeAuthResponse(res)),
      tap(result => {
        if (result.token) {
          this.persistSession(result);
        }
      }),
      catchError(err => throwError(() => err))
    );
  }

  /** Refresh current user from backend (JWT required). */
  refreshMe(): Observable<UserAccount> {
    return this.http.get<UserAccount>(`${this.apiBase}/auth/me`).pipe(
      map(u => this.normalizeUser(u)),
      tap(user => this.persistUser(user))
    );
  }

  requireUser(): UserAccount {
    const user = this.userState();
    if (!user) throw new Error('Not authenticated');
    return user;
  }

  logout() {
    this.clearSessionTimers();
    this.tokenState.set('');
    this.userState.set(null);
    this.sessionExpiresAtState.set(null);
    this.sessionValidatedAt = 0;
    this.sessionInflight = null;
    localStorage.removeItem('cloudbase.token');
    localStorage.removeItem('cloudbase.user');
    localStorage.removeItem('cloudbase.token.exp');
  }

  /** Remaining session time in ms (0 if none / expired). */
  sessionMsRemaining(): number {
    const exp = this.sessionExpiresAtState();
    if (!exp) return 0;
    return Math.max(0, exp - Date.now());
  }

  private scheduleSessionTimers(expiresAtMs: number) {
    this.clearSessionTimers();
    this.sessionExpiresAtState.set(expiresAtMs);
    localStorage.setItem('cloudbase.token.exp', String(expiresAtMs));

    const msLeft = expiresAtMs - Date.now();
    if (msLeft <= 0) {
      this.expireSession('Session expired. Please sign in again.');
      return;
    }

    const warnIn = msLeft - WARN_BEFORE_MS;
    if (warnIn > 0) {
      this.warnTimer = setTimeout(() => {
        this.messages.add({
          severity: 'warn',
          summary: 'Session ending soon',
          detail: 'Your session expires in about 5 minutes. Save your work and sign in again if needed.',
          life: 12_000
        });
      }, warnIn);
    }

    this.expiryTimer = setTimeout(() => {
      this.expireSession('Your session has expired. Please sign in again.');
    }, msLeft);
  }

  private clearSessionTimers() {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.warnTimer) {
      clearTimeout(this.warnTimer);
      this.warnTimer = null;
    }
  }

  private expireSession(detail: string) {
    this.logout();
    this.messages.add({
      severity: 'warn',
      summary: 'Session expired',
      detail,
      life: 6000
    });
    void this.router.navigate(['/auth'], {
      queryParams: { mode: 'login', reason: 'expired' }
    });
  }

  private resolveExpiryMs(response?: AuthResponse | null, token?: string): number {
    if (response?.expiresAt) {
      const t = Date.parse(response.expiresAt);
      if (!Number.isNaN(t)) return t;
    }
    const jwt = this.parseJwtPayload(token || response?.token || this.tokenState());
    if (jwt?.exp) return jwt.exp * 1000;
    const stored = this.readStoredExpiry();
    if (stored) return stored;
    return Date.now() + DEFAULT_SESSION_MS;
  }

  private readStoredExpiry(): number | null {
    const raw = localStorage.getItem('cloudbase.token.exp');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  updateProfile(payload: { name: string; email: string }): Observable<UserAccount> {
    return this.http.put<UserAccount>(`${this.apiBase}/auth/profile`, { name: payload.name }).pipe(
      tap(user => this.persistUser(user)),
      catchError(err => throwError(() => err))
    );
  }

  changePassword(payload: { currentPassword: string; newPassword: string }): Observable<void> {
    // The server signs out every other session and returns a fresh token for this one.
    return this.http.post<AuthResponse>(`${this.apiBase}/auth/change-password`, payload).pipe(
      tap(response => this.persistSession(response)),
      map(() => void 0),
      catchError(err => throwError(() => err))
    );
  }

  /**
   * After OAuth exchange: update local session from profile, then refresh /me when API mode.
   */
  completeGitHubOAuthLink(opts: {
    username: string;
    displayName?: string;
    avatarUrl?: string;
    scopes?: string[];
  }): UserAccount {
    const current = this.requireUser();
    const scopes = opts.scopes?.length ? opts.scopes : ['read:user', 'repo', 'user:email'];
    const github: GitHubConnection = {
      connected: true,
      username: opts.username,
      displayName: opts.displayName,
      avatarUrl: opts.avatarUrl,
      connectedAt: new Date().toISOString(),
      scopes
    };
    const updated: UserAccount = { ...current, github };
    this.persistUser(updated);
    this.refreshMe().subscribe({ error: () => { /* keep optimistic session */ } });
    return updated;
  }

  disconnectGitHub(): Observable<UserAccount> {
    return this.http.delete<UserAccount>(`${this.apiBase}/auth/github`).pipe(
      map(u => this.normalizeUser(u)),
      tap(user => this.persistUser(user))
    );
  }

  updateNotifications(prefs: NotificationPrefs): Observable<UserAccount> {
    return this.http.put<UserAccount>(`${this.apiBase}/auth/notifications`, prefs).pipe(
      map(u => this.normalizeUser(u)),
      tap(user => this.persistUser(user)),
      catchError(err => throwError(() => err))
    );
  }

  usage(): Observable<UsageSummary> {
    return this.http.get<UsageSummary>(`${this.apiBase}/auth/usage`);
  }

  isGitHubConnected(): boolean {
    return !!this.userState()?.github?.connected;
  }

  githubUsername(): string {
    return this.userState()?.github?.username?.trim() || '';
  }

  /** Repositories for the connected GitHub account (backend uses stored token). */
  listGitHubRepos(): Observable<GitHubRepo[]> {
    return this.http.get<GitHubRepo[]>(`${this.apiBase}/auth/github/repos`);
  }

  listInbox() {
    return this.http.get<InAppNotification[]>(`${this.apiBase}/notifications`);
  }

  unreadCount(): number {
    // Synchronous helper for badge — prefer last known from refresh
    return this.unreadCache;
  }

  private unreadCache = 0;

  refreshUnread(): Observable<number> {
    return this.http.get<{ count: number }>(`${this.apiBase}/notifications/unread-count`).pipe(
      map(r => {
        this.unreadCache = r.count ?? 0;
        return this.unreadCache;
      }),
      catchError(() => {
        this.unreadCache = 0;
        return of(0);
      })
    );
  }

  markNotificationRead(id: string) {
    this.http.post(`${this.apiBase}/notifications/${id}/read`, {}).subscribe({
      next: () => this.refreshUnread().subscribe(),
      error: () => {}
    });
    return;
  }

  markAllNotificationsRead() {
    this.http.post(`${this.apiBase}/notifications/read-all`, {}).subscribe({
      next: () => this.refreshUnread().subscribe(),
      error: () => {}
    });
    return;
  }

  forgotPassword(email: string) {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, password: string) {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/reset-password`, { token, password });
  }

  verifyEmail(email: string, code: string) {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/verify-email`, { email, code });
  }

  resendVerification(email: string) {
    return this.http.post<{ message: string }>(`${this.apiBase}/auth/resend-verification`, { email });
  }

  getPlan(): Observable<PlanInfo> {
    return this.http.get<PlanInfo>(`${this.apiBase}/auth/plan`);
  }

  /**
   * Hard gate matching backend requireDeploymentEnabled.
   * Admins are exempt; others need ACTIVE + deploymentEnabled.
   */
  hasDeployAccess(): boolean {
    const user = this.userState();
    if (!user) return false;
    if (user.role === 'ADMIN') return true;
    return user.accountStatus === 'ACTIVE' && !!user.deploymentEnabled;
  }

  /** Resource gates used by UI (backend enforces the same). Project/service counts are open. */
  canCreateProject(usage: UsageSummary | null | undefined, plan: PlanInfo | null | undefined): boolean {
    if (!usage || !plan) return false;
    if (this.isAdmin()) return true;
    return usage.memoryMbUsed <= plan.memoryMbLimit
      && usage.storageGbUsed <= plan.storageGbLimit
      && (usage.cpuMilliUsed ?? 0) <= (usage.cpuMilliLimit ?? 2000);
  }

  canAddService(
    usage: UsageSummary | null | undefined,
    plan: PlanInfo | null | undefined,
    extraMemoryMb = 512,
    extraStorageGb = 0,
    extraCpuMilli = 500
  ): boolean {
    if (!usage || !plan) return false;
    if (this.isAdmin()) return true;
    if (usage.memoryMbUsed > plan.memoryMbLimit
        || usage.storageGbUsed > plan.storageGbLimit
        || (usage.cpuMilliUsed ?? 0) > (usage.cpuMilliLimit ?? 2000)) {
      return false;
    }
    return usage.memoryMbUsed + extraMemoryMb <= plan.memoryMbLimit
      && usage.storageGbUsed + extraStorageGb <= plan.storageGbLimit
      && (usage.cpuMilliUsed ?? 0) + extraCpuMilli <= (usage.cpuMilliLimit ?? 2000);
  }

  canStartDeploy(usage: UsageSummary | null | undefined, plan: PlanInfo | null | undefined): boolean {
    if (!usage || !plan) return false;
    if (this.isAdmin()) return true;
    // Monthly deploy count is open — only resource overage blocks elsewhere.
    return true;
  }

  dismissOnboarding() {
    return this.http.post<UserAccount>(`${this.apiBase}/auth/onboarding/dismiss`, {}).pipe(
      map(u => this.normalizeUser(u)),
      tap(user => this.persistUser(user))
    );
  }

  private persistUser(user: UserAccount) {
    this.userState.set(user);
    localStorage.setItem('cloudbase.user', JSON.stringify(user));
  }

  private persistSession(response: AuthResponse) {
    if (response.token) {
      this.tokenState.set(response.token);
      localStorage.setItem('cloudbase.token', response.token);
      const expMs = this.resolveExpiryMs(response, response.token);
      this.scheduleSessionTimers(expMs);
    }
    this.persistUser(response.user);
    this.sessionValidatedAt = Date.now();
  }

  private bootstrapSession(): UserAccount | null {
    const token = localStorage.getItem('cloudbase.token') ?? '';
    const stored = this.readStoredUser();

    this.tokenState.set(token);
    if (!token || !this.tokenLooksValid(token)) {
      localStorage.removeItem('cloudbase.token');
      localStorage.removeItem('cloudbase.user');
      localStorage.removeItem('cloudbase.token.exp');
      this.tokenState.set('');
      return null;
    }

    // Sync expiry from JWT if storage missing
    const fromJwt = this.parseJwtPayload(token)?.exp;
    if (fromJwt) {
      localStorage.setItem('cloudbase.token.exp', String(fromJwt * 1000));
    }

    if (!stored) {
      return null;
    }

    return this.normalizeUser(stored);
  }

  private tokenLooksValid(token: string): boolean {
    const payload = this.parseJwtPayload(token);
    if (!payload) return false;
    if (payload.purpose) return false;
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return false;
    return true;
  }

  private readStoredUser(): UserAccount | null {
    const raw = localStorage.getItem('cloudbase.user');
    return raw ? JSON.parse(raw) as UserAccount : null;
  }

  private normalizeAuthResponse(res: AuthResponse): AuthResponse {
    return {
      ...res,
      token: res.token ?? '',
      user: this.normalizeUser(res.user)
    };
  }

  private normalizeUser(u: UserAccount): UserAccount {
    const gh = u.github as (GitHubConnection & { connectedAt?: string | Date }) | null | undefined;
    let github = gh ?? null;
    if (github && github.connected) {
      github = {
        ...github,
        connectedAt: github.connectedAt
          ? (typeof github.connectedAt === 'string'
            ? github.connectedAt
            : new Date(github.connectedAt).toISOString())
          : undefined
      };
    } else if (github && !github.connected) {
      github = null;
    }
    return {
      ...u,
      github,
      notifications: u.notifications ?? {
        emailDeployments: true,
        emailFailures: true,
        emailWeeklyUsage: false
      }
    };
  }
}
