/** Purpose: builds the dashboard numbers in one request: totals, status split, low-stock bundles, today's bills / revenue and the 7-day weight-sold trend. */
import { COLLECTIONS as C } from '../database/collections.js';
import { withAvg } from '../models/bundle.model.js';
import { SETTINGS_ID } from '../models/settings.model.js';
import { DAY, isoDate, startOfDay } from '../utils/index.js';

export function dashboardController({ db }) {
  return {
    /** Runs the independent queries in parallel, then derives every dashboard figure from them. */
    async overview(_req, res) {
      const today = startOfDay();
      const weekStart = new Date(today.getTime() - 6 * DAY);
      const [products, bundles, settings, recent, weekSales] = await Promise.all([
        db.collection(C.products).countDocuments(),
        db.collection(C.bundles).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray(),
        db.collection(C.settings).findOne({ _id: SETTINGS_ID }),
        db.collection(C.sales).find({ createdAt: { $gte: today } }).toArray(),
        db.collection(C.sales).find({ createdAt: { $gte: weekStart } }, { projection: { createdAt: 1, weight: 1 } }).toArray(),
      ]);
      const limit = settings?.lowStockLimit ?? 20;

      const status = { Packed: 0, Shipped: 0, Sold: 0 };
      for (const b of bundles) status[b.status] = (status[b.status] ?? 0) + 1;

      /** Chart data for the dashboard. */
      // weight sold per day for the last 7 days (oldest first)
      const trend = Array.from({ length: 7 }, (_, i) => {
        const day = new Date(weekStart.getTime() + i * DAY);
        const weight = weekSales
          .filter(s => startOfDay(s.createdAt).getTime() === day.getTime())
          .reduce((n, s) => n + s.weight, 0);
        return { date: isoDate(day), label: day.toLocaleDateString('en-US', { weekday: 'short' }), weight: Math.round(weight * 100) / 100 };
      });

      res.json({
        kpis: {
          products,
          bundles: bundles.length,
          totalPieces: bundles.reduce((n, b) => n + b.pieces, 0),
          totalWeight: Math.round(bundles.reduce((n, b) => n + b.weight, 0) * 100) / 100,
        },
        status,
        lowStockLimit: limit,
        lowStock: bundles.filter(b => b.pieces > 0 && b.pieces < limit).map(withAvg),
        today: {
          packed: bundles.filter(b => b.packed === isoDate()).length,
          bills: new Set(recent.map(s => s.invoiceNo ?? s.billNo)).size,
          revenue: recent.reduce((n, s) => n + s.amount, 0),
        },
        soldBundles: bundles.filter(b => b.pieces === 0 || b.status === 'Sold').length,
        trend,
        recentBundles: bundles.slice(0, 5).map(withAvg),
      });
    },
  };
}
