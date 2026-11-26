/** Purpose: authentication helpers: login tokens (JWT), password hashing and one-time account-activation tokens. */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

/** Changes whenever the password changes, so a token issued for an older password stops working. */
export const sessionStamp = user => sha256(user.passwordHash ?? '').slice(0, 16);

/** Creates the login token the browser sends with every request. */
export const signToken = (user, config, { remember = false } = {}) =>
  jwt.sign({ sub: user.email, name: user.name, role: user.role, v: sessionStamp(user) }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: remember ? config.jwtRememberExpiresIn ?? '30d' : config.jwtExpiresIn,
  });

/** Validates a login token and returns its claims; throws when invalid or expired. */
export const verifyToken = (token, config) => jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

/** Passwords are stored only as bcrypt hashes, never as plain text. */
export const hashPassword = pw => bcrypt.hash(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

const sha256 = s => createHash('sha256').update(s).digest('hex');

/** One-time activation link token. Only the hash is stored, so a database leak cannot be used to activate accounts. */
export function newActivation(hours) {
  const token = randomBytes(32).toString('hex');
  return { token, activationHash: sha256(token), activationExpires: new Date(Date.now() + hours * 3_600_000) };
}

/** How long a "forgot password" request can wait for an admin, and how long an approval can then be used. */
export const RESET_HOURS = 24;

/**
 * A new "forgot password" request. `token` stays in the browser that asked (only its hash is stored),
 * so an approval can be used on that device only. `code` is shown to the person and to the admin, who
 * compares them to be sure the request really came from that person.
 */
export function newResetRequest() {
  const token = randomBytes(32).toString('hex');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const record = { tokenHash: sha256(token), code, status: 'requested', requestedAt: new Date(), expires: new Date(Date.now() + RESET_HOURS * 3_600_000) };
  return { token, code, record };
}

/** Hash used to store / compare activation tokens. */
export const hashToken = sha256;
