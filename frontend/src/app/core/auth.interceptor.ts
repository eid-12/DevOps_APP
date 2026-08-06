import { HttpInterceptorFn } from '@angular/common/http';

/** Attaches JWT from localStorage to CloudBase API requests (not Portainer). */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('cloudbase.token');
  const isPortainer = req.url.includes('/portainer-api');
  const isAppApi = req.url.includes('/api/') && !isPortainer;
  if (token && isAppApi) {
    return next(req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    }));
  }
  return next(req);
};
