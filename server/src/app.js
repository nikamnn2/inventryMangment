/** Purpose: assembles the Express application (security headers, CORS, JSON parsing, routes and error handling). */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createMailer } from './services/mail.service.js';
import { seed } from './database/seeds/seed.js';
import { errorHandler, notFound } from './middleware/error.middleware.js';
import authRoutes from './routes/auth.routes.js';
import { protectedRoutes } from './routes/index.js';
import { serveWeb } from './web.js';

/**
 * Builds the Express app. `ctx` carries the shared Mongo handle ({ db, poolStats }) and config,
 * so tests can inject an in-memory database.
 */
export function createApp(ctx) {
  const { db, config } = ctx;
  ctx.mailer ??= createMailer(config);
  const app = express();

  /** Hide the framework name and add standard security headers. */
  app.disable('x-powered-by');
  /** Behind a hosting proxy this makes req.ip the visitor's address (used by the sign-in limits). */
  app.set('trust proxy', config.trustProxy ?? 0);
  app.use(helmet());
  /** Only the front-end origin(s) listed in CORS_ORIGIN may call the API from a browser. */
  app.use(cors({ origin: config.corsOrigin.split(','), exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '100kb' }));

  /** Nothing the API answers belongs in a search engine. */
  app.use('/api', (_req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  /** Health check for dev tools / monitoring: pings MongoDB and reports connection-pool usage. */
  app.get('/api/health', async (_req, res) => {
    await db.command({ ping: 1 });
    if (config.isProduction) return res.json({ status: 'ok' }); // internal details stay private
    res.json({ status: 'ok', db: config.dbName, pool: ctx.poolStats?.() ?? null, uptime: process.uptime() });
  });

  /** Public auth routes (login, activation); everything below needs a signed-in user. */
  app.use('/api/auth', authRoutes(ctx));

  /** Only for end-to-end tests: lets Playwright reset the database to the demo data. */
  if (config.enableTestRoutes) {
    app.post('/api/test/reset', async (_req, res) => {
      await seed(db, { reset: true, ...config });
      res.json({ ok: true });
    });
  }

  /** All business routes (products, bundles, sales...). They sit behind the auth middleware. */
  app.use('/api', protectedRoutes(ctx));
  /** Unknown /api URLs return a JSON 404; the last middleware turns any error into a JSON response. */
  app.use('/api', notFound);
  /** Production only (config.webDir): the website itself, when it has been built. */
  serveWeb(app, config.webDir);
  app.use(errorHandler);

  return app;
}
