/** Purpose: runs after the root `npm install` so a root-level deployment also gets the API's packages. */
const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const server = join(__dirname, '..', 'server');

// A developer or CI install that already has the API's test packages is left alone (--omit=dev would remove them).
if (!existsSync(join(server, 'node_modules', 'supertest'))) {
  execSync('npm install --omit=dev --no-audit --no-fund', { cwd: server, stdio: 'inherit' });
}
