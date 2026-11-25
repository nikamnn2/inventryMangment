/** Purpose: runs the API on a throw-away in-memory MongoDB for demos / e2e tests when no database is available. */
// Runs the API against a throw-away in-memory MongoDB. Handy for demos and e2e tests when
// no MongoDB is installed. Data is lost when the process exits.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { config } from '../src/config/index.js';
import { connect } from '../src/database/connection.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/database/seeds/seed.js';

const mongod = await MongoMemoryServer.create();
const cfg = { ...config, enableTestRoutes: process.env.ENABLE_TEST_ROUTES === '1' };
const conn = await connect({ uri: mongod.getUri(), dbName: cfg.dbName, maxPoolSize: cfg.maxPoolSize, minPoolSize: cfg.minPoolSize });
await seed(conn.db, cfg);

const app = createApp({ db: conn.db, poolStats: conn.poolStats, config: cfg });
const server = app.listen(cfg.port, () => console.log(`Invenza API (in-memory MongoDB) on :${cfg.port}`));

const stop = async () => {
  server.close();
  await conn.close();
  await mongod.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
