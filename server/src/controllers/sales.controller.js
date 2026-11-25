/** Purpose: request handlers for sales: history, one bill, and recording a sale which atomically deducts stock and creates the bill. */
import { COLLECTIONS as C } from '../database/collections.js';
import { SETTINGS_ID } from '../models/settings.model.js';
import { parseSaleRequest } from '../models/sale.model.js';
import { HttpError, escapeRegex, round2 } from '../utils/index.js';

const NO_ID = { projection: { _id: 0 } };

export function salesController({ db }) {
  const bundles = db.collection(C.bundles);
  const sales = db.collection(C.sales);

  return {
    /** Sales history (newest first, max 500), optionally searched by bill, customer, product or bundle. */
    async list(req, res) {
      const filter = {};
      if (req.query.q) {
        const rx = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
        filter.$or = [{ billNo: rx }, { customer: rx }, { product: rx }, { bundleId: rx }];
      }
      res.json(await sales.find(filter, NO_ID).sort({ createdAt: -1 }).limit(500).toArray());
    },

    /** Fetches one bill by number. */
    async get(req, res) {
      const s = await sales.findOne({ billNo: req.params.billNo }, NO_ID);
      if (!s) throw new HttpError(404, 'Sale not found.');
      res.json(s);
    },

    /**
     * Records a sale. The stock deduction is one atomic update guarded by `pieces >= quantity`,
     * so two cashiers selling the same bundle at once can never oversell it.
     */
    async create(req, res) {
      const { bundleId, quantity, customer } = parseSaleRequest(req.body);

      const bundle = await bundles.findOne({ bundleId });
      if (!bundle) throw new HttpError(404, 'Bundle not found.');
      if (bundle.pieces === 0) throw new HttpError(409, 'This bundle is sold out.');
      if (quantity > bundle.pieces) throw new HttpError(409, `Only ${bundle.pieces} pcs available in this bundle.`);

      // pipeline update: stage 1 reads the old values, stage 2 sees the new piece count
      const before = await bundles.findOneAndUpdate(
        { bundleId, pieces: { $gte: quantity } },
        [
          {
            $set: {
              weight: { $round: [{ $subtract: ['$weight', { $multiply: [{ $divide: ['$weight', '$pieces'] }, quantity] }] }, 2] },
              pieces: { $subtract: ['$pieces', quantity] },
              updatedAt: '$$NOW',
            },
          },
          { $set: { status: { $cond: [{ $eq: ['$pieces', 0] }, 'Sold', '$status'] } } },
        ],
        { returnDocument: 'before' },
      );
      if (!before) throw new HttpError(409, 'Not enough stock. Someone else just sold from this bundle.');

      const product = await db.collection(C.products).findOne({ dieNo: before.dieNo });
      const settings = await db.collection(C.settings).findOne({ _id: SETTINGS_ID });
      const weight = round2((before.weight / before.pieces) * quantity);
      const category = product?.category ?? 'Aluminium';
      const rate = settings?.rates?.[category] ?? 0;

      try {
        const seq = (await db.collection(C.counters).findOneAndUpdate(
          { _id: 'bill' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })).seq;
        const sale = {
          billNo: `INV-${seq}`,
          bundleId,
          dieNo: before.dieNo,
          product: product?.name ?? before.dieNo,
          category,
          pcs: quantity,
          weight,
          customer,
          amount: Math.round(weight * rate),
          createdAt: new Date(),
        };
        await sales.insertOne(sale);
        delete sale._id;
        res.status(201).json(sale);
      } catch (err) {
        // no multi-document transaction (works on a standalone mongod): put the stock back
        await bundles.updateOne({ bundleId }, { $set: { pieces: before.pieces, weight: before.weight, status: before.status } });
        throw err;
      }
    },
  };
}
