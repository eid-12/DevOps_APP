import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  Deployment,
  EnvironmentVariable,
  Project,
  Service,
  ServiceLogLine,
  SharedVariable
} from './models';

/**
 * HTTP wrappers for infrastructure orchestration endpoints
 * (Portainer deploy/rollback, env apply, NPM subdomain, GitHub webhook is server-only).
 *
 * Use when environment.useApi === true, or call directly from pages during cutover.
 */
@Injectable({ providedIn: 'root' })
export class InfrastructureApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl || '/api';

  deploy(serviceId: string, body?: { commitSha?: string; imageTag?: string }): Observable<Deployment> {
    return this.http
      .post<BackendDeployment>(`${this.base}/projects/services/${serviceId}/deploy`, body ?? {})
      .pipe(map(mapDeployment));
  }

  rollback(serviceId: string, deploymentId: string): Observable<Deployment> {
    return this.http
      .post<BackendDeployment>(
        `${this.base}/projects/services/${serviceId}/deployments/${deploymentId}/rollback`,
        {}
      )
      .pipe(map(mapDeployment));
  }

  getDeployments(serviceId: string): Observable<Deployment[]> {
    return this.http
      .get<BackendDeployment[]>(`${this.base}/projects/services/${serviceId}/deployments`)
      .pipe(map(list => list.map(mapDeployment)));
  }

  updateEnvVars(serviceId: string, envVars: EnvironmentVariable[]): Observable<Service> {
    return this.http
      .put<BackendService>(`${this.base}/projects/services/${serviceId}/env`, { envVars })
      .pipe(map(mapService));
  }

  setSubdomain(serviceId: string, subdomain: string): Observable<Service> {
    return this.setCustomDomain(serviceId, subdomain);
  }

  setCustomDomain(serviceId: string, domain: string): Observable<Service> {
    return this.http
      .put<BackendService>(`${this.base}/projects/services/${serviceId}/custom-domain`, { domain })
      .pipe(map(mapService));
  }

  checkCustomDomain(
    serviceId: string,
    domain: string
  ): Observable<{ domain: string; available: boolean; reason: string }> {
    return this.http.get<{ domain: string; available: boolean; reason: string }>(
      `${this.base}/projects/services/${serviceId}/custom-domain/check`,
      { params: { domain: domain ?? '' } }
    );
  }

  vanityStatus(serviceId: string): Observable<{
    baseDomain: string;
    limitPerAccount: number;
    claimedSlug?: string | null;
    claimedFqdn?: string | null;
    claimedServiceId?: string | null;
    thisServiceHoldsVanity: boolean;
  }> {
    return this.http.get<{
      baseDomain: string;
      limitPerAccount: number;
      claimedSlug?: string | null;
      claimedFqdn?: string | null;
      claimedServiceId?: string | null;
      thisServiceHoldsVanity: boolean;
    }>(`${this.base}/projects/services/${serviceId}/vanity-subdomain`);
  }

  checkVanitySubdomain(
    serviceId: string,
    slug: string
  ): Observable<{ domain: string; available: boolean; reason: string }> {
    return this.http.get<{ domain: string; available: boolean; reason: string }>(
      `${this.base}/projects/services/${serviceId}/vanity-subdomain/check`,
      { params: { slug: slug ?? '' } }
    );
  }

  setVanitySubdomain(serviceId: string, slug: string): Observable<Service> {
    return this.http
      .put<BackendService>(`${this.base}/projects/services/${serviceId}/vanity-subdomain`, { slug })
      .pipe(map(mapService));
  }

  clearVanitySubdomain(serviceId: string): Observable<Service> {
    return this.http
      .delete<BackendService>(`${this.base}/projects/services/${serviceId}/vanity-subdomain`)
      .pipe(map(mapService));
  }

  clearCustomDomain(serviceId: string): Observable<Service> {
    return this.http
      .delete<BackendService>(`${this.base}/projects/services/${serviceId}/custom-domain`)
      .pipe(map(mapService));
  }

  stopService(serviceId: string): Observable<Service> {
    return this.http
      .post<BackendService>(`${this.base}/projects/services/${serviceId}/stop`, {})
      .pipe(map(mapService));
  }

  deleteService(serviceId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/projects/services/${serviceId}`);
  }

  addService(projectId: string, payload: unknown): Observable<Service> {
    return this.http
      .post<BackendService>(`${this.base}/projects/${projectId}/services`, payload)
      .pipe(map(mapService));
  }

  listProjects(): Observable<Project[]> {
    return this.http
      .get<BackendProject[]>(`${this.base}/projects`)
      .pipe(map(list => list.map(mapProject)));
  }

  getProject(projectId: string): Observable<Project> {
    return this.http
      .get<BackendProject>(`${this.base}/projects/${projectId}`)
      .pipe(map(mapProject));
  }

  createProject(payload: { name: string; description?: string }): Observable<Project> {
    return this.http
      .post<BackendProject>(`${this.base}/projects`, {
        name: payload.name,
        description: payload.description ?? ''
      })
      .pipe(map(mapProject));
  }

  deleteProject(projectId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/projects/${projectId}`);
  }

  getServiceById(serviceId: string): Observable<Service> {
    return this.http
      .get<BackendService>(`${this.base}/projects/services/${serviceId}`)
      .pipe(map(mapService));
  }

  getLogs(serviceId: string, tail = 200): Observable<ServiceLogLine[]> {
    return this.http
      .get<Array<{ id?: string; timestamp?: string; level?: string; message?: string }>>(
        `${this.base}/projects/services/${serviceId}/logs`,
        { params: { tail: String(tail) } }
      )
      .pipe(
        map(list =>
          (list ?? []).map((l, i) => ({
            id: l.id ?? `log-${i}`,
            timestamp: l.timestamp ?? new Date().toISOString(),
            level: (l.level as ServiceLogLine['level']) ?? 'info',
            message: l.message ?? ''
          }))
        )
      );
  }

  exec(serviceId: string, command: string): Observable<string[]> {
    return this.http
      .post<{ output: string[] }>(`${this.base}/projects/services/${serviceId}/exec`, { command })
      .pipe(map(r => r.output ?? []));
  }

  getMetrics(serviceId: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.base}/projects/services/${serviceId}/metrics`);
  }

  getDbConnection(serviceId: string): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>(`${this.base}/projects/services/${serviceId}/db-connection`);
  }

  restartService(serviceId: string): Observable<Service> {
    return this.http
      .post<BackendService>(`${this.base}/projects/services/${serviceId}/restart`, {})
      .pipe(map(mapService));
  }

  listSharedVariables(projectId: string): Observable<SharedVariable[]> {
    return this.http
      .get<SharedVariable[]>(`${this.base}/projects/${projectId}/variables`)
      .pipe(map(list => (list ?? []).map(mapSharedVar)));
  }

  upsertSharedVariable(
    projectId: string,
    payload: { id?: string; key: string; value: string; isSecret: boolean; serviceIds: string[] }
  ): Observable<SharedVariable> {
    return this.http
      .put<SharedVariable>(`${this.base}/projects/${projectId}/variables`, payload)
      .pipe(map(mapSharedVar));
  }

  deleteSharedVariable(projectId: string, variableId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/projects/${projectId}/variables/${variableId}`);
  }

  updateProject(projectId: string, patch: {
    name?: string;
    description?: string;
    status?: Project['status'];
  }): Observable<Project> {
    return this.http
      .put<BackendProject>(`${this.base}/projects/${projectId}`, patch)
      .pipe(map(mapProject));
  }

  updateService(serviceId: string, patch: {
    name?: string;
    sourceDetails?: Service['sourceDetails'];
    quota?: { memoryMb?: number; cpuMilli?: number; storageGb?: number };
    volume?: { mountPath: string; sizeGb: number } | null;
    removeVolume?: boolean;
  }): Observable<Service> {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body['name'] = patch.name;
    if (patch.sourceDetails !== undefined) body['sourceDetails'] = patch.sourceDetails;
    if (patch.quota) {
      body['quota'] = {
        memoryMb: patch.quota.memoryMb ?? 512,
        cpuMilli: patch.quota.cpuMilli ?? 500,
        storageGb: patch.quota.storageGb ?? 2
      };
    }
    if (patch.removeVolume) body['removeVolume'] = true;
    else if (patch.volume) body['volume'] = patch.volume;
    return this.http
      .put<BackendService>(`${this.base}/projects/services/${serviceId}`, body)
      .pipe(map(mapService));
  }

  cancelDeployment(serviceId: string, deploymentId: string): Observable<Deployment> {
    return this.http
      .post<BackendDeployment>(
        `${this.base}/projects/services/${serviceId}/deployments/${deploymentId}/cancel`,
        {}
      )
      .pipe(map(mapDeployment));
  }
}

function mapSharedVar(v: SharedVariable | Record<string, unknown>): SharedVariable {
  const r = v as Record<string, unknown>;
  return {
    id: String(r['id'] ?? ''),
    key: String(r['key'] ?? ''),
    value: String(r['value'] ?? ''),
    isSecret: !!r['isSecret'],
    serviceIds: Array.isArray(r['serviceIds']) ? (r['serviceIds'] as string[]).map(String) : [],
    updatedAt: String(r['updatedAt'] ?? new Date().toISOString())
  };
}

interface BackendProject {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  description?: string;
  status: Project['status'];
  createdAt?: string;
  services?: BackendService[];
  sharedVariables?: Array<Record<string, unknown>>;
}

interface BackendDeployment {
  id: string;
  serviceId: string;
  projectId: string;
  status: Deployment['status'];
  triggeredBy?: string;
  commitSha?: string;
  imageTag?: string;
  rollbackOf?: string;
  startedAt: string;
  finishedAt?: string;
  logs?: string;
}

interface BackendService {
  id: string;
  project?: { id: string };
  projectId?: string;
  name: string;
  sourceType: Service['sourceType'];
  sourceDetails: Service['sourceDetails'];
  status: Service['status'];
  subdomain?: string;
  customDomain?: string;
  envVars?: Record<string, unknown>;
  envPendingDeploy?: boolean;
  containerName?: string;
  containerPort?: number;
  quotaMemoryMb?: number;
  quotaCpuMilli?: number;
  quotaStorageGb?: number;
  volumeMountPath?: string;
  volumeSizeGb?: number;
  latestDeploymentId?: string;
  createdAt?: string;
  cpuUsage?: number;
  ramUsageMb?: number;
}

function mapProject(p: BackendProject): Project {
  const services = (p.services ?? []).map(s =>
    mapService({ ...s, projectId: s.projectId ?? p.id, project: s.project ?? { id: p.id } })
  );
  return {
    id: p.id,
    ownerId: p.ownerId,
    ownerName: p.ownerName,
    name: p.name,
    description: p.description ?? '',
    environment: 'production',
    status: p.status,
    createdAt: p.createdAt ?? new Date().toISOString(),
    services,
    sharedVariables: (p.sharedVariables ?? []).map(mapSharedVar)
  };
}

function mapDeployment(d: BackendDeployment): Deployment {
  return {
    id: d.id,
    serviceId: d.serviceId,
    projectId: d.projectId,
    status: d.status,
    triggeredBy: d.triggeredBy ?? '',
    commitSha: d.commitSha,
    imageTag: d.imageTag,
    rollbackOf: d.rollbackOf,
    startedAt: d.startedAt,
    finishedAt: d.finishedAt,
    logs: d.logs
  };
}

function resolveRuntime(s: BackendService): Service['runtime'] {
  if (s.sourceType === 'DATABASE' || s.sourceType === 'DOCKER') {
    return 'other';
  }
  const fromApi = (s as { runtime?: Service['runtime'] }).runtime;
  if (fromApi) return fromApi;
  const details = s.sourceDetails as unknown as Record<string, unknown> | undefined;
  const raw = details?.['runtime'];
  if (
    raw === 'node' || raw === 'java' || raw === 'python' || raw === 'go' ||
    raw === 'dotnet' || raw === 'php' || raw === 'rust' || raw === 'other'
  ) {
    return raw;
  }
  return 'node';
}

function mapService(s: BackendService): Service {
  const envVars: EnvironmentVariable[] = [];
  if (s.envVars) {
    for (const [key, raw] of Object.entries(s.envVars)) {
      if (raw && typeof raw === 'object' && 'value' in (raw as object)) {
        const o = raw as { value?: string; isSecret?: boolean };
        envVars.push({ key, value: String(o.value ?? ''), isSecret: !!o.isSecret });
      } else {
        envVars.push({ key, value: String(raw ?? ''), isSecret: false });
      }
    }
  }

  return {
    id: s.id,
    projectId: s.projectId ?? s.project?.id ?? '',
    name: s.name,
    sourceType: s.sourceType,
    sourceDetails: s.sourceDetails,
    status: s.status,
    subdomain: s.subdomain,
    customDomain: s.customDomain,
    containerPort: s.containerPort,
    containerName: s.containerName,
    envVars,
    envPendingDeploy: s.envPendingDeploy,
    runtime: resolveRuntime(s),
    quota: {
      memorymb: s.quotaMemoryMb ?? 512,
      cpuMilli: s.quotaCpuMilli ?? 500,
      storageGb: s.quotaStorageGb ?? 2
    },
    volume: s.volumeMountPath
      ? { mountPath: s.volumeMountPath, sizeGb: s.volumeSizeGb ?? 2 }
      : undefined,
    latestDeploymentId: s.latestDeploymentId,
    createdAt: s.createdAt ?? new Date().toISOString(),
    cpuUsage: s.cpuUsage ?? 0,
    ramUsageMb: s.ramUsageMb ?? 0
  };
}
