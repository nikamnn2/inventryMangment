import { COLLECTIONS as C } from '../database/collections.js';

/** Purpose: the first bundle code handed out on a database that has no numbered bundle yet. */
export const FIRST_BUNDLE_NO = 1001;

/**
 * Purpose: the next numeric bundle code (1001, 1002, ...), also the value encoded in its barcode / QR code.
 * The counter is advanced in one atomic update, so two users saving at once never get the same number.
 * It is returned as a string, the type bundle IDs are stored as.
 */
export async function nextBundleId(db) {
  const counter = await db.collection(C.counters).findOneAndUpdate(
    { _id: 'bundle' },
    [{ $set: { seq: { $add: [{ $ifNull: ['$seq', FIRST_BUNDLE_NO - 1] }, 1] } } }],
    { upsert: true, returnDocument: 'after' },
  );
  return String(counter.seq);
}
