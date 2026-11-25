/** Purpose: production settings. Replaces environment.ts in production builds (fileReplacements in angular.json). */
export const environment = {
  production: true,
  /** Real login is always required in production. */
  authDisabled: false,
};
