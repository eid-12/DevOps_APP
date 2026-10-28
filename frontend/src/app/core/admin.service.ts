import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { delay, Observable, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { AccountStatus, AuditLogEntry, HostingSettings, HostingSettingsUpdate, InfrastructureOverview, UserAccount, UserRole } from './models';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiBaseUrl || '/api';

  private requireAdmin(): Observable<never> | null {
    if (!this.auth.isAdmin()) {
      return throwError(() => ({ error: { message: 'Admin access required' } })).pipe(delay(150));
    }
    return null;
  }

  users(): Observable<UserAccount[]> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    return this.http.get<UserAccount[]>(`${this.apiBase}/admin/users`);
  }

  setDeploymentAccess(userId: string, enabled: boolean): Observable<UserAccount> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    return this.http.patch<UserAccount>(`${this.apiBase}/admin/users/${userId}/deployment-access`, { enabled });
  }

  setAccountStatus(userId: string, accountStatus: AccountStatus): Observable<UserAccount> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    return this.http.patch<UserAccount>(`${this.apiBase}/admin/users/${userId}/account-status`, { accountStatus });
  }

  updateRole(userId: string, role: UserRole): Observable<UserAccount> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    return this.http.patch<UserAccount>(`${this.apiBase}/admin/users/${userId}/role`, { role });
  }

  sendPasswordReset(userId: string): Observable<{ message?: string } | void> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    return this.http.post<{ message: string }>(`${this.apiBase}/admin/users/${userId}/password-reset`, {});
  }

  verifyEmail(userId: string): Observable<UserAccount> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    return this.http.post<UserAccount>(`${this.apiBase}/admin/users/${userId}/verify-email`, {});
  }

  infrastructure(): Observable<InfrastructureOverview> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    return this.http.get<InfrastructureOverview>(`${this.apiBase}/admin/infrastructure`);
  }

  auditLogs(): Observable<AuditLogEntry[]> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    return this.http.get<AuditLogEntry[]>(`${this.apiBase}/admin/audit-logs`);
  }

  hostingSettings(): Observable<HostingSettings> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    return this.http.get<HostingSettings>(`${this.apiBase}/admin/hosting-settings`);
  }

  updateHostingSettings(payload: HostingSettingsUpdate): Observable<HostingSettings> {
    const denied = this.requireAdmin();
    if (denied) return denied;
    return this.http.put<HostingSettings>(`${this.apiBase}/admin/hosting-settings`, payload);
  }
}
