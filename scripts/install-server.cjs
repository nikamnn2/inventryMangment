/**
 * Purpose: runs after the root `npm install`. It installs the API's packages and, on a deployment
 * (a production-only install), builds the website that the API serves.
 */
const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const server = join(root, 'server');
const run = (command, cwd) => execSync(command, { cwd, stdio: 'inherit' });

// A developer or CI install that already has the API's test packages is left alone (--omit=dev would remove them).
if (!existsSync(join(server, 'node_modules', 'supertest'))) {
  run('npm install --omit=dev --no-audit --no-fund', server);
}

// @playwright/test is development-only (nothing the build needs pulls it in), so its absence means a deployment.
if (!existsSync(join(root, 'node_modules', '@playwright', 'test'))) {
  run('npm run build:prod', root);
}
