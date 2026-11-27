/** Purpose: request handlers for reports: totals for a date range plus sales and packing CSV exports. */
import { COLLECTIONS as C } from '../database/collections.js';
import { withAvg } from '../models/bundle.model.js';
import { isoDate, rangeStart, sendCsv } from '../utils/index.js';

export function reportsController({ db }) {
  /** Loads sales, bundles and product names for a range (Today / Week / Month / All) once, for both JSON and CSV. */
  async function load(range = 'All') {
    const since = rangeStart(range);
    const [sales, bundles, products] = await Promise.all([
      db.collection(C.sales).find({ createdAt: { $gte: since } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray(),
      db.collection(C.bundles).find(range === 'All' ? {} : { packed: { $gte: isoDate(since) } }, { projection: { _id: 0 } }).sort({ packed: -1 }).toArray(),
      db.collection(C.products).find({}, { projection: { _id: 0, dieNo: 1, name: 1 } }).toArray(),
    ]);
    const names = new Map(products.map(p => [p.dieNo, p.name]));
    const packing = bundles.map(b => ({ ...withAvg(b), productName: names.get(b.dieNo) ?? b.dieNo }));
    return { range, since, sales, packing };
  }

  return {
    /** Totals (revenue, weight sold, bills, bundles packed) plus the detailed rows. */
    async summary(req, res) {
      const { range, since, sales, packing } = await load(req.query.range);
      res.json({
        range,
        since,
        totals: {
          revenue: sales.reduce((n, s) => n + s.amount, 0),
          weightSold: Math.round(sales.reduce((n, s) => n + s.weight, 0) * 100) / 100,
          bills: new Set(sales.map(s => s.invoiceNo ?? s.billNo)).size,
          bundlesPacked: packing.length,
        },
        sales,
        packing,
      });
    },

    /** Downloads the sales rows as a CSV file. */
    async salesCsv(req, res) {
      const { sales } = await load(req.query.range);
      sendCsv(res, 'sales-report.csv', ['Bill', 'Date', 'Customer', 'Product', 'Pcs', 'Weight (kg)', 'Amount'],
        sales.map(s => [s.billNo, s.createdAt.toISOString(), s.customer, s.product, s.pcs, s.weight, s.amount]));
    },

    /** Downloads the packing (bundles) rows as a CSV file. */
    async packingCsv(req, res) {
      const { packing } = await load(req.query.range);
      sendCsv(res, 'packing-report.csv', ['Bundle ID', 'Product', 'Packed', 'Pieces', 'Weight (kg)', 'Status'],
        packing.map(b => [b.bundleId, b.productName, b.packed, b.pieces, b.weight, b.status]));
    },
  };
}
