import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { InfrastructureApiService } from './infrastructure-api.service';
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

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly api = inject(InfrastructureApiService);

  list(): Observable<Project[]> {
    return this.api.listProjects();
  }

  get(projectId: string): Observable<Project> {
    return this.api.getProject(projectId);
  }

  getService(projectId: string, serviceId: string): Observable<{ project: Project; service: Service }> {
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

  create(payload: CreateProjectRequest): Observable<Project> {
    return this.api.createProject(payload);
  }

  update(projectId: string, patch: UpdateProjectRequest): Observable<Project> {
    return this.api.updateProject(projectId, {
      name: patch.name,
      description: patch.description,
      status: patch.status
    });
  }

  archive(projectId: string): Observable<Project> {
    return this.update(projectId, { status: 'ARCHIVED' });
  }

  restore(projectId: string): Observable<Project> {
    return this.update(projectId, { status: 'ACTIVE' });
  }

  delete(projectId: string): Observable<void> {
    return this.api.deleteProject(projectId);
  }

  updateService(serviceId: string, patch: UpdateServiceRequest): Observable<Service> {
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

  cancelDeployment(deploymentId: string, serviceId?: string): Observable<Deployment> {
    if (!serviceId) {
      return throwError(() => ({ error: { message: 'serviceId required to cancel deployment' } }));
    }
    return this.api.cancelDeployment(serviceId, deploymentId);
  }

  restartService(serviceId: string): Observable<Service> {
    return this.api.restartService(serviceId);
  }

  dbConnection(serviceId: string): Observable<Record<string, string>> {
    return this.api.getDbConnection(serviceId);
  }

  addService(projectId: string, payload: CreateServiceRequest): Observable<Service> {
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

  stopService(serviceId: string): Observable<Service> {
    return this.api.stopService(serviceId);
  }

  deleteService(serviceId: string): Observable<void> {
    return this.api.deleteService(serviceId);
  }

  deploy(serviceId: string): Observable<Deployment> {
    return this.api.deploy(serviceId);
  }

  syncGitHubCi(serviceId: string): Observable<Service> {
    return this.api.syncGitHubCi(serviceId);
  }

  rollback(serviceId: string, deploymentId: string): Observable<Deployment> {
    return this.api.rollback(serviceId, deploymentId);
  }

  listSharedVariables(projectId: string): Observable<SharedVariable[]> {
    return this.api.listSharedVariables(projectId);
  }

  upsertSharedVariable(
    projectId: string,
    payload: { id?: string; key: string; value: string; isSecret: boolean; serviceIds: string[] }
  ): Observable<SharedVariable> {
    return this.api.upsertSharedVariable(projectId, payload);
  }

  deleteSharedVariable(projectId: string, variableId: string): Observable<void> {
    return this.api.deleteSharedVariable(projectId, variableId);
  }

  getDeployments(serviceId: string): Observable<Deployment[]> {
    return this.api.getDeployments(serviceId);
  }

  getLogs(serviceId: string): Observable<ServiceLogLine[]> {
    return this.api.getLogs(serviceId);
  }

  nextLiveLog(serviceId: string): ServiceLogLine | null {
    return null;
  }

  updateEnvVars(serviceId: string, envVars: EnvironmentVariable[]): Observable<Service> {
    return this.api.updateEnvVars(serviceId, envVars);
  }

  updateQuota(serviceId: string, quota: Partial<ResourceQuota>): Observable<Service> {
    return this.updateService(serviceId, { quota });
  }

  updateVolume(serviceId: string, volume?: VolumeMount): Observable<Service> {
    return this.updateService(serviceId, volume
      ? { volume }
      : { removeVolume: true });
  }

  setSubdomain(serviceId: string, subdomain: string): Observable<Service> {
    return this.setCustomDomain(serviceId, subdomain);
  }

  setCustomDomain(serviceId: string, domain: string): Observable<Service> {
    return this.api.setCustomDomain(serviceId, domain);
  }

  checkCustomDomain(
    serviceId: string,
    domain: string
  ): Observable<{ domain: string; available: boolean; reason: string }> {
    return this.api.checkCustomDomain(serviceId, domain);
  }

  vanityStatus(serviceId: string): Observable<{
    baseDomain: string;
    limitPerAccount: number;
    claimedSlug?: string | null;
    claimedFqdn?: string | null;
    claimedServiceId?: string | null;
    thisServiceHoldsVanity: boolean;
  }> {
    return this.api.vanityStatus(serviceId);
  }

  checkVanitySubdomain(
    serviceId: string,
    slug: string
  ): Observable<{ domain: string; available: boolean; reason: string }> {
    return this.api.checkVanitySubdomain(serviceId, slug);
  }

  setVanitySubdomain(serviceId: string, slug: string): Observable<Service> {
    return this.api.setVanitySubdomain(serviceId, slug);
  }

  clearVanitySubdomain(serviceId: string): Observable<Service> {
    return this.api.clearVanitySubdomain(serviceId);
  }

  clearCustomDomain(serviceId: string): Observable<Service> {
    return this.api.clearCustomDomain(serviceId);
  }

  runTerminal(serviceId: string, command: string): Observable<string[]> {
    return this.api.exec(serviceId, command);
  }

  getMetrics(serviceId: string, range = '1h'): Observable<Record<string, unknown>> {
    return this.api.getMetrics(serviceId, range);
  }
}
