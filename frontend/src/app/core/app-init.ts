import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';

/**
 * Boots authenticated session from stored JWT before first navigation paints protected data.
 * Invalid / expired tokens are cleared so URL deep-links cannot open private pages.
 */
export function initializeAuthSession(): () => Promise<void> {
  const auth = inject(AuthService);
  return async () => {
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
