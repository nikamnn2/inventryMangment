/** Purpose: HTTP interceptor and route guards that enforce login, role permissions and mobile-only pages. */
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { isMobileDevice } from '../config/device';
import { environment } from '../../../environments/environment';

/** Sends API calls to the configured API address, adds the JWT and signs the user out when the server says it expired. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const isLogin = req.url.endsWith('/auth/login');
  const outgoing = req.url.startsWith('/api')
    ? req.clone({ url: `${environment.apiBaseUrl}${req.url}`, setHeaders: token ? { Authorization: `Bearer ${token}` } : {} })
    : req;
  return next(outgoing).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !isLogin) auth.logout();
      return throwError(() => err);
    }),
  );
};

/** Blocks a tab the user's role cannot open and sends them to the dashboard. */
export const moduleGuard = (module: string): CanActivateFn => () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  return inject(AuthService).can(module) ? true : inject(Router).createUrlTree(['/dashboard']);
};

/** Purpose: only signed-in users may open the app pages; others are sent to the login page. */
export const authGuard: CanActivateFn = () => {
  // prerendering has no session; the browser re-checks on load
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  return inject(AuthService).loggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

/**
 * Purpose: keep mobile-only pages (camera scanning) off desktop browsers.
 * Routes that only make sense on a phone or tablet (e.g. camera scanning) redirect desktops to the dashboard. */
export const mobileOnlyGuard: CanActivateFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;
  return isMobileDevice() ? true : inject(Router).createUrlTree(['/dashboard']);
};
