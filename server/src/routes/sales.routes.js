/** Purpose: URLs for recording a sale (creates a bill and deducts stock), listing sales history and fetching one bill. */
import { Router } from 'express';
import { salesController } from '../controllers/sales.controller.js';
import { invoicesController } from '../controllers/invoices.controller.js';
import { wrap } from '../utils/index.js';

export default function saleRoutes(ctx) {
  const c = salesController(ctx);
  const r = Router();
  /** Invoices of whole bundles: add by number or scan, create, and (admins) approve or reject. */
  const invoices = invoicesController(ctx);
  r.get('/lookup/:code', wrap(invoices.lookup));
  r.get('/customers', wrap(invoices.customers));
  r.get('/invoices', wrap(invoices.list));
  r.get('/invoices/:saleNo/pdf', wrap(invoices.pdf));
  r.get('/invoices/:saleNo', wrap(invoices.get));
  r.post('/invoices', wrap(invoices.create));
  r.post('/invoices/:saleNo/approve', wrap(invoices.approve));
  r.post('/invoices/:saleNo/reject', wrap(invoices.reject));
  r.get('/', wrap(c.list));
  r.get('/:billNo', wrap(c.get));
  r.post('/', wrap(c.create));
  return r;
}
