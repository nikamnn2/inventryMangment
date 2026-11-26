/** Purpose: URLs for signing in and for activating an invited member account. */
import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { limitFailures } from '../middleware/rate-limit.middleware.js';
import { wrap } from '../utils/index.js';

export default function authRoutes(ctx) {
  const c = authController(ctx);
  const r = Router();
  /** Failed sign-ins are limited per visitor + account, per account (many addresses) and per visitor (many accounts). */
  const email = req => String(req.body?.email ?? '').trim().toLowerCase().slice(0, 120);
  const loginLimits = [
    limitFailures({ max: 5, key: req => `${req.ip}|${email(req)}` }),
    limitFailures({ max: 30, key: email }),
    limitFailures({ max: 100, key: req => req.ip }),
  ];
  const linkLimit = limitFailures({ max: 20, key: req => req.ip });
  /** POST /api/auth/login - email + password -> login token. */
  r.post('/login', ...loginLimits, wrap(c.login));
  /** Public: shows whose account an activation link belongs to. */
  r.get('/activate/:token', linkLimit, wrap(c.activationInfo));
  /** Public: the invited member chooses a password and activates the account. */
  r.post('/activate', linkLimit, wrap(c.activate));
  /** Returns the signed-in user (name, role and which sections they may open). */
  r.get('/me', requireAuth(ctx), c.me);
  return r;
}
