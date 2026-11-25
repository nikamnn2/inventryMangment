/** Purpose: development settings (used by `npm start` and tests). The production build swaps in environment.prod.ts. */
export const environment = {
  production: false,
  /** TEMPORARY: true = "Sign in" skips authentication (match AUTH_DISABLED in the API's env file). */
  authDisabled: true,
};
