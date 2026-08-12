import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

/** Attaches JWT from AuthService to CloudBase API requests (not Portainer). */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const isPortainer = req.url.includes('/portainer-api');
  const isAppApi = req.url.includes('/api/') && !isPortainer;
  if (token && auth.hasValidToken() && isAppApi) {
    return next(req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    }));
  }
  return next(req);
};
