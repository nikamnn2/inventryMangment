/** Purpose: defines MongoDB indexes. Unique indexes stop duplicate emails, die numbers, bundle IDs and bill numbers; the others speed up lookups and the sales history. */
import { COLLECTIONS as C } from './collections.js';

/** Creates the indexes if they do not exist yet (safe to run on every start). */
export async function ensureIndexes(db) {
  await Promise.all([
    db.collection(C.users).createIndex({ email: 1 }, { unique: true }),
    db.collection(C.products).createIndex({ dieNo: 1 }, { unique: true }),
    db.collection(C.bundles).createIndex({ bundleId: 1 }, { unique: true }),
    db.collection(C.bundles).createIndex({ dieNo: 1 }),
    db.collection(C.sales).createIndex({ billNo: 1 }, { unique: true }),
    db.collection(C.sales).createIndex({ createdAt: -1 }),
  ]);
}
