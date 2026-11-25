/** Purpose: command line seeding of the real database (`npm run seed`; add --reset to wipe the inventory data first). */
import { config, assertSafeConfig } from '../src/config/index.js';
import { connect } from '../src/database/connection.js';
import { seed } from '../src/database/seeds/seed.js';

assertSafeConfig();
if (config.isProduction && process.argv.includes('--reset')) {
  console.error('--reset deletes all inventory data and is not allowed in production.');
  process.exit(1);
}

const conn = await connect({ uri: config.mongoUri, dbName: config.dbName, maxPoolSize: 2, minPoolSize: 0 });
await seed(conn.db, { reset: process.argv.includes('--reset'), ...config });
console.log('Seed complete.');
await conn.close();
