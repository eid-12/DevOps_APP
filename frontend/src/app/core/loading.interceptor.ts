import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import { finalize } from 'rxjs/operators';

let pending = 0;
let showTimer: ReturnType<typeof setTimeout> | null = null;

/** Background / poll URLs — never block the whole UI. */
const SKIP_SPINNER_PARTS = [
  '/portainer-api',
  '/metrics',
  '/logs',
  '/notifications',
  '/notifications/unread-count',
  '/auth/me',
  '/domain/check',
  '/vanity',
  '/check-domain',
  '/check-vanity',
  '/deployments',
  '/usage',
  '/actuator'
];

function shouldSkipSpinner(url: string, headers: { has(name: string): boolean }): boolean {
  if (headers.has('X-Skip-Spinner')) return true;
  return SKIP_SPINNER_PARTS.some(p => url.includes(p));
}

/**
 * Shows a spinner only for slow, user-facing API calls.
 * Fast responses (<250ms) and background polls never flash the overlay.
 */
export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  const spinner = inject(NgxSpinnerService);

  if (shouldSkipSpinner(req.url, req.headers)) {
    return next(req);
  }

  pending += 1;
  if (pending === 1 && !showTimer) {
    // Delay so snappy requests don't freeze the screen
    showTimer = setTimeout(() => {
      showTimer = null;
      if (pending > 0) {
        spinner.show('api');
      }
    }, 250);
  }

  return next(req).pipe(
    finalize(() => {
      pending = Math.max(0, pending - 1);
      if (pending === 0) {
        if (showTimer) {
          clearTimeout(showTimer);
          showTimer = null;
        }
        spinner.hide('api');
      }
    })
  );
};
