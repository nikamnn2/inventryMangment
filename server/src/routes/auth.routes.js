/** Purpose: URLs for signing in and for activating an invited member account. */
import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { wrap } from '../utils/index.js';

export default function authRoutes(ctx) {
  const c = authController(ctx);
  const r = Router();
  /** POST /api/auth/login - email + password -> login token. */
  r.post('/login', wrap(c.login));
  /** Public: shows whose account an activation link belongs to. */
  r.get('/activate/:token', wrap(c.activationInfo));
  /** Public: the invited member chooses a password and activates the account. */
  r.post('/activate', wrap(c.activate));
  /** Returns the signed-in user (name, role and which sections they may open). */
  r.get('/me', requireAuth(ctx.config), c.me);
  return r;
}
