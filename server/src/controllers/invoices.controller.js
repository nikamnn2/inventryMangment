/**
 * Purpose: sales invoices of whole bundles. A sales user's invoice waits for an admin to approve it,
 * with its bundles reserved so nobody else can sell them; an admin's invoice is issued at once.
 * Issuing marks the bundles sold and writes one sales line per bundle (what reports and the dashboard read).
 */
import { COLLECTIONS as C } from '../database/collections.js';
import { SETTINGS_ID } from '../models/settings.model.js';
import { invoiceTotals, parseInvoiceRequest } from '../models/invoice.model.js';
import { canDraw, renderInvoicePdf } from '../services/invoice-pdf.service.js';
import { HttpError, escapeRegex } from '../utils/index.js';

const NO_ID = { projection: { _id: 0 } };
const isAdmin = req => req.user.role === 'admin';
/** Phone numbers compare by their last 10 digits, so "+91 98604 70406" and "9860470406" are the same. */
const phoneKey = value => String(value ?? '').replace(/\D/g, '').slice(-10);

export function invoicesController({ db }) {
  const bundles = db.collection(C.bundles);
  const invoices = db.collection(C.invoices);
  const sales = db.collection(C.sales);

  /** A bundle can go on an invoice when it has stock, is not sold and no other invoice holds it. */
  const FREE = { pieces: { $gt: 0 }, status: { $ne: 'Sold' }, reservedBy: { $exists: false } };

  function mustBeFree(bundle) {
    if (!bundle) throw new HttpError(404, 'Bundle not found.');
    if (bundle.pieces === 0 || bundle.status === 'Sold') throw new HttpError(409, `Bundle ${bundle.bundleId} is already sold.`);
    if (bundle.reservedBy) throw new HttpError(409, `Bundle ${bundle.bundleId} is waiting for approval on ${bundle.reservedBy}.`);
  }

  /**
   * Keeps the customer for next time. The same name and phone number is the same customer (a missing
   * email is filled in, a new one replaces the old); anything else is saved as a new customer, so one
   * customer is never overwritten by another who shares only a name or a number.
   */
  async function saveCustomer({ name, contact, email }) {
    const customers = db.collection(C.customers);
    const sameName = await customers.find({ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } }).limit(50).toArray();
    const known = sameName.find(c => phoneKey(c.contact) === phoneKey(contact));
    if (!known) await customers.insertOne({ name, city: "", contact, email, detail: "", status: "Active", createdAt: new Date() });
    else if (email && email !== known.email) await customers.updateOne({ _id: known._id }, { $set: { email, updatedAt: new Date() } });
  }

  /** The lines of an invoice, with everything copied so a later product edit does not change it. */
  async function describe(list) {
    const products = await db.collection(C.products).find({ dieNo: { $in: list.map(b => b.dieNo) } }).toArray();
    const byDie = new Map(products.map(p => [p.dieNo, p]));
    const settings = await db.collection(C.settings).findOne({ _id: SETTINGS_ID });
    return list.map(b => {
      const product = byDie.get(b.dieNo);
      const category = product?.category ?? 'Aluminium';
      return {
        bundleId: b.bundleId, dieNo: b.dieNo, product: product?.name ?? b.dieNo, size: product?.size ?? '', rack: b.rack ?? '', length: product?.clValue ?? '', category, bundleStatus: b.status,
        pcs: b.pieces, weight: b.weight, amount: Math.round(b.weight * (settings?.rates?.[category] ?? 0)),
      };
    });
  }

  /** Invoices made before the length was kept take it from the product as it is now. */
  async function withLength(list) {
    const missing = list.flatMap(i => i.items.filter(line => line.length === undefined));
    if (missing.length) {
      const products = await db.collection(C.products).find({ dieNo: { $in: missing.map(line => line.dieNo) } }).toArray();
      const byDie = new Map(products.map(p => [p.dieNo, p.clValue ?? '']));
      for (const line of missing) line.length = byDie.get(line.dieNo) ?? '';
    }
    return list;
  }

  const release = saleNo => bundles.updateMany({ reservedBy: saleNo }, { $unset: { reservedBy: '' } });

  /** Sells the reserved bundles and records the sales lines. */
  async function issue(invoice, by) {
    const issuedAt = new Date();
    await sales.insertMany(invoice.items.map((item, i) => ({
      billNo: `${invoice.saleNo}-${i + 1}`, invoiceNo: invoice.saleNo, bundleId: item.bundleId, dieNo: item.dieNo,
      product: item.product, category: item.category, pcs: item.pcs, weight: item.weight, customer: invoice.customer.name,
      amount: item.amount, createdAt: issuedAt,
    })));
    await bundles.updateMany(
      { reservedBy: invoice.saleNo },
      { $set: { pieces: 0, weight: 0, status: 'Sold', updatedAt: issuedAt }, $unset: { reservedBy: '' } },
    );
    const done = { status: 'issued', issuedAt, approvedBy: by };
    await invoices.updateOne({ saleNo: invoice.saleNo }, { $set: done });
    return { ...invoice, ...done };
  }

  /**
   * Puts the bundles of a deleted issued invoice back in stock. A bundle that is no longer as that sale
   * left it (edited since, on another sale, or gone) is not overwritten; its number is returned instead.
   */
  async function restock(invoice) {
    const notRestored = [];
    for (const item of invoice.items) {
      // only a later sale matters: part of the bundle may have been billed before this invoice
      const later = await sales.findOne({ bundleId: item.bundleId, invoiceNo: { $ne: invoice.saleNo }, createdAt: { $gt: invoice.issuedAt } });
      const result = later ? null : await bundles.updateOne(
        { bundleId: item.bundleId, pieces: 0, status: 'Sold', reservedBy: { $exists: false } },
        { $set: { pieces: item.pcs, weight: item.weight, status: item.bundleStatus && item.bundleStatus !== 'Sold' ? item.bundleStatus : 'Packed', updatedAt: new Date() } },
      );
      if (!result?.matchedCount) notRestored.push(item.bundleId);
    }
    return notRestored;
  }

  /** Takes a waiting invoice for one decision, so two admins can never both act on it. */
  async function claim(saleNo, next) {
    const invoice = await invoices.findOneAndUpdate({ saleNo, status: 'pending' }, { $set: { status: next } }, { returnDocument: 'before', ...NO_ID });
    if (invoice) return invoice;
    if (await invoices.findOne({ saleNo })) throw new HttpError(409, 'This invoice has already been decided.');
    throw new HttpError(404, 'Invoice not found.');
  }

  return {
    /** Everything about one bundle, for adding it to a new invoice (scanned or typed number). */
    async lookup(req, res) {
      const code = req.params.code.trim().toLowerCase();
      let bundle = await bundles.findOne({ bundleId: code });
      // older letter-and-digit IDs also match a unique beginning; numbers must match in full
      if (!bundle && code.length >= 4 && !/^\d+$/.test(code)) {
        const matches = await bundles.find({ bundleId: { $regex: `^${escapeRegex(code)}` } }).limit(2).toArray();
        if (matches.length > 1) throw new HttpError(409, 'Several bundles match that scan. Enter more characters.');
        bundle = matches[0];
      }
      mustBeFree(bundle);
      const [{ amount, category, bundleStatus, ...line }] = await describe([bundle]);
      res.json(line);
    },

    /**
     * Suggestions while typing on a new sale: bundles that can be sold, newest first. Every word typed
     * must be found in the bundle number, die number, rack, product name or size.
     */
    async search(req, res) {
      const words = String(req.query.q ?? '').trim().slice(0, 80).split(/\s+/).filter(Boolean).slice(0, 6);
      const and = [];
      for (const word of words) {
        const rx = new RegExp(escapeRegex(word), 'i');
        const products = await db.collection(C.products).find({ $or: [{ name: rx }, { size: rx }] }, { projection: { dieNo: 1 } }).limit(500).toArray();
        and.push({ $or: [{ bundleId: rx }, { dieNo: rx }, { rack: rx }, { dieNo: { $in: products.map(p => p.dieNo) } }] });
      }
      const found = await bundles.find(and.length ? { ...FREE, $and: and } : FREE).sort({ createdAt: -1 }).limit(30).toArray();
      res.json((await describe(found)).map(({ amount, category, bundleStatus, ...line }) => line));
    },

    /** Saved customers for the name suggestions on a new invoice. */
    async customers(_req, res) {
      const list = await db.collection(C.customers).find({}, { projection: { _id: 0, name: 1, contact: 1, email: 1, city: 1 } }).sort({ name: 1 }).limit(2000).toArray();
      res.json(list.map(c => ({ name: c.name, contact: c.contact ?? '', email: c.email ?? '', city: c.city ?? '' })));
    },

    /** Invoices, newest first (max 500). */
    async list(_req, res) {
      res.json(await withLength(await invoices.find({}, NO_ID).sort({ createdAt: -1 }).limit(500).toArray()));
    },

    async get(req, res) {
      const invoice = await invoices.findOne({ saleNo: req.params.saleNo }, NO_ID);
      if (!invoice) throw new HttpError(404, 'Invoice not found.');
      res.json((await withLength([invoice]))[0]);
    },

    /** Downloads an issued invoice as an A4 PDF. `tz` is the reader's time zone, for the date. */
    async pdf(req, res) {
      const invoice = await invoices.findOne({ saleNo: req.params.saleNo }, NO_ID);
      if (!invoice) throw new HttpError(404, 'Invoice not found.');
      if (invoice.status !== 'issued') throw new HttpError(409, 'Only an approved invoice can be downloaded.');
      await withLength([invoice]);
      if (!canDraw(invoice)) {
        throw new HttpError(422, 'The PDF download supports English letters only. Use "Print invoice" and choose "Save as PDF" for this one.');
      }
      const file = await renderInvoicePdf(invoice, { timeZone: String(req.query.tz ?? '').slice(0, 60) });
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${invoice.saleNo}.pdf"`, 'Cache-Control': 'no-store' });
      res.send(file);
    },

    /** Creates an invoice. An admin's is issued at once; anyone else's waits for an admin. */
    async create(req, res) {
      const { bundleIds, customer } = parseInvoiceRequest(req.body);
      const found = await bundles.find({ bundleId: { $in: bundleIds } }).toArray();
      const byId = new Map(found.map(b => [b.bundleId, b]));
      for (const id of bundleIds) {
        if (!byId.has(id)) throw new HttpError(404, `Bundle ${id} was not found.`);
        mustBeFree(byId.get(id));
      }

      const counter = await db.collection(C.counters).findOneAndUpdate(
        { _id: 'invoice' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
      const saleNo = `SALE-${String(counter.seq).padStart(6, '0')}`;

      try {
        // reserve one by one: each update only succeeds if the bundle is still free
        const reserved = [];
        for (const bundleId of bundleIds) {
          const bundle = await bundles.findOneAndUpdate({ bundleId, ...FREE }, { $set: { reservedBy: saleNo } }, { returnDocument: 'after' });
          if (!bundle) throw new HttpError(409, `Bundle ${bundleId} was just taken by someone else.`);
          reserved.push(bundle);
        }
        const items = await describe(reserved);
        const settings = await db.collection(C.settings).findOne({ _id: SETTINGS_ID });
        let invoice = {
          saleNo, status: 'pending', company: settings?.company ?? '', customer, items, totals: invoiceTotals(items),
          createdBy: req.user.sub, createdByName: req.user.name, createdAt: new Date(),
        };
        await invoices.insertOne(invoice);
        delete invoice._id;
        // not worth failing the invoice over: the customer is also stored on the invoice itself
        await saveCustomer(customer).catch(err => console.error('[customers] not saved:', err.message));
        if (isAdmin(req)) invoice = await issue(invoice, req.user.sub);
        res.status(201).json(invoice);
      } catch (err) {
        // no multi-document transaction (works on a standalone mongod): free what was reserved
        await release(saleNo);
        await invoices.deleteOne({ saleNo });
        await sales.deleteMany({ invoiceNo: saleNo });
        throw err;
      }
    },

    /** Admin only: issues a waiting invoice. */
    async approve(req, res) {
      if (!isAdmin(req)) throw new HttpError(403, 'Only an admin can approve invoices.');
      const invoice = await claim(req.params.saleNo, 'issuing');
      try {
        res.json(await issue((await withLength([invoice]))[0], req.user.sub));
      } catch (err) {
        await sales.deleteMany({ invoiceNo: invoice.saleNo });
        await invoices.updateOne({ saleNo: invoice.saleNo }, { $set: { status: 'pending' } });
        throw err;
      }
    },

    /**
     * Removes an invoice. An admin may remove any; anyone else only one they made that is still waiting
     * (nothing is sold yet). An issued one gives its bundles back to stock and drops its sales lines; a
     * waiting one frees them. The newest number is used again; older numbers are left as they are, so
     * invoices that have already been handed out keep theirs.
     */
    async remove(req, res) {
      const { saleNo } = req.params;
      const allowed = isAdmin(req) ? { status: { $in: ['pending', 'issued', 'rejected'] } } : { status: 'pending', createdBy: req.user.sub };
      // take it for this one action, so it cannot be approved or deleted twice at the same time
      const invoice = await invoices.findOneAndUpdate({ saleNo, ...allowed }, { $set: { status: 'deleting' } }, { returnDocument: 'before' });
      if (!invoice) {
        const existing = await invoices.findOne({ saleNo });
        if (!existing) throw new HttpError(404, 'Invoice not found.');
        if (!isAdmin(req)) {
          if (existing.createdBy !== req.user.sub) throw new HttpError(403, 'You can cancel only your own invoice. Ask an admin to delete this one.');
          if (existing.status === 'issued' || existing.status === 'rejected') throw new HttpError(403, 'An admin has already decided this invoice. Ask an admin to delete it.');
        }
        throw new HttpError(409, 'This invoice is being changed right now. Try again in a moment.');
      }
      let notRestored = [];
      try {
        if (invoice.status === 'issued') {
          notRestored = await restock(invoice);
          await sales.deleteMany({ invoiceNo: saleNo });
        } else if (invoice.status === 'pending') {
          await release(saleNo);
        }
        await invoices.deleteOne({ _id: invoice._id });
      } catch (err) {
        await invoices.updateOne({ _id: invoice._id }, { $set: { status: invoice.status } });
        throw err;
      }
      // one atomic step back, only when no newer number has been handed out
      const number = Number(saleNo.replace(/\D/g, ''));
      const reused = await db.collection(C.counters).updateOne({ _id: 'invoice', seq: number }, { $set: { seq: number - 1 } });
      res.json({
        deleted: saleNo,
        restocked: invoice.status === 'issued' ? invoice.items.length - notRestored.length : 0,
        notRestored,
        numberReused: reused.matchedCount > 0,
      });
    },

    /** Admin only: turns a waiting invoice down and frees its bundles. */
    async reject(req, res) {
      if (!isAdmin(req)) throw new HttpError(403, 'Only an admin can reject invoices.');
      const invoice = await claim(req.params.saleNo, 'rejected');
      await release(invoice.saleNo);
      await invoices.updateOne({ saleNo: invoice.saleNo }, { $set: { rejectedBy: req.user.sub, rejectedAt: new Date() } });
      res.json({ ...invoice, status: 'rejected' });
    },
  };
}
