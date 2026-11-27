// Used by `ng test` (see angular.json). The tests run in a real browser: the installed Google Chrome,
// headless, so nothing extra has to be downloaded.
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Rebuild the dependency cache on each run: reusing it left the browser waiting forever after the build.
  optimizeDeps: { force: true },
  test: {
    // a spy made in one test must not carry into the next (what Jasmine did on its own)
    restoreMocks: true,
    unstubGlobals: true,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: 'chrome' } }),
      instances: [{ browser: 'chromium' }],
      screenshotFailures: false,
    },
  },
});
