/** Purpose: URL for the dashboard summary (KPIs, status split, low stock, 7-day trend). */
import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller.js';
import { wrap } from '../utils/index.js';

export default function dashboardRoutes(ctx) {
  const c = dashboardController(ctx);
  const r = Router();
  r.get('/', wrap(c.overview));
  return r;
}
