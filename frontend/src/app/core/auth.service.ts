import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { delay, Observable, of, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import {
  ActivityEvent,
  ApiToken,
  AuthResponse,
  GitHubConnection,
  GitHubRepo,
  NotificationPrefs,
  UsageSummary,
  UserAccount
} from './models';
import { MockStore } from './mock-store';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly store = inject(MockStore);
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiBaseUrl || '/api';
  private readonly useApi = !!(environment as { useApi?: boolean }).useApi;

  private readonly tokenState = signal<string>(localStorage.getItem('cloudbase.token') ?? '');
  private readonly userState = signal<UserAccount | null>(this.bootstrapSession());

  readonly token = computed(() => this.tokenState());
  readonly user = computed(() => this.userState());
  readonly isAuthenticated = computed(() => !!this.tokenState());
  readonly isAdmin = computed(() => this.userState()?.role === 'ADMIN');

  login(payload: { email: string; password: string }): Observable<AuthResponse> {
    if (this.useApi) {
      return this.http.post<AuthResponse>(`${this.apiBase}/auth/login`, payload).pipe(
        map(res => this.normalizeAuthResponse(res)),
        tap(result => this.persistSession(result)),
        catchError(err => throwError(() => err))
      );
    }

    const user = this.store.findUserByEmail(payload.email);
    const password = user ? this.store.getPassword(user.id) : undefined;

    if (!user || password !== payload.password) {
      return throwError(() => ({ error: { message: 'Invalid email or password' } })).pipe(delay(250));
    }

    if (user.accountStatus === 'PENDING_ACTIVATION') {
      return throwError(() => ({ error: { message: 'Account pending activation. Please verify your email first.' } })).pipe(delay(250));
    }

    if (user.accountStatus === 'SUSPENDED') {
      return throwError(() => ({ error: { message: 'Account suspended. Please contact an administrator.' } })).pipe(delay(250));
    }

    const response: AuthResponse = {
      token: `mock-${user.id}`,
      user,
      message: 'Login successful'
    };

    return of(response).pipe(
      delay(250),
      tap(result => this.persistSession(result))
    );
  }

  register(payload: { name: string; email: string; password: string }): Observable<AuthResponse> {
    if (this.useApi) {
      return this.http.post<AuthResponse>(`${this.apiBase}/auth/register`, payload).pipe(
        map(res => this.normalizeAuthResponse(res)),
        catchError(err => throwError(() => err))
      );
    }

    if (this.store.findUserByEmail(payload.email)) {
      return throwError(() => ({ error: { message: 'Email already exists' } })).pipe(delay(250));
    }

    const user = this.store.addUser(payload.name, payload.email, payload.password);
    return of({
      token: '',
      user,
      message: 'Registration successful. Await account activation by an administrator.'
    }).pipe(delay(250));
  }

  /** Refresh current user from backend (JWT required). */
  refreshMe(): Observable<UserAccount> {
    if (!this.useApi) {
      return of(this.requireUser());
    }
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
    this.tokenState.set('');
    this.userState.set(null);
    localStorage.removeItem('cloudbase.token');
    localStorage.removeItem('cloudbase.user');
  }

  updateProfile(payload: { name: string; email: string }): Observable<UserAccount> {
    try {
      const current = this.requireUser();
      const updated = this.store.updateProfile(current.id, payload);
      this.persistUser(updated);
      return of(structuredClone(updated)).pipe(delay(220));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to update profile' } })).pipe(delay(150));
    }
  }

  changePassword(payload: { currentPassword: string; newPassword: string }): Observable<void> {
    try {
      const current = this.requireUser();
      this.store.changePassword(current.id, payload.currentPassword, payload.newPassword);
      return of(void 0).pipe(delay(220));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to change password' } })).pipe(delay(150));
    }
  }

  connectGitHub(username?: string): Observable<UserAccount> {
    try {
      const current = this.requireUser();
      const updated = this.store.connectGitHub(current.id, username);
      this.persistUser(updated);
      return of(structuredClone(updated)).pipe(delay(500));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'GitHub connect failed' } })).pipe(delay(150));
    }
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

    if (this.useApi) {
      this.refreshMe().subscribe({ error: () => { /* keep optimistic session */ } });
    } else {
      this.store.connectGitHub(current.id, opts.username, scopes, {
        avatarUrl: opts.avatarUrl,
        displayName: opts.displayName
      });
    }
    return updated;
  }

  disconnectGitHub(): Observable<UserAccount> {
    if (this.useApi) {
      return this.http.delete<UserAccount>(`${this.apiBase}/auth/github`).pipe(
        map(u => this.normalizeUser(u)),
        tap(user => this.persistUser(user))
      );
    }
    try {
      const current = this.requireUser();
      const updated = this.store.disconnectGitHub(current.id);
      this.persistUser(updated);
      return of(structuredClone(updated)).pipe(delay(250));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Disconnect failed' } })).pipe(delay(150));
    }
  }

  updateNotifications(prefs: NotificationPrefs): Observable<UserAccount> {
    try {
      const current = this.requireUser();
      const updated = this.store.updateNotifications(current.id, prefs);
      this.persistUser(updated);
      return of(structuredClone(updated)).pipe(delay(200));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to save preferences' } })).pipe(delay(150));
    }
  }

  listApiTokens(): Observable<ApiToken[]> {
    try {
      const current = this.requireUser();
      return of(structuredClone(this.store.listApiTokens(current.id))).pipe(delay(150));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(100));
    }
  }

  createApiToken(name: string): Observable<{ token: ApiToken; secret: string }> {
    try {
      const current = this.requireUser();
      return of(this.store.createApiToken(current.id, name)).pipe(delay(250));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to create token' } })).pipe(delay(150));
    }
  }

  revokeApiToken(tokenId: string): Observable<void> {
    try {
      this.requireUser();
      this.store.revokeApiToken(tokenId);
      return of(void 0).pipe(delay(180));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(100));
    }
  }

  listActivity(): Observable<ActivityEvent[]> {
    try {
      const current = this.requireUser();
      return of(structuredClone(this.store.listActivity(current.id))).pipe(delay(150));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(100));
    }
  }

  usage(): Observable<UsageSummary> {
    if (this.useApi) {
      return this.http.get<Array<{ services?: Array<{ status?: string; quotaMemoryMb?: number; volumeSizeGb?: number; quotaStorageGb?: number }> }>>(
        `${this.apiBase}/projects`
      ).pipe(
        map(projects => {
          const services = (projects ?? []).flatMap(p => p.services ?? []);
          const running = services.filter(s => s.status === 'RUNNING').length;
          const memoryMbUsed = services.reduce((sum, s) => sum + (s.quotaMemoryMb ?? 512), 0);
          const storageGbUsed = services.reduce((sum, s) => sum + (s.volumeSizeGb ?? s.quotaStorageGb ?? 0), 0);
          return {
            projects: projects.length,
            services: services.length,
            runningServices: running,
            cpuMilliUsed: services.length * 500,
            cpuMilliLimit: 2000,
            memoryMbUsed,
            memoryMbLimit: 4096,
            storageGbUsed,
            storageGbLimit: 50,
            deploymentsThisMonth: 0
          } as UsageSummary;
        })
      );
    }
    try {
      const current = this.requireUser();
      return of(this.store.usageFor(current)).pipe(delay(120));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(100));
    }
  }

  isGitHubConnected(): boolean {
    return !!this.userState()?.github?.connected;
  }

  githubUsername(): string {
    return this.userState()?.github?.username?.trim() || '';
  }

  /** Repositories for the connected GitHub account (backend uses stored token). */
  listGitHubRepos(): Observable<GitHubRepo[]> {
    if (!this.useApi) {
      const u = this.githubUsername() || 'developer';
      return of([
        {
          fullName: `${u}/demo-app`,
          name: 'demo-app',
          htmlUrl: `https://github.com/${u}/demo-app`,
          isPrivate: false,
          defaultBranch: 'main'
        }
      ]).pipe(delay(200));
    }
    return this.http.get<GitHubRepo[]>(`${this.apiBase}/auth/github/repos`);
  }

  listInbox() {
    try {
      const current = this.requireUser();
      return of(structuredClone(this.store.listInbox(current.id))).pipe(delay(100));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(80));
    }
  }

  unreadCount(): number {
    try {
      return this.store.unreadCount(this.requireUser().id);
    } catch {
      return 0;
    }
  }

  markNotificationRead(id: string) {
    this.store.markNotificationRead(id);
  }

  markAllNotificationsRead() {
    try {
      this.store.markAllNotificationsRead(this.requireUser().id);
    } catch { /* ignore */ }
  }

  forgotPassword(email: string) {
    if (this.useApi) {
      return this.http.post<{ message: string }>(`${this.apiBase}/auth/forgot-password`, { email });
    }
    try {
      const msg = this.store.requestPasswordReset(email);
      return of({ message: msg }).pipe(delay(400));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Reset failed' } })).pipe(delay(200));
    }
  }

  resetPassword(token: string, password: string) {
    if (this.useApi) {
      return this.http.post<{ message: string }>(`${this.apiBase}/auth/reset-password`, { token, password });
    }
    return throwError(() => ({ error: { message: 'Reset not available in mock mode' } })).pipe(delay(100));
  }

  verifyEmail(email: string, code: string) {
    if (this.useApi) {
      return this.http.post<{ message: string }>(`${this.apiBase}/auth/verify-email`, { email, code });
    }
    return of({ message: 'Email verified (mock). Await admin activation.' }).pipe(delay(300));
  }

  resendVerification(email: string) {
    if (this.useApi) {
      return this.http.post<{ message: string }>(`${this.apiBase}/auth/resend-verification`, { email });
    }
    return of({ message: 'A new code was sent (mock).' }).pipe(delay(300));
  }

  getPlan() {
    try {
      return of(this.store.getPlan(this.requireUser())).pipe(delay(120));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(80));
    }
  }

  setPlan(_planId: 'free' = 'free') {
    try {
      const updated = this.store.setPlan(this.requireUser().id, 'free');
      this.persistUser(updated);
      return of(structuredClone(updated)).pipe(delay(200));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Plan update failed' } })).pipe(delay(150));
    }
  }

  dismissOnboarding() {
    try {
      const updated = this.store.dismissOnboarding(this.requireUser().id);
      this.persistUser(updated);
      return of(structuredClone(updated)).pipe(delay(150));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed' } })).pipe(delay(100));
    }
  }

  private persistUser(user: UserAccount) {
    this.userState.set(user);
    localStorage.setItem('cloudbase.user', JSON.stringify(user));
  }

  private persistSession(response: AuthResponse) {
    if (response.token) {
      this.tokenState.set(response.token);
      localStorage.setItem('cloudbase.token', response.token);
    }
    this.persistUser(response.user);
  }

  private bootstrapSession(): UserAccount | null {
    const token = localStorage.getItem('cloudbase.token') ?? '';
    const stored = this.readStoredUser();
    if (!stored) return null;

    // Drop stale mock tokens when API mode is on
    if (this.useApi && token.startsWith('mock-')) {
      localStorage.removeItem('cloudbase.token');
      localStorage.removeItem('cloudbase.user');
      this.tokenState.set('');
      return null;
    }

    if (!this.useApi) {
      this.store.hydrateSessionUser(stored);
      return this.store.findUserById(stored.id) ?? stored;
    }

    // Optimistic session; refresh from /me asynchronously
    queueMicrotask(() => {
      if (this.tokenState()) {
        this.refreshMe().subscribe({
          error: () => this.logout()
        });
      }
    });
    return this.normalizeUser(stored);
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
