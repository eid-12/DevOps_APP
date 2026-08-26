import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, firstValueFrom, of } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PublicAppConfig {
  githubClientId: string;
  githubRedirectUri: string;
  githubScopes: string;
  githubConfigured: boolean;
  emailEnabled: boolean;
}

/**
 * Runtime flags from GET /api/public/app-config so the SPA matches Admin → Hosting
 * (GitHub client ID / redirect) without a frontend rebuild.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiBaseUrl || '/api';
  readonly config = signal<PublicAppConfig | null>(null);

  async load(): Promise<void> {
    const cfg = await firstValueFrom(
      this.http
        .get<PublicAppConfig>(`${this.apiBase}/public/app-config`, {
          headers: { 'X-Skip-Spinner': '1' }
        })
        .pipe(catchError(() => of(null)))
    );
    this.config.set(cfg);
  }

  githubClientId(): string {
    const live = this.config()?.githubClientId?.trim();
    if (live) return live;
    return (environment as { githubClientId?: string }).githubClientId?.trim() ?? '';
  }

  githubRedirectUri(): string {
    const live = this.config()?.githubRedirectUri?.trim();
    if (live) return live;
    return (
      (environment as { githubRedirectUri?: string }).githubRedirectUri?.trim() ||
      `${window.location.origin}/auth/github/callback`
    );
  }

  githubScopes(): string {
    const live = this.config()?.githubScopes?.trim();
    if (live) return live;
    return (environment as { githubScopes?: string }).githubScopes?.trim() || 'read:user repo user:email workflow';
  }

  githubConfigured(): boolean {
    if (this.config()) {
      return !!this.config()?.githubConfigured && this.githubClientId().length > 0;
    }
    return this.githubClientId().length > 0;
  }

  emailEnabled(): boolean {
    return !!this.config()?.emailEnabled;
  }
}
