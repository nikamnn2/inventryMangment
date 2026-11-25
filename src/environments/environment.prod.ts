/** Purpose: production settings. Replaces environment.ts in production builds (fileReplacements in angular.json). */
export const environment = {
  production: true,
  /**
   * Address of the API without a trailing slash or /api, e.g. https://api.example.com.
   * The deploy workflow fills it in from the API_URL repository variable; empty = same address as the web app.
   */
  apiBaseUrl: '',
  /** Real login is always required in production. */
  authDisabled: false,
};
