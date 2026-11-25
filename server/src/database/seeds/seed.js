/** Purpose: loads the admin user and demo products, bundles, parties, sales and settings so the app is usable on a fresh database. */
import { COLLECTIONS as C } from '../collections.js';
import { ensureIndexes } from '../indexes.js';
import { hashPassword } from '../../services/auth.service.js';
import { DEFAULT_SETTINGS, SETTINGS_ID } from '../../models/settings.model.js';
import { DAY, isoDate } from '../../utils/dates.js';
import { products } from './data/products.js';
import { bundles } from './data/bundles.js';
import { customers, suppliers } from './data/parties.js';
import { sales } from './data/sales.js';
import { demoUsers } from './data/users.js';

/** Creates the admin user and demo data. `reset` wipes inventory collections first. */
export async function seed(db, { reset = false, adminEmail, adminPassword, seedDemoUsers = false, demoPassword, seedDemoData = true } = {}) {
  await ensureIndexes(db);
  if (reset) {
    await Promise.all([C.products, C.bundles, C.sales, C.customers, C.suppliers, C.counters, C.settings].map(c => db.collection(c).deleteMany({})));
  }

  const now = Date.now();
  const iso = d => isoDate(new Date(now - d * DAY));

  /** Create the admin account once ($setOnInsert never overwrites an existing password). */
  await db.collection(C.users).updateOne(
    { email: adminEmail.toLowerCase() },
    { $setOnInsert: { email: adminEmail.toLowerCase(), name: 'Nikhil Nikam', role: 'admin', passwordHash: await hashPassword(adminPassword), createdAt: new Date() } },
    { upsert: true },
  );

  /** Optional demo manager / accountant accounts for testing role permissions. */
  if (seedDemoUsers) {
    const passwordHash = await hashPassword(demoPassword);
    for (const u of demoUsers) {
      await db.collection(C.users).updateOne({ email: u.email }, { $setOnInsert: { ...u, passwordHash, createdAt: new Date() } }, { upsert: true });
    }
  }

  await db.collection(C.settings).updateOne({ _id: SETTINGS_ID }, { $setOnInsert: DEFAULT_SETTINGS }, { upsert: true });

  /** Skip the demo data in production, or when the database already has products. */
  if (!seedDemoData) return;
  if ((await db.collection(C.products).estimatedDocumentCount()) > 0) return; // already seeded

  await db.collection(C.products).insertMany(products.map(p => ({ ...p, createdAt: new Date(now) })));
  await db.collection(C.bundles).insertMany(bundles.map(([bundleId, dieNo, pieces, weight, ago, status, rack]) => ({
    bundleId, barcode: bundleId, dieNo, pieces, weight, packed: iso(ago), status, rack, createdAt: new Date(now - ago * DAY),
  })));
  await db.collection(C.customers).insertMany(customers);
  await db.collection(C.suppliers).insertMany(suppliers);
  await db.collection(C.sales).insertMany(sales.map(([n, ago, bundleId, dieNo, product, category, pcs, weight, customer, amount]) => ({
    billNo: `INV-${n}`, bundleId, dieNo, product, category, pcs, weight, customer, amount, createdAt: new Date(now - ago * DAY),
  })));
  await db.collection(C.counters).updateOne({ _id: 'bill' }, { $set: { seq: 1042 } }, { upsert: true });
}
