import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1, // tests share one database and reset it before each test
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4300', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // API on a throw-away in-memory MongoDB, with the test-only reset route enabled
      command: 'npm run dev:memory',
      cwd: 'server',
      url: 'http://localhost:3000/api/health',
      // set here so the tests never use the admin account or mail server from server/.env
      env: { PORT: '3000', ENABLE_TEST_ROUTES: '1', ADMIN_EMAIL: 'admin@invenza.com', ADMIN_PASSWORD: 'aluminium', AUTH_DISABLED: '0', SMTP_HOST: '' },
      reuseExistingServer: true,
      timeout: 180_000,
    },
    { command: 'npm start -- --port 4300', url: 'http://localhost:4300', reuseExistingServer: false, timeout: 180_000 },
  ],
});
