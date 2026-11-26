/** Purpose: protects routes. requireAuth checks the login token; requireModule checks the role may open a given section. */
import { HttpError } from '../utils/index.js';
import { sessionStamp, verifyToken } from '../services/auth.service.js';
import { COLLECTIONS as C } from '../database/collections.js';
import { canAccess } from '../models/user.model.js';

/**
 * Reads the "Authorization: Bearer <token>" header and sets req.user; responds 401 when it is missing or invalid.
 * The token alone is not trusted: the account must still exist, be active and have the same password,
 * and the role comes from the database. So removing a member, changing their role or changing a
 * password takes effect on the very next request.
 * When AUTH_DISABLED=1 every request is treated as the admin (temporary demo switch).
 */
export const requireAuth = ({ config, db }) => async (req, _res, next) => {
  if (config.authDisabled) {
    req.user = { sub: config.adminEmail, name: 'Nikhil Nikam', role: 'admin' };
    return next();
  }
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const denied = new HttpError(401, 'Authentication required.');
  let claims;
  try {
    claims = verifyToken(token, config);
  } catch {
    return next(denied);
  }
  try {
    const user = await db.collection(C.users).findOne({ email: String(claims.sub) });
    if (!user || user.status === 'pending' || claims.v !== sessionStamp(user)) return next(denied);
    req.user = { sub: user.email, name: user.name, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
};

/** Allows the request only when the user's role has access to the given module (tab). */
export const requireModule = module => (req, _res, next) =>
  canAccess(req.user?.role, module) ? next() : next(new HttpError(403, 'You do not have access to this section.'));
