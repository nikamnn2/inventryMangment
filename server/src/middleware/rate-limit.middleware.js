/** Purpose: slows down guessing of passwords and activation links by limiting failed attempts. */
import { HttpError } from '../utils/index.js';

const WINDOW_MS = 15 * 60_000;
const MAX_KEYS = 10_000;

/**
 * Allows `max` failed requests per `key(req)` in 15 minutes, then answers 429. A request is counted when it
 * arrives (so a burst of parallel guesses cannot slip through) and uncounted again if it succeeds.
 * Counts are kept in memory: they restart with the API and are per API process.
 */
export function limitFailures({ max, key, windowMs = WINDOW_MS, now = Date.now }) {
  const hits = new Map();

  /** Keeps memory bounded when someone sends endless different keys. */
  function prune(time) {
    for (const [k, entry] of hits) if (entry.resets <= time) hits.delete(k);
    for (const k of hits.keys()) {
      if (hits.size < MAX_KEYS) break;
      hits.delete(k); // oldest first
    }
  }

  return (req, res, next) => {
    const time = now();
    const id = key(req);
    let entry = hits.get(id);
    if (!entry || entry.resets <= time) {
      if (hits.size >= MAX_KEYS) prune(time);
      entry = { count: 0, resets: time + windowMs };
      hits.set(id, entry);
    }
    if (entry.count >= max) {
      const seconds = Math.ceil((entry.resets - time) / 1000);
      res.set('Retry-After', String(seconds));
      return next(new HttpError(429, `Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} minutes.`));
    }
    entry.count++;
    res.on('finish', () => {
      // 429 from a later limit is not a new guess either
      if (res.statusCode < 400 || res.statusCode === 429) entry.count = Math.max(0, entry.count - 1);
    });
    next();
  };
}
