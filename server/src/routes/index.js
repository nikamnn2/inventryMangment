import { Router } from 'express';
import { requireAuth, requireModule } from '../middleware/auth.middleware.js';
import { COLLECTIONS as C } from '../database/collections.js';
import productRoutes from './products.routes.js';
import bundleRoutes from './bundles.routes.js';
import saleRoutes from './sales.routes.js';
import stockRoutes from './stock.routes.js';
import reportRoutes from './reports.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import settingsRoutes from './settings.routes.js';
import partyRoutes from './parties.routes.js';
import memberRoutes from './members.routes.js';

/** Every route that needs a signed-in user. */
export function protectedRoutes(ctx) {
  const api = Router();
  /** Every route below needs a valid login token... */
  api.use(requireAuth(ctx));
  /** ...and each section also checks the role may open it (requireModule), e.g. accountants cannot edit products. */
  api.use('/products', requireModule('products'), productRoutes(ctx));
  api.use('/bundles', requireModule('bundles'), bundleRoutes(ctx));
  api.use('/sales', requireModule('sales'), saleRoutes(ctx));
  api.use('/stock', requireModule('stock'), stockRoutes(ctx));
  api.use('/reports', requireModule('reports'), reportRoutes(ctx));
  api.use('/dashboard', requireModule('dashboard'), dashboardRoutes(ctx));
  api.use('/settings', requireModule('settings'), settingsRoutes(ctx));
  api.use('/members', requireModule('members'), memberRoutes(ctx));
  api.use('/customers', requireModule('customers'), partyRoutes(ctx.db, C.customers));
  api.use('/suppliers', requireModule('suppliers'), partyRoutes(ctx.db, C.suppliers));
  return api;
}
