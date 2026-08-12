import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { UserAccount } from './models';

function loginTree(router: Router, returnUrl?: string): UrlTree {
  const queryParams: Record<string, string> = { mode: 'login' };
  if (returnUrl && isSafeReturnUrl(returnUrl)) {
    queryParams['returnUrl'] = returnUrl;
  }
  return router.createUrlTree(['/auth'], { queryParams });
}

/** Only same-app relative paths — blocks open redirects. */
export function isSafeReturnUrl(url: string): boolean {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return false;
  if (url.includes('://')) return false;
  if (url.startsWith('/auth')) return false;
  return true;
}

function denySuspended(auth: AuthService, router: Router): UrlTree {
  auth.logout();
  return router.createUrlTree(['/auth'], {
    queryParams: { mode: 'login', reason: 'suspended' }
  });
}

function afterSession(
  user: UserAccount | null,
  auth: AuthService,
  router: Router,
  returnUrl: string | undefined,
  requireAdmin: boolean
): boolean | UrlTree {
  if (!user || !auth.hasValidToken()) {
    return loginTree(router, returnUrl);
  }
  if (user.accountStatus === 'SUSPENDED') {
    return denySuspended(auth, router);
  }
  if (user.accountStatus === 'PENDING_ACTIVATION' || user.emailVerified === false) {
    return router.createUrlTree(['/auth'], {
      queryParams: { mode: 'verify', email: user.email || undefined }
    });
  }
  if (requireAdmin) {
    if (user.role !== 'ADMIN') {
      return router.createUrlTree(['/dashboard']);
    }
    return true;
  }
  // Non-admins stay out of admin; admins may use app pages
  return true;
}

function guardPipeline(
  requireAdmin: boolean,
  returnUrl?: string,
  forceRefresh = false
): Observable<boolean | UrlTree> {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.hasValidToken()) {
    auth.logout();
    return of(loginTree(router, returnUrl));
  }

  return auth.ensureSession({ forceRefresh, requireAdmin }).pipe(
    map(user => afterSession(user, auth, router, returnUrl, requireAdmin)),
    catchError(() => {
      auth.logout();
      return of(loginTree(router, returnUrl));
    })
  );
}

/** Logged-in users with a live session (token verified with API when online). */
export const authenticatedGuard: CanActivateFn = (_route, state) =>
  guardPipeline(false, state.url, false);

export const authenticatedMatch: CanMatchFn = (_route, segments) =>
  guardPipeline(false, '/' + segments.map(s => s.path).join('/'), false);

/** Admin only — always re-validates /me so localStorage role spoofing fails. */
export const adminGuard: CanActivateFn = (_route, state) =>
  guardPipeline(true, state.url, true);

export const adminMatch: CanMatchFn = (_route, segments) =>
  guardPipeline(true, '/' + segments.map(s => s.path).join('/'), true);

/** Developers only — admins manage via Admin panel, not Deploy/Dashboard */
export const developerGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ensureSession({ forceRefresh: false }).pipe(
    map(user => {
      const gate = afterSession(user, auth, router, state.url, false);
      if (gate !== true) return gate;
      if (auth.isAdmin()) {
        return router.createUrlTree(['/admin']);
      }
      if (!user || !auth.hasDeployAccess()) {
        return router.createUrlTree(['/dashboard']);
      }
      return true;
    }),
    catchError(() => of(loginTree(router, state.url)))
  );
};

/** Send already-authenticated users away from public auth/landing when appropriate. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.hasValidToken() || !auth.user()) {
    return true;
  }

  // Soft check — if token looks valid, bounce away from guest pages
  return auth.ensureSession({ forceRefresh: false }).pipe(
    map(user => {
      if (!user) return true;
      if (user.accountStatus === 'SUSPENDED') {
        auth.logout();
        return true;
      }
      if (user.accountStatus === 'PENDING_ACTIVATION' || user.emailVerified === false) {
        return router.createUrlTree(['/auth'], {
          queryParams: { mode: 'verify', email: user.email || undefined }
        });
      }
      return user.role === 'ADMIN'
        ? router.createUrlTree(['/admin'])
        : router.createUrlTree(['/dashboard']);
    }),
    catchError(() => {
      auth.logout();
      return of(true);
    })
  );
};
