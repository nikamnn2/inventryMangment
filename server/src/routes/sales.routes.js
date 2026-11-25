/** Purpose: URLs for recording a sale (creates a bill and deducts stock), listing sales history and fetching one bill. */
import { Router } from 'express';
import { salesController } from '../controllers/sales.controller.js';
import { wrap } from '../utils/index.js';

export default function saleRoutes(ctx) {
  const c = salesController(ctx);
  const r = Router();
  r.get('/', wrap(c.list));
  r.get('/:billNo', wrap(c.get));
  r.post('/', wrap(c.create));
  return r;
}
