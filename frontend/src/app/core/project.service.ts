import { Injectable, inject } from '@angular/core';
import { delay, Observable, of, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { MockStore } from './mock-store';
import { ProjectRecord } from './models';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly store = inject(MockStore);
  private readonly auth = inject(AuthService);

  list(): Observable<ProjectRecord[]> {
    try {
      const user = this.auth.requireUser();
      return of(this.store.listProjectsFor(user)).pipe(delay(200));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(150));
    }
  }

  create(payload: {
    name: string;
    repository: string;
    framework: string;
    branch: string;
    subdomain: string;
  }): Observable<ProjectRecord> {
    try {
      const user = this.auth.requireUser();
      if (!user.deploymentEnabled) {
        return throwError(() => ({ error: { message: 'Deployment access disabled for this user' } })).pipe(delay(200));
      }
      return of(this.store.createProject(user, payload)).pipe(delay(300));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(150));
    }
  }

  start(projectId: string): Observable<ProjectRecord> {
    try {
      this.auth.requireUser();
      return of(this.store.setProjectStatus(projectId, 'RUNNING')).pipe(delay(200));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(150));
    }
  }

  stop(projectId: string): Observable<ProjectRecord> {
    try {
      this.auth.requireUser();
      return of(this.store.setProjectStatus(projectId, 'STOPPED')).pipe(delay(200));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(150));
    }
  }
}
