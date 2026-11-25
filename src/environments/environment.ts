/** Purpose: development settings (used by `npm start` and tests). The production build swaps in environment.prod.ts. */
export const environment = {
  production: false,
  /** Empty = same address as the web app (`ng serve` forwards /api through proxy.conf.json). */
  apiBaseUrl: '',
  /** Keep false for the real login. true = "Sign in" skips authentication (the API then needs AUTH_DISABLED=1). */
  authDisabled: false,
};
