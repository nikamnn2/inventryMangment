/** Purpose: reads every setting from environment variables (server/.env*) in one place, with safe development defaults. */
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** `--prod` (used by the *:prod npm scripts) or NODE_ENV=production selects production; anything else is development. */
const isProduction = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
if (isProduction) process.env.NODE_ENV = 'production';

/**
 * Earlier files win, and real environment variables beat both. Production never reads the plain
 * .env file, so development values cannot leak into it.
 */
const envFiles = isProduction ? ['.env.production'] : ['.env.development', '.env'];
dotenv.config({ path: envFiles.map(f => fileURLToPath(new URL(`../../${f}`, import.meta.url))) });

/** Parse an integer env var, falling back to a default when it is missing or not a number. */
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

/** App settings: port, MongoDB connection + pool size, JWT, CORS, admin account, e-mail (SMTP), demo users and the temporary auth switch. */
export const config = {
  env: isProduction ? 'production' : 'development',
  isProduction,
  // built Angular app, served by the API in production (empty = API only; development uses `ng serve`)
  webDir: isProduction ? fileURLToPath(new URL('../../../dist/inventry-mangment/browser', import.meta.url)) : '',
  // demo products, bundles, parties and sales are loaded in development only
  seedDemoData: !isProduction,
  port: int(process.env.PORT, 3000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017',
  dbName: process.env.MONGODB_DB ?? 'invenza',
  maxPoolSize: int(process.env.MONGO_MAX_POOL_SIZE, 20),
  minPoolSize: int(process.env.MONGO_MIN_POOL_SIZE, 2),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:4200',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@invenza.com',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'aluminium',
  // activation emails: leave SMTP_HOST empty to print the link in the server log instead
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: int(process.env.SMTP_PORT, 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'Invenza <no-reply@invenza.local>',
  appUrl: (process.env.APP_URL ?? 'http://localhost:4200').replace(/\/+$/, ''),
  activationHours: int(process.env.ACTIVATION_HOURS, 48),
  // manager / accountant demo users (password below); turn off in production
  seedDemoUsers: process.env.SEED_DEMO_USERS === '1',
  demoPassword: process.env.DEMO_USERS_PASSWORD ?? 'ChangeMe123',
  // TEMPORARY: when true every request is treated as the admin user (no token needed)
  authDisabled: process.env.AUTH_DISABLED === '1',
  enableTestRoutes: process.env.ENABLE_TEST_ROUTES === '1',
};

/** Lists the settings that make a production start unsafe. Always empty in development. */
export function productionProblems(c, env = process.env) {
  if (!c.isProduction) return [];
  const problems = ['MONGODB_URI', 'JWT_SECRET', 'CORS_ORIGIN', 'APP_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'SMTP_HOST']
    .filter(name => !env[name])
    .map(name => `${name} is not set.`);
  if (env.JWT_SECRET && (env.JWT_SECRET.length < 32 || env.JWT_SECRET === 'change-me-in-production')) {
    problems.push('JWT_SECRET must be a random value of at least 32 characters.');
  }
  if (env.ADMIN_PASSWORD && (env.ADMIN_PASSWORD.length < 12 || env.ADMIN_PASSWORD === 'aluminium')) {
    problems.push('ADMIN_PASSWORD must have at least 12 characters.');
  }
  if (c.authDisabled) problems.push('AUTH_DISABLED must be 0.');
  if (c.enableTestRoutes) problems.push('ENABLE_TEST_ROUTES must be 0.');
  if (c.seedDemoUsers) problems.push('SEED_DEMO_USERS must be 0.');
  return problems;
}

/** Stops the process with a readable message when production is misconfigured. */
export function assertSafeConfig(c = config) {
  const problems = productionProblems(c);
  if (problems.length) {
    console.error(`Refusing to run in production:\n- ${problems.join('\n- ')}\nSee server/.env.production.example.`);
    process.exit(1);
  }
}
