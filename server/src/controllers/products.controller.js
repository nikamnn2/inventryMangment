/** Purpose: request handlers for the product catalogue (Die No, name, category, size, finish). */
import { COLLECTIONS as C } from '../database/collections.js';
import { CATEGORIES, parseProduct } from '../models/product.model.js';
import { HttpError, escapeRegex, oneOf } from '../utils/index.js';

const NO_ID = { projection: { _id: 0 } };

export function productsController({ db }) {
  const products = db.collection(C.products);

  return {
    /** Lists products, optionally filtered by category or a search text. */
    async list(req, res) {
      const filter = {};
      if (req.query.category && req.query.category !== 'All') filter.category = oneOf(req.query.category, 'category', CATEGORIES);
      if (req.query.q) {
        const rx = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
        filter.$or = [{ dieNo: rx }, { name: rx }, { finish: rx }, { size: rx }];
      }
      res.json(await products.find(filter, NO_ID).sort({ createdAt: -1, dieNo: 1 }).toArray());
    },

    /** Fetches one product by Die No. */
    async get(req, res) {
      const p = await products.findOne({ dieNo: req.params.dieNo }, NO_ID);
      if (!p) throw new HttpError(404, 'Product not found.');
      res.json(p);
    },

    /** Adds a product; Die No must be unique. */
    async create(req, res) {
      const p = parseProduct(req.body);
      if (await products.findOne({ dieNo: p.dieNo })) throw new HttpError(409, `Die No ${p.dieNo} already exists.`);
      await products.insertOne({ ...p, createdAt: new Date() });
      res.status(201).json(p);
    },

    /** Edits a product. Renaming the Die No also re-links the product's bundles. */
    async update(req, res) {
      const current = req.params.dieNo;
      const p = parseProduct(req.body);
      if (!(await products.findOne({ dieNo: current }))) throw new HttpError(404, 'Product not found.');
      if (p.dieNo !== current && (await products.findOne({ dieNo: p.dieNo }))) throw new HttpError(409, `Die No ${p.dieNo} already exists.`);
      await products.updateOne({ dieNo: current }, { $set: { ...p, updatedAt: new Date() } });
      // keep bundles linked when the Die No itself is edited
      if (p.dieNo !== current) await db.collection(C.bundles).updateMany({ dieNo: current }, { $set: { dieNo: p.dieNo } });
      res.json(p);
    },
  };
}
