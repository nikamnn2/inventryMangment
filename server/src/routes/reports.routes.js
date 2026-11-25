/** Purpose: URLs for sales / packing reports and their CSV downloads. */
import { Router } from 'express';
import { reportsController } from '../controllers/reports.controller.js';
import { wrap } from '../utils/index.js';

export default function reportRoutes(ctx) {
  const c = reportsController(ctx);
  const r = Router();
  r.get('/', wrap(c.summary));
  r.get('/sales.csv', wrap(c.salesCsv));
  r.get('/packing.csv', wrap(c.packingCsv));
  return r;
}
