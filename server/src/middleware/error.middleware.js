/** Purpose: turns thrown errors into consistent JSON responses and hides internal details from clients. */
import { HttpError } from '../utils/index.js';

/** Handles any /api URL that no route matched (404). */
export const notFound = (_req, _res, next) => next(new HttpError(404, 'Not found.'));

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON body.');
  if (err?.code === 11000) err = new HttpError(409, 'A record with the same unique value already exists.');
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error.' : err.message });
};
