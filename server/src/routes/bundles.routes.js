/** Purpose: URLs for bundles (packed lots of pieces). /lookup/:scan is what the barcode / QR scanner calls. */
import { Router } from 'express';
import { bundlesController } from '../controllers/bundles.controller.js';
import { wrap } from '../utils/index.js';

export default function bundleRoutes(ctx) {
  const c = bundlesController(ctx);
  const r = Router();
  r.get('/', wrap(c.list));
  /** Scanner lookup by bundle ID or a unique prefix (declared before /:bundleId so it is not swallowed by it). */
  r.get('/lookup/:scan', wrap(c.lookup));
  r.get('/:bundleId', wrap(c.get));
  r.post('/', wrap(c.create));
  /** Declared before /:bundleId so "rack" is not read as a bundle ID. */
  r.put('/rack', wrap(c.setRack));
  r.put('/:bundleId', wrap(c.update));
  return r;
}
