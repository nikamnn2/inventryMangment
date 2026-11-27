/** Purpose: validation of a new sales invoice (which bundles, for which customer) and its totals. */
import { HttpError, round2, str } from '../utils/index.js';

/** More than any real delivery, but keeps one request bounded. */
export const MAX_INVOICE_BUNDLES = 300;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s()-]{7,20}$/;

/** Validates a "create invoice" request: bundle numbers and the customer's name, contact number and (optional) email. */
export function parseInvoiceRequest(body) {
  const list = body?.bundleIds;
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Add at least one bundle.');
  if (list.length > MAX_INVOICE_BUNDLES) throw new HttpError(400, `An invoice can have at most ${MAX_INVOICE_BUNDLES} bundles.`);
  const bundleIds = list.map(id => str(id, 'Bundle number', { required: true, max: 64 }));
  if (new Set(bundleIds).size !== bundleIds.length) throw new HttpError(400, 'The same bundle is in the list twice.');

  const name = str(body?.customer?.name, 'Customer name', { required: true, max: 120 });
  const contact = str(body?.customer?.contact, 'Contact number', { required: true, max: 20 });
  if (!PHONE.test(contact) || contact.replace(/\D/g, '').length < 7) throw new HttpError(400, 'Enter a valid contact number.');
  const email = str(body?.customer?.email, 'Email', { max: 120 }).toLowerCase();
  if (email && !EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  return { bundleIds, customer: { name, contact, email } };
}

/** Pieces, weight, bundle count and (internal) amount of the invoice lines. */
export const invoiceTotals = items => ({
  bundles: items.length,
  pcs: items.reduce((n, i) => n + i.pcs, 0),
  weight: round2(items.reduce((n, i) => n + i.weight, 0)),
  amount: items.reduce((n, i) => n + i.amount, 0),
});
