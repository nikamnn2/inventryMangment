/** Purpose: input validation for request bodies. Each helper returns the clean value or throws a 400 HttpError with a readable message. */
import { HttpError } from './http-error.js';

/** Text field: trims, optionally required, with a maximum length. */
export function str(value, label, { required = false, max = 120 } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (required && !v) throw new HttpError(400, `${label} is required.`);
  if (v.length > max) throw new HttpError(400, `${label} must be at most ${max} characters.`);
  return v;
}

/** Number field: accepts numeric strings, optional whole-number / minimum checks. */
export function num(value, label, { min = 0, integer = false, exclusiveMin = false } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, `${label} must be a number.`);
  if (integer && !Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number.`);
  if (exclusiveMin ? n <= min : n < min) throw new HttpError(400, `${label} must be ${exclusiveMin ? 'greater than' : 'at least'} ${min}.`);
  return n;
}

/** Value must be one of a fixed list (e.g. category, status). */
export const oneOf = (value, label, allowed) => {
  if (!allowed.includes(value)) throw new HttpError(400, `${label} must be one of: ${allowed.join(', ')}.`);
  return value;
};
