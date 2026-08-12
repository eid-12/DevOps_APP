import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const SILENT_URL_PARTS = [
  '/notifications/unread-count',
  '/notifications',
  '/auth/me',
  '/portainer-api'
];

function shouldSilence(url: string): boolean {
  return SILENT_URL_PARTS.some(p => url.includes(p));
}

function messageFrom(err: HttpErrorResponse): string {
  const body = err.error;
  if (typeof body === 'string' && body.trim()) return body.slice(0, 240);
  if (body && typeof body === 'object') {
    const msg = (body as { message?: string; error?: string }).message
      ?? (body as { error?: string }).error;
    if (msg) return String(msg).slice(0, 240);
  }
  if (err.status === 0) return 'Cannot reach the API. Is the backend running?';
  if (err.status === 401) return 'Session expired. Please sign in again.';
  if (err.status === 403) return 'You do not have permission for this action.';
  if (err.status === 404) return 'Resource not found.';
  if (err.status >= 500) return 'Server error. Try again in a moment.';
  return err.message || `Request failed (${err.status})`;
}

/** Maps API failures to PrimeNG toasts; logs out on 401 for app API calls. */
export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const messages = inject(MessageService);
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse)) {
        return throwError(() => err);
      }

      const isAppApi = req.url.includes('/api/') && !req.url.includes('/portainer-api');
      if (isAppApi && err.status === 401 && !req.url.includes('/auth/login') && !req.url.includes('/auth/register')) {
        auth.logout();
        const returnUrl = router.url && !router.url.startsWith('/auth') ? router.url : undefined;
        router.navigate(['/auth'], {
          queryParams: returnUrl ? { mode: 'login', returnUrl } : { mode: 'login' }
        });
      }

      if (!shouldSilence(req.url) && err.status !== 401) {
        messages.add({
          severity: err.status >= 500 ? 'error' : 'warn',
          summary: err.status ? `HTTP ${err.status}` : 'Network',
          detail: messageFrom(err),
          life: 5000
        });
      }

      return throwError(() => err);
    })
  );
};
