/** Purpose: request handlers for the stock overview: bundles with product name / category, low-stock count and per-category totals, plus a CSV export. */
import { COLLECTIONS as C } from '../database/collections.js';
import { CATEGORIES } from '../models/product.model.js';
import { withAvg } from '../models/bundle.model.js';
import { SETTINGS_ID } from '../models/settings.model.js';
import { escapeRegex, oneOf, sendCsv } from '../utils/index.js';

export function stockController({ db }) {
  /** Applies the state (all / available / sold), die number and search filters and joins each bundle with its product. */
  async function load(query) {
    const state = oneOf(query.state ?? 'all', 'state', ['all', 'available', 'sold']);
    const filter = {};
    if (state === 'available') filter.pieces = { $gt: 0 };
    if (state === 'sold') filter.pieces = 0;
    if (query.dieNo) filter.dieNo = String(query.dieNo);

    const products = await db.collection(C.products).find({}, { projection: { _id: 0 } }).toArray();
    const byDie = new Map(products.map(p => [p.dieNo, p]));

    if (query.q) {
      const rx = new RegExp(escapeRegex(String(query.q).trim()), 'i');
      const nameMatches = products.filter(p => rx.test(p.name)).map(p => p.dieNo);
      filter.$or = [{ bundleId: rx }, { dieNo: rx }, { rack: rx }, { dieNo: { $in: nameMatches } }];
    }

    const bundles = await db.collection(C.bundles).find(filter, { projection: { _id: 0 } }).toArray();
    return bundles
      .map(b => ({ ...withAvg(b), productName: byDie.get(b.dieNo)?.name ?? b.dieNo, category: byDie.get(b.dieNo)?.category ?? 'Aluminium' }))
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }

  return {
    /** Rows plus summary figures shown on the Stock Overview page. */
    async overview(req, res) {
      const rows = await load(req.query);
      const settings = await db.collection(C.settings).findOne({ _id: SETTINGS_ID });
      const limit = settings?.lowStockLimit ?? 20;
      const summary = {};
      for (const cat of CATEGORIES) {
        const list = rows.filter(b => b.category === cat);
        summary[cat] = { bundles: list.length, pieces: list.reduce((n, b) => n + b.pieces, 0), weight: list.reduce((n, b) => n + b.weight, 0) };
      }
      res.json({ lowStockLimit: limit, lowStock: rows.filter(b => b.pieces > 0 && b.pieces < limit).length, summary, rows });
    },

    /** Downloads the filtered stock rows as a CSV file. */
    async exportCsv(req, res) {
      const rows = await load(req.query);
      sendCsv(res, 'stock-overview.csv', ['Product', 'Die No', 'Bundle ID', 'Rack', 'Pieces', 'Weight (kg)', 'Status'],
        rows.map(b => [b.productName, b.dieNo, b.bundleId, b.rack, b.pieces, b.weight, b.status]));
    },
  };
}
