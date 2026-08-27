import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { friendlyApiMessage } from './friendly-error';

const SILENT_URL_PARTS = [
  '/notifications/unread-count',
  '/notifications',
  '/auth/me',
  '/logs',
  '/metrics',
  '/domain/check',
  '/vanity',
  '/check-domain',
  '/check-vanity',
  '/exec',
  '/terminal',
  '/public/app-config',
  '/public/platform-status'
];

function shouldSilence(url: string): boolean {
  return SILENT_URL_PARTS.some(p => url.includes(p));
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

      const isAppApi = req.url.includes('/api/');
      if (isAppApi && err.status === 401 && !req.url.includes('/auth/login') && !req.url.includes('/auth/register')) {
        auth.logout();
        const returnUrl = router.url && !router.url.startsWith('/auth') ? router.url : undefined;
        router.navigate(['/auth'], {
          queryParams: returnUrl ? { mode: 'login', returnUrl } : { mode: 'login' }
        });
      }

      // Quiet expected misses (404) and background probes — pages show their own hints
      if (!shouldSilence(req.url) && err.status !== 401 && err.status !== 404) {
        messages.add({
          severity: err.status >= 500 ? 'error' : 'warn',
          summary: err.status >= 500 ? 'Server' : 'Notice',
          detail: friendlyApiMessage(err),
          life: 3500
        });
      }

      return throwError(() => err);
    })
  );
};
