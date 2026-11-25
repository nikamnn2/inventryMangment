/** Purpose: URLs for the stock overview (per bundle, with filters) and its CSV export. */
import { Router } from 'express';
import { stockController } from '../controllers/stock.controller.js';
import { wrap } from '../utils/index.js';

export default function stockRoutes(ctx) {
  const c = stockController(ctx);
  const r = Router();
  r.get('/', wrap(c.overview));
  r.get('/export.csv', wrap(c.exportCsv));
  return r;
}
