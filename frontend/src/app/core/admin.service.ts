import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { delay, Observable, of, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { MockStore } from './mock-store';
import { AccountStatus, AuditLogEntry, InfrastructureOverview, UserAccount, UserRole } from './models';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly store = inject(MockStore);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiBaseUrl || '/api';
  private readonly useApi = !!(environment as { useApi?: boolean }).useApi;

  private requireAdmin(): Observable<never> | null {
    if (!this.auth.isAdmin()) {
      return throwError(() => ({ error: { message: 'Admin access required' } })).pipe(delay(150));
    }
    return null;
  }

  private actor(): UserAccount | undefined {
    return this.auth.user() ?? undefined;
  }

  users(): Observable<UserAccount[]> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    if (this.useApi) {
      return this.http.get<UserAccount[]>(`${this.apiBase}/admin/users`);
    }
    return of([...this.store.users]).pipe(delay(200));
  }

  setDeploymentAccess(userId: string, enabled: boolean): Observable<UserAccount> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    if (this.useApi) {
      return this.http.patch<UserAccount>(`${this.apiBase}/admin/users/${userId}/deployment-access`, { enabled });
    }
    try {
      return of(this.store.setDeploymentAccess(userId, enabled, this.actor())).pipe(delay(200));
    } catch {
      return throwError(() => ({ error: { message: 'User not found' } })).pipe(delay(150));
    }
  }

  setAccountStatus(userId: string, accountStatus: AccountStatus): Observable<UserAccount> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    if (this.useApi) {
      return this.http.patch<UserAccount>(`${this.apiBase}/admin/users/${userId}/account-status`, { accountStatus });
    }
    try {
      return of(this.store.setAccountStatus(userId, accountStatus, this.actor())).pipe(delay(200));
    } catch {
      return throwError(() => ({ error: { message: 'User not found' } })).pipe(delay(150));
    }
  }

  updateRole(userId: string, role: UserRole): Observable<UserAccount> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    if (this.useApi) {
      return this.http.patch<UserAccount>(`${this.apiBase}/admin/users/${userId}/role`, { role });
    }
    try {
      return of(this.store.setRole(userId, role, this.actor())).pipe(delay(200));
    } catch {
      return throwError(() => ({ error: { message: 'User not found' } })).pipe(delay(150));
    }
  }

  sendPasswordReset(userId: string): Observable<{ message?: string } | void> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    if (this.useApi) {
      return this.http.post<{ message: string }>(`${this.apiBase}/admin/users/${userId}/password-reset`, {});
    }
    try {
      this.store.sendPasswordReset(userId, this.actor());
      return of(void 0).pipe(delay(200));
    } catch {
      return throwError(() => ({ error: { message: 'User not found' } })).pipe(delay(150));
    }
  }

  infrastructure(): Observable<InfrastructureOverview> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    if (this.useApi) {
      return this.http.get<InfrastructureOverview>(`${this.apiBase}/admin/infrastructure`);
    }
    return of(this.store.infrastructure()).pipe(delay(200));
  }

  auditLogs(): Observable<AuditLogEntry[]> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    if (this.useApi) {
      return this.http.get<AuditLogEntry[]>(`${this.apiBase}/admin/audit-logs`);
    }
    return of(this.store.listAuditLogs()).pipe(delay(200));
  }
}
