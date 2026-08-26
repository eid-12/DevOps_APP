import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { AppConfigService } from './app-config.service';
import { firstValueFrom } from 'rxjs';

/**
 * Boots public app config + authenticated session before first navigation.
 */
export function initializeAuthSession(): () => Promise<void> {
  const auth = inject(AuthService);
  const appConfig = inject(AppConfigService);
  return async () => {
    await appConfig.load();
    if (!auth.hasValidToken()) {
      if (localStorage.getItem('cloudbase.token')) {
        auth.logout();
      }
      return;
    }
    try {
      await firstValueFrom(auth.ensureSession({ forceRefresh: true }));
    } catch {
      auth.logout();
    }
  };
}
