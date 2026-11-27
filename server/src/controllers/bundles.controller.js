/** Purpose: request handlers for bundles: list/search, scanner lookup, get one, create (assigns the number used in the barcode / QR code) and edit. */
import { COLLECTIONS as C } from '../database/collections.js';
import { BUNDLE_STATUSES, parseBundle, parseRackChange, withAvg } from '../models/bundle.model.js';
import { HttpError, escapeRegex, nextBundleId, oneOf } from '../utils/index.js';

const NO_ID = { projection: { _id: 0 } };

export function bundlesController({ db }) {
  const bundles = db.collection(C.bundles);
  const products = db.collection(C.products);

  return {
    /** Lists bundles, optionally filtered by status, die number or a search text (ID, die no, rack or product name). */
    async list(req, res) {
      const filter = {};
      if (req.query.status) filter.status = oneOf(req.query.status, 'status', BUNDLE_STATUSES);
      if (req.query.dieNo) filter.dieNo = String(req.query.dieNo);
      if (req.query.q) {
        const q = String(req.query.q).trim();
        const rx = new RegExp(escapeRegex(q), 'i');
        const matching = await products.find({ name: rx }, { projection: { dieNo: 1 } }).toArray();
        filter.$or = [{ bundleId: rx }, { dieNo: rx }, { rack: rx }, { dieNo: { $in: matching.map(p => p.dieNo) } }];
      }
      res.json((await bundles.find(filter, NO_ID).sort({ createdAt: -1 }).toArray()).map(withAvg));
    },

    /**
     * Barcode / scanner lookup: exact bundle ID. Older letter-and-digit IDs also match a unique prefix of
     * at least 4 characters; numbers must match in full, or 1002 could open bundle 10020.
     */
    async lookup(req, res) {
      const scan = req.params.scan.trim().toLowerCase();
      let found = await bundles.findOne({ bundleId: scan }, NO_ID);
      if (!found && scan.length >= 4 && !/^\d+$/.test(scan)) {
        const matches = await bundles.find({ bundleId: { $regex: `^${escapeRegex(scan)}` } }, NO_ID).limit(2).toArray();
        if (matches.length > 1) throw new HttpError(409, 'Several bundles match that scan. Enter more characters.');
        found = matches[0];
      }
      if (!found) throw new HttpError(404, 'Bundle not found.');
      res.json(withAvg(found));
    },

    /** Fetches one bundle by its ID. */
    async get(req, res) {
      const b = await bundles.findOne({ bundleId: req.params.bundleId }, NO_ID);
      if (!b) throw new HttpError(404, 'Bundle not found.');
      res.json(withAvg(b));
    },

    /** Adds a bundle. The server assigns the next bundle number, which is also its barcode / QR value. */
    async create(req, res) {
      const data = await parseBundle(req.body, products, { creating: true });
      const bundleId = await nextBundleId(db);
      const doc = { bundleId, barcode: bundleId, ...data, createdAt: new Date() };
      await bundles.insertOne(doc);
      delete doc._id;
      res.status(201).json(withAvg(doc));
    },

    /**
     * Sets the rack of several bundles (to correct a wrong choice). Only the rack is written, so stock that
     * changes meanwhile is never overwritten. Bundles held by a waiting invoice are left as they are.
     */
    async setRack(req, res) {
      const { bundleIds, rack } = parseRackChange(req.body);
      const found = await bundles.find({ bundleId: { $in: bundleIds } }, { projection: { _id: 0, bundleId: 1, reservedBy: 1 } }).toArray();
      if (found.length !== bundleIds.length) throw new HttpError(404, 'Some of these bundles no longer exist. Reload and try again.');
      const result = await bundles.updateMany({ bundleId: { $in: bundleIds }, reservedBy: { $exists: false } }, { $set: { rack, updatedAt: new Date() } });
      res.json({ rack, updated: result.matchedCount, held: found.filter(b => b.reservedBy).map(b => b.bundleId) });
    },

    /** Edits a bundle (pieces, weight, rack, status...). */
    async update(req, res) {
      const data = await parseBundle(req.body, products, { creating: false });
      const held = await bundles.findOne({ bundleId: req.params.bundleId, reservedBy: { $exists: true } });
      if (held) throw new HttpError(409, `This bundle is waiting for approval on ${held.reservedBy} and cannot be changed.`);
      const updated = await bundles.findOneAndUpdate(
        { bundleId: req.params.bundleId, reservedBy: { $exists: false } },
        { $set: { ...data, updatedAt: new Date() } },
        { returnDocument: 'after', projection: { _id: 0 } },
      );
      if (!updated) throw new HttpError(404, 'Bundle not found.');
      res.json(withAvg(updated));
    },
  };
}
