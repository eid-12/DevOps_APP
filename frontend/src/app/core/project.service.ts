import { Injectable, inject } from '@angular/core';
import { delay, Observable, of, throwError } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { InfrastructureApiService } from './infrastructure-api.service';
import { MockStore } from './mock-store';
import {
  CreateProjectRequest,
  CreateServiceRequest,
  Deployment,
  EnvironmentVariable,
  Project,
  ResourceQuota,
  Service,
  ServiceLogLine,
  SharedVariable,
  UpdateProjectRequest,
  UpdateServiceRequest,
  VolumeMount
} from './models';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly store = inject(MockStore);
  private readonly auth = inject(AuthService);
  private readonly api = inject(InfrastructureApiService);
  private readonly useApi = !!(environment as { useApi?: boolean }).useApi;

  list(): Observable<Project[]> {
    if (this.useApi) {
      return this.api.listProjects();
    }
    try {
      const user = this.auth.requireUser();
      return of(this.store.listProjectsFor(user)).pipe(delay(200));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(150));
    }
  }

  get(projectId: string): Observable<Project> {
    if (this.useApi) {
      return this.api.getProject(projectId);
    }
    try {
      this.auth.requireUser();
      const project = this.store.getProject(projectId);
      if (!project) {
        return throwError(() => ({ error: { message: 'Project not found' } })).pipe(delay(150));
      }
      return of(structuredClone(project)).pipe(delay(200));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(150));
    }
  }

  getService(projectId: string, serviceId: string): Observable<{ project: Project; service: Service }> {
    if (this.useApi) {
      return this.api.getProject(projectId).pipe(
        // load service from nested list or dedicated endpoint
        switchMap(project => {
          const nested = project.services?.find(s => s.id === serviceId);
          if (nested) {
            return of({ project, service: nested });
          }
          return this.api.getServiceById(serviceId).pipe(
            map(service => ({ project, service }))
          );
        })
      );
    }
    try {
      this.auth.requireUser();
      const project = this.store.getProject(projectId);
      const service = this.store.findService(serviceId);
      if (!project || !service || service.projectId !== projectId) {
        return throwError(() => ({ error: { message: 'Service not found' } })).pipe(delay(150));
      }
      return of({
        project: structuredClone(project),
        service: structuredClone(service)
      }).pipe(delay(180));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(150));
    }
  }

  create(payload: CreateProjectRequest): Observable<Project> {
    if (this.useApi) {
      return this.api.createProject(payload);
    }
    try {
      const user = this.assertDeployAccess();
      return of(structuredClone(this.store.createProject(user, payload))).pipe(delay(300));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Please login first' } })).pipe(delay(150));
    }
  }

  update(projectId: string, patch: UpdateProjectRequest): Observable<Project> {
    if (this.useApi) {
      return this.api.updateProject(projectId, {
        name: patch.name,
        description: patch.description,
        status: patch.status
      });
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.updateProject(projectId, patch))).pipe(delay(220));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to update project' } })).pipe(delay(150));
    }
  }

  archive(projectId: string): Observable<Project> {
    return this.update(projectId, { status: 'ARCHIVED' });
  }

  restore(projectId: string): Observable<Project> {
    return this.update(projectId, { status: 'ACTIVE' });
  }

  delete(projectId: string): Observable<void> {
    if (this.useApi) {
      return this.api.deleteProject(projectId);
    }
    try {
      this.assertDeployAccess();
      this.store.deleteProject(projectId);
      return of(void 0).pipe(delay(200));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Please login first' } })).pipe(delay(150));
    }
  }

  updateService(serviceId: string, patch: UpdateServiceRequest): Observable<Service> {
    if (this.useApi) {
      const sourceDetails = patch.sourceDetails
        ? { ...patch.sourceDetails, ...(patch.runtime ? { runtime: patch.runtime } : {}) }
        : patch.runtime
          ? ({ runtime: patch.runtime } as UpdateServiceRequest['sourceDetails'])
          : undefined;
      return this.api.updateService(serviceId, {
        name: patch.name,
        sourceDetails,
        quota: patch.quota
          ? {
              memoryMb: patch.quota.memorymb,
              cpuMilli: patch.quota.cpuMilli,
              storageGb: patch.quota.storageGb
            }
          : undefined,
        volume: patch.removeVolume ? null : patch.volume ?? undefined,
        removeVolume: patch.removeVolume
      });
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.updateService(serviceId, patch))).pipe(delay(220));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to update service' } })).pipe(delay(150));
    }
  }

  cancelDeployment(deploymentId: string, serviceId?: string): Observable<Deployment> {
    if (this.useApi) {
      if (!serviceId) {
        return throwError(() => ({ error: { message: 'serviceId required to cancel deployment' } }));
      }
      return this.api.cancelDeployment(serviceId, deploymentId);
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.cancelDeployment(deploymentId))).pipe(delay(180));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Cancel failed' } })).pipe(delay(150));
    }
  }

  clone(projectId: string): Observable<Project> {
    try {
      const user = this.assertDeployAccess();
      return of(structuredClone(this.store.cloneProject(projectId, user))).pipe(delay(350));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Clone failed' } })).pipe(delay(150));
    }
  }

  restartService(serviceId: string): Observable<Service> {
    if (this.useApi) {
      return this.api.restartService(serviceId);
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.restartService(serviceId))).pipe(delay(200));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Restart failed' } })).pipe(delay(150));
    }
  }

  dbConnection(serviceId: string): Observable<Record<string, string>> {
    if (this.useApi) {
      return this.api.getDbConnection(serviceId);
    }
    try {
      this.auth.requireUser();
      return of(this.store.dbConnectionInfo(serviceId)).pipe(delay(120));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Not available' } })).pipe(delay(100));
    }
  }

  addService(projectId: string, payload: CreateServiceRequest): Observable<Service> {
    if (this.useApi) {
      const body = {
        ...payload,
        quota: payload.quota
          ? {
              memoryMb: payload.quota.memorymb ?? (payload.quota as { memoryMb?: number }).memoryMb ?? 512,
              cpuMilli: payload.quota.cpuMilli ?? 500,
              storageGb: payload.quota.storageGb ?? 2
            }
          : undefined
      };
      return this.api.addService(projectId, body);
    }
    try {
      this.assertDeployAccess();
      return of(this.store.addService(projectId, payload)).pipe(delay(300));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to add service' } })).pipe(delay(150));
    }
  }

  stopService(serviceId: string): Observable<Service> {
    if (this.useApi) {
      return this.api.stopService(serviceId);
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.updateServiceStatus(serviceId, 'STOPPED'))).pipe(delay(200));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to stop service' } })).pipe(delay(150));
    }
  }

  deleteService(serviceId: string): Observable<void> {
    if (this.useApi) {
      return this.api.deleteService(serviceId);
    }
    try {
      this.assertDeployAccess();
      this.store.deleteService(serviceId);
      return of(void 0).pipe(delay(200));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to delete service' } })).pipe(delay(150));
    }
  }

  deploy(serviceId: string): Observable<Deployment> {
    if (this.useApi) {
      return this.api.deploy(serviceId);
    }
    try {
      const user = this.assertDeployAccess();
      return of(structuredClone(this.store.deploy(serviceId, user.email))).pipe(delay(300));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Deploy failed' } })).pipe(delay(150));
    }
  }

  rollback(serviceId: string, deploymentId: string): Observable<Deployment> {
    if (this.useApi) {
      return this.api.rollback(serviceId, deploymentId);
    }
    try {
      const user = this.assertDeployAccess();
      return of(structuredClone(this.store.rollback(serviceId, deploymentId, user.email))).pipe(delay(280));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Rollback failed' } })).pipe(delay(150));
    }
  }

  listSharedVariables(projectId: string): Observable<SharedVariable[]> {
    if (this.useApi) {
      return this.api.listSharedVariables(projectId);
    }
    try {
      this.auth.requireUser();
      return of(structuredClone(this.store.listSharedVariables(projectId))).pipe(delay(120));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to load variables' } })).pipe(delay(100));
    }
  }

  upsertSharedVariable(
    projectId: string,
    payload: { id?: string; key: string; value: string; isSecret: boolean; serviceIds: string[] }
  ): Observable<SharedVariable> {
    if (this.useApi) {
      return this.api.upsertSharedVariable(projectId, payload);
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.upsertSharedVariable(projectId, payload))).pipe(delay(220));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to save variable' } })).pipe(delay(150));
    }
  }

  deleteSharedVariable(projectId: string, variableId: string): Observable<void> {
    if (this.useApi) {
      return this.api.deleteSharedVariable(projectId, variableId);
    }
    try {
      this.assertDeployAccess();
      this.store.deleteSharedVariable(projectId, variableId);
      return of(void 0).pipe(delay(160));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to delete variable' } })).pipe(delay(120));
    }
  }

  getDeployments(serviceId: string): Observable<Deployment[]> {
    if (this.useApi) {
      return this.api.getDeployments(serviceId);
    }
    try {
      this.auth.requireUser();
      return of(structuredClone(this.store.getDeployments(serviceId))).pipe(delay(150));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(150));
    }
  }

  getLogs(serviceId: string): Observable<ServiceLogLine[]> {
    if (this.useApi) {
      return this.api.getLogs(serviceId);
    }
    try {
      this.auth.requireUser();
      return of(this.store.getServiceLogs(serviceId)).pipe(delay(120));
    } catch {
      return throwError(() => ({ error: { message: 'Please login first' } })).pipe(delay(150));
    }
  }

  nextLiveLog(serviceId: string): ServiceLogLine | null {
    if (this.useApi) {
      return null; // live mode polls getLogs instead
    }
    return this.store.nextLiveLog(serviceId);
  }

  updateEnvVars(serviceId: string, envVars: EnvironmentVariable[]): Observable<Service> {
    if (this.useApi) {
      return this.api.updateEnvVars(serviceId, envVars);
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.updateEnvVars(serviceId, envVars))).pipe(delay(220));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to save variables' } })).pipe(delay(150));
    }
  }

  updateQuota(serviceId: string, quota: Partial<ResourceQuota>): Observable<Service> {
    if (this.useApi) {
      return this.updateService(serviceId, { quota });
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.updateQuota(serviceId, quota))).pipe(delay(220));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to update resources' } })).pipe(delay(150));
    }
  }

  updateVolume(serviceId: string, volume?: VolumeMount): Observable<Service> {
    if (this.useApi) {
      return this.updateService(serviceId, volume
        ? { volume }
        : { removeVolume: true });
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.updateVolume(serviceId, volume))).pipe(delay(220));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to update volume' } })).pipe(delay(150));
    }
  }

  setSubdomain(serviceId: string, subdomain: string): Observable<Service> {
    return this.setCustomDomain(serviceId, subdomain);
  }

  setCustomDomain(serviceId: string, domain: string): Observable<Service> {
    if (this.useApi) {
      return this.api.setCustomDomain(serviceId, domain);
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.setCustomDomain(serviceId, domain))).pipe(delay(220));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to update domain' } })).pipe(delay(150));
    }
  }

  checkCustomDomain(
    serviceId: string,
    domain: string
  ): Observable<{ domain: string; available: boolean; reason: string }> {
    if (this.useApi) {
      return this.api.checkCustomDomain(serviceId, domain);
    }
    try {
      this.auth.requireUser();
      return of(this.store.checkCustomDomain(serviceId, domain)).pipe(delay(120));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Check failed' } })).pipe(delay(100));
    }
  }

  vanityStatus(serviceId: string): Observable<{
    baseDomain: string;
    limitPerAccount: number;
    claimedSlug?: string | null;
    claimedFqdn?: string | null;
    claimedServiceId?: string | null;
    thisServiceHoldsVanity: boolean;
  }> {
    if (this.useApi) {
      return this.api.vanityStatus(serviceId);
    }
    try {
      this.auth.requireUser();
      return of(this.store.vanityStatus(serviceId, this.auth.requireUser().id)).pipe(delay(80));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed' } })).pipe(delay(80));
    }
  }

  checkVanitySubdomain(
    serviceId: string,
    slug: string
  ): Observable<{ domain: string; available: boolean; reason: string }> {
    if (this.useApi) {
      return this.api.checkVanitySubdomain(serviceId, slug);
    }
    try {
      this.auth.requireUser();
      return of(this.store.checkVanitySubdomain(serviceId, this.auth.requireUser().id, slug)).pipe(delay(120));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Check failed' } })).pipe(delay(100));
    }
  }

  setVanitySubdomain(serviceId: string, slug: string): Observable<Service> {
    if (this.useApi) {
      return this.api.setVanitySubdomain(serviceId, slug);
    }
    try {
      const user = this.assertDeployAccess();
      return of(structuredClone(this.store.setVanitySubdomain(serviceId, user.id, slug))).pipe(
        delay(220)
      );
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to claim subdomain' } })).pipe(
        delay(150)
      );
    }
  }

  clearVanitySubdomain(serviceId: string): Observable<Service> {
    if (this.useApi) {
      return this.api.clearVanitySubdomain(serviceId);
    }
    try {
      const user = this.assertDeployAccess();
      return of(structuredClone(this.store.clearVanitySubdomain(serviceId, user.id))).pipe(
        delay(220)
      );
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to release subdomain' } })).pipe(
        delay(150)
      );
    }
  }

  clearCustomDomain(serviceId: string): Observable<Service> {
    if (this.useApi) {
      return this.api.clearCustomDomain(serviceId);
    }
    try {
      this.assertDeployAccess();
      return of(structuredClone(this.store.setCustomDomain(serviceId, ''))).pipe(delay(220));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Failed to clear domain' } })).pipe(delay(150));
    }
  }

  runTerminal(serviceId: string, command: string): Observable<string[]> {
    if (this.useApi) {
      return this.api.exec(serviceId, command);
    }
    try {
      this.assertDeployAccess();
      return of(this.store.runTerminalCommand(serviceId, command)).pipe(delay(80 + Math.random() * 180));
    } catch (e) {
      return throwError(() => ({ error: { message: (e as Error).message ?? 'Shell error' } })).pipe(delay(100));
    }
  }

  getMetrics(serviceId: string, range = '1h'): Observable<Record<string, unknown>> {
    if (this.useApi) {
      return this.api.getMetrics(serviceId, range);
    }
    return of({ available: false, history: [] });
  }

  /** Mock-mode hard gate — mirrors backend requireDeploymentEnabled. */
  private assertDeployAccess() {
    const user = this.auth.requireUser();
    if (!this.auth.hasDeployAccess()) {
      throw new Error(
        user.accountStatus === 'SUSPENDED'
          ? 'Account is suspended. Deploy and manage actions are blocked.'
          : 'Deploy access is locked. An admin must enable Deploy first.'
      );
    }
    return user;
  }
}
