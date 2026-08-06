import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import { finalize } from 'rxjs/operators';

let pending = 0;

function shouldSkipSpinner(url: string, headers: { has(name: string): boolean }): boolean {
  if (headers.has('X-Skip-Spinner')) return true;
  // Portainer / background probes must never block the UI
  if (url.includes('/portainer-api')) return true;
  return false;
}

/** Shows ngx-spinner while waiting for CloudBase API responses. */
export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  const spinner = inject(NgxSpinnerService);

  if (shouldSkipSpinner(req.url, req.headers)) {
    return next(req);
  }

  pending += 1;
  if (pending === 1) {
    spinner.show('api');
  }

  return next(req).pipe(
    finalize(() => {
      pending = Math.max(0, pending - 1);
      if (pending === 0) {
        spinner.hide('api');
      }
    })
  );
};
