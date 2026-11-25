/** Purpose: process entry point. Connects to MongoDB, seeds demo data on first run, starts the HTTP API and shuts down cleanly on Ctrl+C / SIGTERM. */
import { config, assertSafeConfig } from './config/index.js';
import { connect } from './database/connection.js';
import { createApp } from './app.js';
import { seed } from './database/seeds/seed.js';
import { createMailer } from './services/mail.service.js';

assertSafeConfig();

/** Open the shared MongoDB connection pool (one per process). */
const conn = await connect({
  uri: config.mongoUri,
  dbName: config.dbName,
  maxPoolSize: config.maxPoolSize,
  minPoolSize: config.minPoolSize,
});
await seed(conn.db, config); // idempotent: adds the admin, settings and (development only) demo data when missing

/** Build the Express app and start listening on the configured port. */
const mailer = createMailer(config);
const app = createApp({ db: conn.db, poolStats: conn.poolStats, config, mailer });
/** Report mail problems at startup, without delaying it, so they are not first noticed during a registration. */
mailer.verify().then(error => (error ? console.warn(`[mail] NOT READY: ${error}`) : console.log('[mail] ready')));
const server = app.listen(config.port, () =>
  console.log(`Invenza API [${config.env}] on :${config.port} · db "${config.dbName}" · pool ${config.minPoolSize}-${config.maxPoolSize}`));

/** Graceful shutdown: stop accepting requests, close the database pool, then exit. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await conn.close();
      process.exit(0);
    });
  });
}
