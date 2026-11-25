/** Purpose: date helpers shared by reports, dashboard and seed data. */
import { HttpError } from './http-error.js';

/** Milliseconds in one day. */
export const DAY = 86_400_000;

/** Formats a date as local YYYY-MM-DD (used for "packed" dates and filters). */
export const isoDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Midnight (local time) of the given day. */
export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Date range used by dashboard and reports. */
export function rangeStart(range, now = new Date()) {
  const today = startOfDay(now).getTime();
  switch (range) {
    case 'Today': return new Date(today);
    case 'Week': return new Date(today - 6 * DAY);
    case 'Month': return new Date(today - 29 * DAY);
    case 'All': return new Date(0);
    default: throw new HttpError(400, 'range must be one of: Today, Week, Month, All.');
  }
}
