import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, TimeoutError, catchError, forkJoin, map, of, switchMap, timeout } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PortainerHostMetrics {
  connected: boolean;
  endpointId: number;
  endpointName: string;
  runningContainers: number;
  totalContainers: number;
  healthyContainers: number;
  unhealthyContainers: number;
  stacks: number;
  images: number;
  volumes: number;
  totalCpu: number;
  totalMemoryGb: number;
  dockerVersion: string;
  error?: string;
}

interface PortainerSnapshot {
  RunningContainerCount: number;
  ContainerCount: number;
  HealthyContainerCount: number;
  UnhealthyContainerCount: number;
  StackCount: number;
  ImageCount: number;
  VolumeCount: number;
  TotalCPU: number;
  TotalMemory: number;
  DockerVersion: string;
}

interface PortainerEndpoint {
  Id: number;
  Name: string;
  Status: number;
  Snapshots?: PortainerSnapshot[];
}

interface PortainerStack {
  EndpointId?: number;
}

interface PortainerContainer {
  State: string;
  Health?: { Status: string };
}

@Injectable({ providedIn: 'root' })
export class PortainerService {
  private readonly http = inject(HttpClient);

  private headers(): HttpHeaders {
    return new HttpHeaders({
      'X-API-Key': environment.portainerToken,
      'X-Skip-Spinner': '1'
    });
  }

  private emptyMetrics(error?: string): PortainerHostMetrics {
    return {
      connected: false,
      endpointId: environment.portainerEndpointId,
      endpointName: 'local',
      runningContainers: 0,
      totalContainers: 0,
      healthyContainers: 0,
      unhealthyContainers: 0,
      stacks: 0,
      images: 0,
      volumes: 0,
      totalCpu: 0,
      totalMemoryGb: 0,
      dockerVersion: '—',
      error
    };
  }

  getHostMetrics(): Observable<PortainerHostMetrics> {
    const endpointId = environment.portainerEndpointId;
    const base = environment.portainerBaseUrl;

    return this.http
      .get<PortainerEndpoint>(`${base}/api/endpoints/${endpointId}`, {
        headers: this.headers()
      })
      .pipe(
        timeout(6000),
        switchMap((endpoint) => {
          const snap = endpoint.Snapshots?.[0];
          if (snap) {
            return of(this.mapMetrics(endpoint, snap));
          }

          return forkJoin({
            containers: this.http.get<PortainerContainer[]>(
              `${base}/api/endpoints/${endpointId}/docker/containers/json?all=1`,
              { headers: this.headers() }
            ),
            images: this.http.get<unknown[]>(
              `${base}/api/endpoints/${endpointId}/docker/images/json`,
              { headers: this.headers() }
            ),
            volumes: this.http.get<{ Volumes?: unknown[] }>(
              `${base}/api/endpoints/${endpointId}/docker/volumes`,
              { headers: this.headers() }
            ),
            stacks: this.http.get<PortainerStack[]>(`${base}/api/stacks`, {
              headers: this.headers()
            })
          }).pipe(
            timeout(8000),
            map(({ containers, images, volumes, stacks }) => {
              const running = containers.filter((item) => item.State === 'running').length;
              const healthy = containers.filter((item) => item.Health?.Status === 'healthy').length;
              const unhealthy = containers.filter((item) => item.Health?.Status === 'unhealthy').length;
              const endpointStacks = stacks.filter((stack) => stack.EndpointId === endpointId);

              return {
                connected: endpoint.Status === 1,
                endpointId: endpoint.Id,
                endpointName: endpoint.Name,
                runningContainers: running,
                totalContainers: containers.length,
                healthyContainers: healthy,
                unhealthyContainers: unhealthy,
                stacks: endpointStacks.length,
                images: images.length,
                volumes: volumes.Volumes?.length ?? 0,
                totalCpu: 0,
                totalMemoryGb: 0,
                dockerVersion: '—'
              } satisfies PortainerHostMetrics;
            }),
            catchError(() => of(this.mapMetrics(endpoint, undefined)))
          );
        }),
        catchError((err) => {
          const msg =
            err instanceof TimeoutError
              ? 'Portainer timed out (host unreachable)'
              : err?.error?.message ?? err?.message ?? 'Failed to reach Portainer';
          return of(this.emptyMetrics(msg));
        })
      );
  }

  private mapMetrics(endpoint: PortainerEndpoint, snap?: PortainerSnapshot): PortainerHostMetrics {
    const memoryGb = snap ? +(snap.TotalMemory / 1024 ** 3).toFixed(1) : 0;

    return {
      connected: endpoint.Status === 1,
      endpointId: endpoint.Id,
      endpointName: endpoint.Name,
      runningContainers: snap?.RunningContainerCount ?? 0,
      totalContainers: snap?.ContainerCount ?? 0,
      healthyContainers: snap?.HealthyContainerCount ?? 0,
      unhealthyContainers: snap?.UnhealthyContainerCount ?? 0,
      stacks: snap?.StackCount ?? 0,
      images: snap?.ImageCount ?? 0,
      volumes: snap?.VolumeCount ?? 0,
      totalCpu: snap?.TotalCPU ?? 0,
      totalMemoryGb: memoryGb,
      dockerVersion: snap?.DockerVersion ?? '—'
    };
  }
}
