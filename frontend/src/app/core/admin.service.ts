import { Injectable, inject } from '@angular/core';
import { delay, Observable, of, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { MockStore } from './mock-store';
import { InfrastructureOverview, ProjectRecord, UserAccount, AuditLogEntry } from './models';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly store = inject(MockStore);
  private readonly auth = inject(AuthService);

  users(): Observable<UserAccount[]> {
    if (!this.auth.isAdmin()) {
      return throwError(() => ({ error: { message: 'Admin access required' } })).pipe(delay(150));
    }
    return of([...this.store.users]).pipe(delay(200));
  }

  setDeploymentAccess(userId: string, enabled: boolean): Observable<UserAccount> {
    if (!this.auth.isAdmin()) {
      return throwError(() => ({ error: { message: 'Admin access required' } })).pipe(delay(150));
    }

    const user = this.store.findUserById(userId);
    if (!user) {
      return throwError(() => ({ error: { message: 'User not found' } })).pipe(delay(150));
    }

    return of(this.store.updateUser({ ...user, deploymentEnabled: enabled }, this.auth.user() ?? undefined)).pipe(delay(200));
  }

  pendingProjects(): Observable<ProjectRecord[]> {
    if (!this.auth.isAdmin()) {
      return throwError(() => ({ error: { message: 'Admin access required' } })).pipe(delay(150));
    }
    return of(this.store.pendingProjects()).pipe(delay(200));
  }

  approveProject(projectId: string, payload: { memory: string; cpu: string }): Observable<ProjectRecord> {
    if (!this.auth.isAdmin()) {
      return throwError(() => ({ error: { message: 'Admin access required' } })).pipe(delay(150));
    }
    return of(this.store.approveProject(projectId, payload.memory, payload.cpu, this.auth.user() ?? undefined)).pipe(delay(300));
  }

  infrastructure(): Observable<InfrastructureOverview> {
    if (!this.auth.isAdmin()) {
      return throwError(() => ({ error: { message: 'Admin access required' } })).pipe(delay(150));
    }
    return of(this.store.infrastructure()).pipe(delay(200));
  }

  auditLogs(): Observable<AuditLogEntry[]> {
    if (!this.auth.isAdmin()) {
      return throwError(() => ({ error: { message: 'Admin access required' } })).pipe(delay(150));
    }
    return of(this.store.listAuditLogs()).pipe(delay(200));
  }
}
