/** Purpose: switch that can turn the login screen off for demos (must match AUTH_DISABLED in the API's env file). */
import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

/** Set per environment in src/environments/. It is false in production builds. */
export const AUTH_DISABLED = new InjectionToken<boolean>('AUTH_DISABLED', { factory: () => environment.authDisabled });
