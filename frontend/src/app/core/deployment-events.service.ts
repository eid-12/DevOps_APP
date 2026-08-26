import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { AuthService } from './auth.service';

export interface DeploymentEvent {
  deploymentId: string;
  serviceId: string;
  projectId: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface LogEvent {
  deploymentId: string;
  line: string;
  ts: number;
}

/**
 * Connects to backend WebSocket (STOMP over SockJS).
 * Lazy-initializes the connection on first subscription.
 *
 * Usage:
 *   this.deploymentEvents.deploymentUpdates(serviceId).subscribe(...)
 *   this.deploymentEvents.logs(serviceId).subscribe(...)
 */
@Injectable({ providedIn: 'root' })
export class DeploymentEventsService {
  private readonly auth = inject(AuthService);
  private stompClient: unknown = null;
  private connected = false;

  /** Subscribe to deployment status events for a specific service */
  deploymentUpdates(serviceId: string): Observable<DeploymentEvent> {
    return this.subscribe<DeploymentEvent>(`/topic/deployments/${serviceId}`);
  }

  /** Subscribe to live log events for a specific service */
  logs(serviceId: string): Observable<LogEvent> {
    return this.subscribe<LogEvent>(`/topic/logs/${serviceId}`);
  }

  private subscribe<T>(destination: string): Observable<T> {
    const subject = new Subject<T>();

    this.connectAndSubscribe(destination, (frame: unknown) => {
      try {
        subject.next(JSON.parse((frame as { body: string }).body) as T);
      } catch {}
    });

    return subject.asObservable();
  }

  private connectAndSubscribe(destination: string, callback: (frame: unknown) => void) {
    // SockJS + STOMP loaded dynamically to avoid SSR issues
    const init = () => {
      const SockJS = (window as unknown as Record<string, unknown>)['SockJS'] as new (url: string) => unknown;
      const Stomp = (window as unknown as Record<string, unknown>)['Stomp'] as {
        over: (socket: unknown) => {
          connect: (
            h: Record<string, string>,
            cb: () => void,
            err?: () => void
          ) => void;
          subscribe: (d: string, cb: (f: unknown) => void) => void;
        };
      };
      if (!SockJS || !Stomp) {
        setTimeout(init, 500);
        return;
      }

      if (!this.stompClient) {
        const socket = new SockJS('/ws');
        const client = Stomp.over(socket);
        this.stompClient = client;
        const token = this.auth.token();
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        client.connect(headers, () => {
          this.connected = true;
          client.subscribe(destination, callback);
        }, () => {
          this.connected = false;
          this.stompClient = null;
        });
      } else if (this.connected) {
        (this.stompClient as { subscribe: (d: string, cb: (f: unknown) => void) => void }).subscribe(destination, callback);
      }
    };

    init();
  }
}
