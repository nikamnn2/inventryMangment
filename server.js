/**
 * Purpose: entry file for hosts that deploy from the repository root (Hostinger's default is `server.js`).
 * It only starts the API in server/. Local development does not use it (`npm run api`).
 */
const { existsSync } = require('node:fs');
const { join } = require('node:path');

// A deployed API must never fall back to development mode (login off, demo data).
process.env.NODE_ENV = 'production';

// Some hosts write the panel's variables to a .env file here. Variables already set are not overwritten.
const envFile = join(__dirname, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

import('./server/src/server.js').catch(err => {
  console.error(err);
  process.exit(1);
});
