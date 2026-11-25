/** Purpose: protects routes. requireAuth checks the login token; requireModule checks the role may open a given section. */
import { HttpError } from '../utils/index.js';
import { verifyToken } from '../services/auth.service.js';
import { canAccess } from '../models/user.model.js';

/**
 * Reads the "Authorization: Bearer <token>" header and sets req.user; responds 401 when it is missing or invalid.
 * When AUTH_DISABLED=1 every request is treated as the admin (temporary demo switch).
 */
export const requireAuth = config => (req, _res, next) => {
  if (config.authDisabled) {
    req.user = { sub: config.adminEmail, name: 'Nikhil Nikam', role: 'admin' };
    return next();
  }
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    req.user = verifyToken(token, config);
    next();
  } catch {
    next(new HttpError(401, 'Authentication required.'));
  }
};

/** Allows the request only when the user's role has access to the given module (tab). */
export const requireModule = module => (req, _res, next) =>
  canAccess(req.user?.role, module) ? next() : next(new HttpError(403, 'You do not have access to this section.'));
