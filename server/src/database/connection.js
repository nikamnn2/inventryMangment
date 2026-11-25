/** Purpose: creates the MongoDB connection with a tuned connection pool and exposes pool statistics for /api/health. */
import { MongoClient } from 'mongodb';
import { ensureIndexes } from './indexes.js';

/**
 * One MongoClient per process. The driver keeps a pool of sockets inside it and hands them out
 * per operation, so every request shares the same pool — never create a client per request.
 */
export async function connect({ uri, dbName, maxPoolSize, minPoolSize }) {
  const client = new MongoClient(uri, {
    maxPoolSize, // upper bound of simultaneous connections
    minPoolSize, // kept warm so the first requests are fast
    maxIdleTimeMS: 60_000, // close surplus idle connections
    waitQueueTimeoutMS: 10_000, // fail instead of queueing forever when the pool is exhausted
    serverSelectionTimeoutMS: 5_000,
    retryWrites: true,
  });

  /** Counters fed by driver events so we can report how many connections are open / in use. */
  const pool = { created: 0, closed: 0, checkedOut: 0 };
  client.on('connectionCreated', () => pool.created++);
  client.on('connectionClosed', () => pool.closed++);
  client.on('connectionCheckedOut', () => pool.checkedOut++);
  client.on('connectionCheckedIn', () => pool.checkedOut--);

  await client.connect();
  const db = client.db(dbName);
  /** Make sure unique/search indexes exist before serving traffic. */
  await ensureIndexes(db);

  return {
    client,
    db,
    poolStats: () => ({ maxPoolSize, minPoolSize, open: pool.created - pool.closed, inUse: pool.checkedOut }),
    close: () => client.close(),
  };
}

