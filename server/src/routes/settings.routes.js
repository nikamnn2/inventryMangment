/** Purpose: URLs for company settings (name, GSTIN, low-stock limit, per-kg rates). */
import { Router } from 'express';
import { settingsController } from '../controllers/settings.controller.js';
import { wrap } from '../utils/index.js';

export default function settingsRoutes(ctx) {
  const c = settingsController(ctx);
  const r = Router();
  r.get('/', wrap(c.get));
  r.put('/', wrap(c.update));
  return r;
}
