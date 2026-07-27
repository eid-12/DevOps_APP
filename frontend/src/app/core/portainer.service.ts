import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, catchError, of } from 'rxjs';
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

interface PortainerEndpoint {
  Id: number;
  Name: string;
  Status: number;
  Snapshots?: Array<{
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
  }>;
}

@Injectable({ providedIn: 'root' })
export class PortainerService {
  private readonly http = inject(HttpClient);

  private headers(): HttpHeaders {
    return new HttpHeaders({
      'X-API-Key': environment.portainerToken
    });
  }

  getHostMetrics(): Observable<PortainerHostMetrics> {
    return this.http
      .get<PortainerEndpoint[]>(`${environment.portainerBaseUrl}/api/endpoints`, {
        headers: this.headers()
      })
      .pipe(
        map((endpoints) => {
          const endpoint =
            endpoints.find((item) => item.Id === environment.portainerEndpointId) ??
            endpoints[0];

          if (!endpoint) {
            throw new Error('No Portainer endpoint found');
          }

          const snap = endpoint.Snapshots?.[0];
          const memoryGb = snap ? +(snap.TotalMemory / (1024 ** 3)).toFixed(1) : 0;

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
          } satisfies PortainerHostMetrics;
        }),
        catchError((err) =>
          of({
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
            error: err?.message ?? 'Failed to reach Portainer'
          } satisfies PortainerHostMetrics)
        )
      );
  }
}
