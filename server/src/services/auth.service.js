/** Purpose: authentication helpers: login tokens (JWT), password hashing and one-time account-activation tokens. */
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

/** Changes whenever the password changes, so a token issued for an older password stops working. */
export const sessionStamp = user => sha256(user.passwordHash ?? '').slice(0, 16);

/** Creates the login token the browser sends with every request. */
export const signToken = (user, config) =>
  jwt.sign({ sub: user.email, name: user.name, role: user.role, v: sessionStamp(user) }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
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

/** Hash used to store / compare activation tokens. */
export const hashToken = sha256;
