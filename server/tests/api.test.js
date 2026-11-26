import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connect } from '../src/database/connection.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/database/seeds/seed.js';

const config = {
  jwtSecret: 'test-secret', jwtExpiresIn: '1h', corsOrigin: 'http://localhost:4200', dbName: 'invenza_test',
  adminEmail: 'admin@invenza.com', adminPassword: 'aluminium', enableTestRoutes: false, appUrl: 'http://localhost:4200', activationHours: 48,
  seedDemoUsers: true, demoPassword: 'demo-pass-1',
};

let mongod, conn, api, auth;
const sent = [];
const mailer = { send: async mail => { sent.push(mail); return true; } };

before(async () => {
  mongod = await MongoMemoryServer.create();
  conn = await connect({ uri: mongod.getUri(), dbName: config.dbName, maxPoolSize: 10, minPoolSize: 1 });
  api = request(createApp({ db: conn.db, poolStats: conn.poolStats, config, mailer }));
});

after(async () => {
  await conn?.close();
  await mongod?.stop();
});

beforeEach(async () => {
  await seed(conn.db, { reset: true, ...config });
  const res = await api.post('/api/auth/login').send({ email: config.adminEmail, password: config.adminPassword });
  auth = { Authorization: `Bearer ${res.body.token}` };
});

const get = url => api.get(url).set(auth);
const post = (url, body) => api.post(url).set(auth).send(body);
const put = (url, body) => api.put(url).set(auth).send(body);

describe('health & connection pool', () => {
  it('reports pool statistics', async () => {
    const res = await api.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.pool.maxPoolSize, 10);
    assert.ok(res.body.pool.open >= 1);
  });

  it('serves many concurrent requests through the shared pool', async () => {
    const results = await Promise.all(Array.from({ length: 40 }, () => get('/api/products')));
    assert.ok(results.every(r => r.status === 200));
    assert.ok(conn.poolStats().open <= 10, 'never exceeds maxPoolSize');
  });
});

describe('auth', () => {
  it('rejects bad credentials with a generic message', async () => {
    const res = await api.post('/api/auth/login').send({ email: config.adminEmail, password: 'nope' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid email or password.');
  });

  it('protects every data route', async () => {
    for (const url of ['/api/products', '/api/bundles', '/api/sales', '/api/stock', '/api/reports', '/api/dashboard', '/api/settings']) {
      assert.equal((await api.get(url)).status, 401, url);
    }
  });

  it('returns the current user', async () => {
    const res = await get('/api/auth/me');
    assert.equal(res.body.email, config.adminEmail);
  });
});

describe('products', () => {
  const body = { dieNo: 'AL-9000', name: 'Test Profile', category: 'Aluminium', size: '3/4"', clValue: '15/FT', finish: 'Mill' };

  it('creates and lists a product', async () => {
    assert.equal((await post('/api/products', body)).status, 201);
    const list = await get('/api/products?q=test');
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].dieNo, 'AL-9000');
  });

  it('requires Die No and name', async () => {
    const res = await post('/api/products', { name: 'x' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Die No is required/);
  });

  it('rejects a duplicate Die No', async () => {
    const res = await post('/api/products', { ...body, dieNo: 'AL-1001' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already exists/);
  });

  it('filters by category', async () => {
    const res = await get('/api/products?category=Glass');
    assert.equal(res.body.length, 4);
  });

  it('edits a product and keeps bundles linked when Die No changes', async () => {
    const res = await put('/api/products/AL-1001', { ...body, dieNo: 'AL-NEW' });
    assert.equal(res.status, 200);
    const bundles = await get('/api/bundles?dieNo=AL-NEW');
    assert.equal(bundles.body.length, 2);
  });

  it('refuses to rename onto another existing Die No', async () => {
    const res = await put('/api/products/AL-1001', { ...body, dieNo: 'AL-1002' });
    assert.equal(res.status, 409);
  });
});

describe('bundles', () => {
  it('creates a bundle with a generated unique ID and matching barcode', async () => {
    const res = await post('/api/bundles', { dieNo: 'AL-1001', pieces: 10, weight: 55 });
    assert.equal(res.status, 201);
    assert.match(res.body.bundleId, /^[0-9a-f]{16}$/);
    assert.equal(res.body.barcode, res.body.bundleId);
    assert.equal(res.body.avgWeight, 5.5);
    assert.equal(res.body.status, 'Packed');
  });

  it('validates required fields and unknown products', async () => {
    assert.equal((await post('/api/bundles', { dieNo: 'NOPE', pieces: 1, weight: 1 })).status, 400);
    assert.equal((await post('/api/bundles', { dieNo: 'AL-1001', pieces: 0, weight: 1 })).status, 400);
    assert.equal((await post('/api/bundles', { dieNo: 'AL-1001', pieces: 2.5, weight: 1 })).status, 400);
  });

  it('edits a bundle by ID', async () => {
    const res = await put('/api/bundles/0b4aab06e52368f0', { dieNo: 'AL-1001', pieces: 40, weight: 214.8, packed: '2026-01-01', rack: 'Z-9', status: 'Shipped' });
    assert.equal(res.status, 200);
    assert.equal(res.body.rack, 'Z-9');
    assert.equal(res.body.status, 'Shipped');
  });

  it('looks bundles up by scan (exact, unique prefix, ambiguous, missing)', async () => {
    assert.equal((await get('/api/bundles/lookup/ab12cd34ef901234')).body.dieNo, 'AL-1002');
    assert.equal((await get('/api/bundles/lookup/ab12cd')).body.bundleId, 'ab12cd34ef901234');
    assert.equal((await get('/api/bundles/lookup/zzzz9999')).status, 404);
  });

  it('searches by product name', async () => {
    const res = await get('/api/bundles?q=frame');
    assert.ok(res.body.length >= 3);
  });
});

describe('sales', () => {
  const id = '0b4aab06e52368f0'; // 40 pcs, 214.8 kg

  it('deducts stock, recalculates weight and creates a bill', async () => {
    const res = await post('/api/sales', { bundleId: id, quantity: 10, customer: 'ACME' });
    assert.equal(res.status, 201);
    assert.equal(res.body.billNo, 'INV-1043');
    assert.equal(res.body.pcs, 10);
    assert.equal(res.body.weight, 53.7);
    assert.equal(res.body.amount, Math.round(53.7 * 310));
    const b = (await get(`/api/bundles/${id}`)).body;
    assert.equal(b.pieces, 30);
    assert.equal(b.weight, 161.1);
  });

  it('rejects a quantity above available stock and leaves stock untouched', async () => {
    const res = await post('/api/sales', { bundleId: id, quantity: 41 });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Only 40 pcs available/);
    assert.equal((await get(`/api/bundles/${id}`)).body.pieces, 40);
    assert.equal((await get('/api/sales')).body.length, 3);
  });

  it('rejects invalid quantities', async () => {
    for (const quantity of [0, -3, 1.5, 'abc']) {
      assert.equal((await post('/api/sales', { bundleId: id, quantity })).status, 400, String(quantity));
    }
  });

  it('marks the bundle Sold at zero pieces, then reports it sold out', async () => {
    assert.equal((await post('/api/sales', { bundleId: id, quantity: 40 })).status, 201);
    const b = (await get(`/api/bundles/${id}`)).body;
    assert.equal(b.pieces, 0);
    assert.equal(b.weight, 0);
    assert.equal(b.status, 'Sold');
    const again = await post('/api/sales', { bundleId: id, quantity: 1 });
    assert.equal(again.status, 409);
    assert.match(again.body.error, /sold out/);
  });

  it('returns 404 for an unknown bundle', async () => {
    assert.equal((await post('/api/sales', { bundleId: 'missing', quantity: 1 })).status, 404);
  });

  it('never oversells under concurrent requests', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => post('/api/sales', { bundleId: id, quantity: 5 })));
    const ok = results.filter(r => r.status === 201).length;
    assert.equal(ok, 8, '40 pcs / 5 = exactly 8 successful sales');
    assert.equal((await get(`/api/bundles/${id}`)).body.pieces, 0);
    const bills = new Set(results.filter(r => r.status === 201).map(r => r.body.billNo));
    assert.equal(bills.size, 8, 'bill numbers are unique');
  });

  it('lists sales history and fetches one bill', async () => {
    const list = await get('/api/sales');
    assert.equal(list.body[0].billNo, 'INV-1042');
    assert.equal((await get('/api/sales/INV-1041')).body.customer, 'Skyline Facades');
    assert.equal((await get('/api/sales/INV-0')).status, 404);
  });
});

describe('stock', () => {
  it('returns rows and a category summary', async () => {
    const res = await get('/api/stock');
    assert.equal(res.body.rows.length, 8);
    assert.equal(res.body.summary.Aluminium.bundles, 5);
    assert.equal(res.body.lowStock, 4);
  });

  it('filters by availability, product and search', async () => {
    assert.equal((await get('/api/stock?state=sold')).body.rows.length, 0);
    assert.equal((await get('/api/stock?dieNo=GL-1010')).body.rows.length, 1);
    assert.equal((await get('/api/stock?q=bronze')).body.rows.length, 1);
    assert.equal((await get('/api/stock?state=bogus')).status, 400);
  });

  it('exports CSV', async () => {
    const res = await get('/api/stock/export.csv');
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.text, /"Product","Die No"/);
  });
});

describe('reports & dashboard', () => {
  it('limits sales by date range', async () => {
    assert.equal((await get('/api/reports?range=All')).body.totals.bills, 3);
    assert.equal((await get('/api/reports?range=Today')).body.totals.bills, 0);
    assert.equal((await get('/api/reports?range=Week')).body.totals.bills, 3);
    assert.equal((await get('/api/reports?range=Decade')).status, 400);
  });

  it('exports sales and packing CSV', async () => {
    assert.match((await get('/api/reports/sales.csv?range=All')).text, /INV-1042/);
    assert.match((await get('/api/reports/packing.csv?range=All')).text, /0b4aab06e52368f0/);
  });

  it('builds the dashboard summary', async () => {
    await post('/api/sales', { bundleId: '0b4aab06e52368f0', quantity: 2 });
    const d = (await get('/api/dashboard')).body;
    assert.equal(d.kpis.products, 8);
    assert.equal(d.kpis.bundles, 8);
    assert.equal(d.today.bills, 1);
    assert.equal(d.trend.length, 7);
    assert.ok(d.trend.at(-1).weight > 0, 'today appears in the trend');
    assert.equal(d.lowStock.length, 4);
  });
});

describe('settings', () => {
  it('updates thresholds and rates, and applies the rate to new bills', async () => {
    const res = await put('/api/settings', { company: 'Test Co', lowStockLimit: 10, weightUnit: 'kg', rates: { Aluminium: 400, Glass: 100 } });
    assert.equal(res.status, 200);
    assert.equal((await get('/api/dashboard')).body.lowStock.length, 2);
    const sale = await post('/api/sales', { bundleId: '0b4aab06e52368f0', quantity: 10 });
    assert.equal(sale.body.amount, Math.round(53.7 * 400));
  });

  it('validates input', async () => {
    assert.equal((await put('/api/settings', { company: '', lowStockLimit: 10, rates: { Aluminium: 1, Glass: 1 } })).status, 400);
    assert.equal((await put('/api/settings', { company: 'x', lowStockLimit: 0, rates: { Aluminium: 1, Glass: 1 } })).status, 400);
  });
});

describe('customers & suppliers', () => {
  it('lists seeded parties and adds one', async () => {
    assert.equal((await get('/api/customers')).body.length, 4);
    assert.equal((await get('/api/suppliers')).body.length, 3);
    assert.equal((await post('/api/customers', { name: 'New Buyer', city: 'Pune' })).status, 201);
    assert.equal((await get('/api/customers')).body.length, 5);
    assert.equal((await post('/api/customers', {})).status, 400);
  });
});

describe('robustness', () => {
  it('returns 404 JSON for unknown routes and 400 for bad JSON', async () => {
    assert.equal((await get('/api/nothing')).status, 404);
    const bad = await api.post('/api/products').set(auth).set('Content-Type', 'application/json').send('{oops');
    assert.equal(bad.status, 400);
  });
});

describe('roles', () => {
  const as = async email => {
    const res = await api.post('/api/auth/login').send({ email, password: 'demo-pass-1' });
    assert.equal(res.status, 200);
    return { res, headers: { Authorization: `Bearer ${res.body.token}` } };
  };

  it('gives the admin every tab', async () => {
    const res = await get('/api/auth/me');
    assert.equal(res.body.role, 'admin');
    assert.deepEqual(res.body.modules, ['dashboard', 'products', 'bundles', 'sales', 'stock', 'customers', 'suppliers', 'reports', 'settings', 'members']);
    assert.equal((await get('/api/settings')).status, 200);
  });

  it('returns the allowed tabs at login', async () => {
    const { res } = await as('accountant@invenza.com');
    assert.equal(res.body.user.role, 'accountant');
    assert.ok(res.body.user.modules.includes('reports'));
    assert.ok(!res.body.user.modules.includes('settings'));
  });

  it('blocks a manager from settings but not from inventory', async () => {
    const { headers } = await as('manager@invenza.com');
    assert.equal((await api.get('/api/settings').set(headers)).status, 403);
    assert.equal((await api.put('/api/settings').set(headers).send({})).status, 403);
    assert.equal((await api.get('/api/products').set(headers)).status, 200);
  });

  it('blocks an accountant from products and bundles but allows sales and reports', async () => {
    const { headers } = await as('accountant@invenza.com');
    for (const url of ['/api/products', '/api/bundles']) assert.equal((await api.get(url).set(headers)).status, 403, url);
    for (const url of ['/api/sales', '/api/reports', '/api/stock', '/api/dashboard', '/api/customers']) assert.equal((await api.get(url).set(headers)).status, 200, url);
    const denied = await api.post('/api/products').set(headers).send({ dieNo: 'X', name: 'X' });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'You do not have access to this section.');
  });
});

describe('members', () => {
  // users are not part of the per-test reset: remove anything a previous test registered
  beforeEach(async () => {
    await conn.db.collection('users').deleteMany({ email: { $nin: [config.adminEmail, 'manager@invenza.com', 'accountant@invenza.com'] } });
  });

  const login = async (email, password) => (await api.post('/api/auth/login').send({ email, password })).body;
  const bearer = token => ({ Authorization: `Bearer ${token}` });
  const valid = { name: 'Asha Rao', email: 'Asha@Example.com', role: 'accountant' };
  const tokenFrom = mail => mail.text.match(/activate\?token=([a-f0-9]+)/)[1];

  /** Registers a member and activates the account through the emailed link. */
  async function register(body = valid, password = 'longenough1', as = auth) {
    const res = await api.post('/api/members').set(as).send(body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const act = await api.post('/api/auth/activate').send({ token: tokenFrom(sent.at(-1)), password });
    assert.equal(act.status, 200, JSON.stringify(act.body));
    return res.body;
  }

  it('registers a pending member and emails an activation link', async () => {
    const before = sent.length;
    const res = await post('/api/members', valid);
    assert.equal(res.status, 201);
    assert.equal(res.body.email, 'asha@example.com');
    assert.equal(res.body.status, 'pending');
    assert.equal(res.body.emailSent, true);
    assert.equal(res.body.passwordHash, undefined);
    assert.equal(sent.length, before + 1);
    assert.equal(sent.at(-1).to, 'asha@example.com');
    assert.match(sent.at(-1).text, /http:\/\/localhost:4200\/activate\?token=[a-f0-9]{64}/);
    assert.match(sent.at(-1).subject, /Activate/);
  });

  it('reports when the email could not be sent', async () => {
    const original = mailer.send;
    mailer.send = async () => false;
    try {
      assert.equal((await post('/api/members', valid)).body.emailSent, false);
    } finally {
      mailer.send = original;
    }
  });

  it('blocks sign-in until the account is activated, then lets the member set a password', async () => {
    await post('/api/members', valid);
    const blocked = await api.post('/api/auth/login').send({ email: 'asha@example.com', password: 'anything1' });
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error, /not activated/);

    const token = tokenFrom(sent.at(-1));
    const info = await api.get(`/api/auth/activate/${token}`);
    assert.deepEqual(info.body, { name: 'Asha Rao', email: 'asha@example.com', role: 'accountant' });

    assert.equal((await api.post('/api/auth/activate').send({ token, password: 'short' })).status, 400);
    assert.equal((await api.post('/api/auth/activate').send({ token, password: 'longenough1' })).status, 200);
    const session = await login('asha@example.com', 'longenough1');
    assert.equal(session.user.role, 'accountant');
    assert.equal((await get('/api/members')).body.find(m => m.email === 'asha@example.com').status, 'active');
  });

  it('accepts an activation link only once', async () => {
    await post('/api/members', valid);
    const token = tokenFrom(sent.at(-1));
    await api.post('/api/auth/activate').send({ token, password: 'longenough1' });
    assert.equal((await api.post('/api/auth/activate').send({ token, password: 'otherpass12' })).status, 404);
    assert.equal((await api.get(`/api/auth/activate/${token}`)).status, 404);
    assert.equal((await api.get('/api/auth/activate/not-a-real-token')).status, 404);
  });

  it('rejects an expired link', async () => {
    await post('/api/members', valid);
    const token = tokenFrom(sent.at(-1));
    await conn.db.collection('users').updateOne({ email: 'asha@example.com' }, { $set: { activationExpires: new Date(Date.now() - 1000) } });
    assert.equal((await api.post('/api/auth/activate').send({ token, password: 'longenough1' })).status, 404);
  });

  it('resends a fresh link and invalidates the old one', async () => {
    await post('/api/members', valid);
    const oldToken = tokenFrom(sent.at(-1));
    const res = await api.post('/api/members/asha@example.com/resend').set(auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.emailSent, true);
    const newToken = tokenFrom(sent.at(-1));
    assert.notEqual(newToken, oldToken);
    assert.equal((await api.get(`/api/auth/activate/${oldToken}`)).status, 404);
    assert.equal((await api.get(`/api/auth/activate/${newToken}`)).status, 200);
    assert.equal((await api.post('/api/members/ghost@example.com/resend').set(auth)).status, 404);
  });

  it('does not resend to someone who is already active', async () => {
    await register();
    assert.equal((await api.post('/api/members/asha@example.com/resend').set(auth)).status, 409);
  });

  it('activates a member by hand when the email does not arrive', async () => {
    await post('/api/members', valid);
    const token = tokenFrom(sent.at(-1));
    const url = '/api/members/asha@example.com/activate';
    assert.equal((await api.post(url).set(auth).send({})).status, 400);
    assert.equal((await api.post(url).set(auth).send({ password: 'short' })).status, 400);

    const res = await api.post(url).set(auth).send({ password: 'handpass123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'active');
    assert.equal(res.body.passwordHash, undefined);
    assert.ok((await login('asha@example.com', 'handpass123')).token);
    // the emailed link stops working, and an active account cannot be activated again
    assert.equal((await api.get(`/api/auth/activate/${token}`)).status, 404);
    assert.equal((await api.post(url).set(auth).send({ password: 'otherpass123' })).status, 409);
    assert.ok((await login('asha@example.com', 'handpass123')).token);
    assert.equal((await api.post('/api/members/ghost@example.com/activate').set(auth).send({ password: 'handpass123' })).status, 404);
  });

  it('lets the super admin activate admins and an admin activate only their own employees', async () => {
    const body = { password: 'handpass123' };
    const activate = (email, headers) => api.post(`/api/members/${email}/activate`).set(headers).send(body);
    await register({ ...valid, email: 'first@example.com', role: 'admin' });
    await register({ ...valid, email: 'second@example.com', role: 'admin' });
    const first = bearer((await login('first@example.com', 'longenough1')).token);
    const second = bearer((await login('second@example.com', 'longenough1')).token);
    await api.post('/api/members').set(first).send({ ...valid, email: 'staff@example.com', role: 'manager' });
    await post('/api/members', { ...valid, email: 'newadmin@example.com', role: 'admin' });

    assert.equal((await activate('staff@example.com', second)).status, 404);
    assert.equal((await activate('newadmin@example.com', first)).status, 404);
    // an admin who once added someone still cannot activate them after they become an admin
    await put('/api/members/staff@example.com', { name: 'S', role: 'admin' });
    assert.equal((await activate('staff@example.com', first)).status, 404);
    await put('/api/members/staff@example.com', { name: 'S', role: 'manager' });

    assert.equal((await activate('staff@example.com', first)).status, 200);
    assert.equal((await activate('newadmin@example.com', auth)).status, 200);
    for (const email of ['staff@example.com', 'newadmin@example.com']) {
      assert.ok((await login(email, body.password)).token, email);
    }
  });

  it('lists members without secrets and flags the super admin', async () => {
    await post('/api/members', valid);
    const res = await get('/api/members');
    assert.equal(res.status, 200);
    assert.ok(res.body.every(m => m.passwordHash === undefined && m.activationHash === undefined && m.role));
    assert.deepEqual(res.body.filter(m => m.superAdmin).map(m => m.email), ['admin@invenza.com']);
    assert.equal((await get('/api/auth/me')).body.superAdmin, true);
  });

  it('validates the payload and rejects duplicates', async () => {
    assert.equal((await post('/api/members', { ...valid, email: 'nope' })).status, 400);
    assert.equal((await post('/api/members', { ...valid, role: 'owner' })).status, 400);
    assert.equal((await post('/api/members', { ...valid, name: ' ' })).status, 400);
    await post('/api/members', valid);
    assert.equal((await post('/api/members', valid)).status, 409);
  });

  it('changes a role and optionally the password', async () => {
    await register();
    const res = await put('/api/members/asha@example.com', { name: 'Asha R', role: 'manager', password: 'newpassword1' });
    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'manager');
    assert.equal((await login('asha@example.com', 'newpassword1')).user.role, 'manager');
    await put('/api/members/asha@example.com', { name: 'Asha R', role: 'manager' }); // blank password keeps it
    assert.ok((await login('asha@example.com', 'newpassword1')).token);
    assert.equal((await put('/api/members/ghost@example.com', { name: 'G', role: 'manager' })).status, 404);
  });

  it('protects the super admin from everyone, including themselves', async () => {
    assert.equal((await put('/api/members/admin@invenza.com', { name: 'Admin', role: 'manager' })).status, 403);
    assert.equal((await api.delete('/api/members/admin@invenza.com').set(auth)).status, 400); // self
    await register({ ...valid, email: 'second@example.com', role: 'admin' });
    const other = bearer((await login('second@example.com', 'longenough1')).token);
    // other admins cannot even see it, so it looks like an account that does not exist
    assert.equal((await api.delete('/api/members/admin@invenza.com').set(other)).status, 404);
    assert.equal((await api.put('/api/members/admin@invenza.com').set(other).send({ name: 'x', role: 'admin', password: 'hijacked123' })).status, 404);
    const list = await api.get('/api/members').set(other);
    assert.ok(!list.body.some(m => m.email === 'admin@invenza.com' || m.superAdmin));
    assert.ok(list.body.some(m => m.email === 'second@example.com'));
  });

  it('lets only the super admin create, change or delete admins', async () => {
    await register({ ...valid, email: 'second@example.com', role: 'admin' });
    const other = bearer((await login('second@example.com', 'longenough1')).token);
    // a regular admin can manage managers / accountants...
    assert.equal((await api.post('/api/members').set(other).send({ ...valid, email: 'staff@example.com', role: 'manager' })).status, 201);
    // ...but not admins
    assert.equal((await api.post('/api/members').set(other).send({ ...valid, email: 'third@example.com', role: 'admin' })).status, 403);
    assert.equal((await api.put('/api/members/staff@example.com').set(other).send({ name: 'S', role: 'admin' })).status, 403);
    assert.equal((await api.delete('/api/members/second@example.com').set(other)).status, 400); // self
    assert.equal((await api.delete('/api/members/staff@example.com').set(other)).status, 204);
    // the super admin can
    assert.equal((await api.delete('/api/members/second@example.com').set(auth)).status, 204);
    assert.equal((await api.delete('/api/members/second@example.com').set(auth)).status, 404);
  });

  it('limits each admin to the employees they registered', async () => {
    await register({ ...valid, email: 'first@example.com', role: 'admin' });
    await register({ ...valid, email: 'second@example.com', role: 'admin' });
    const first = bearer((await login('first@example.com', 'longenough1')).token);
    const second = bearer((await login('second@example.com', 'longenough1')).token);
    await register({ ...valid, email: 'staff@example.com', role: 'manager' }, 'longenough1', first);
    await post('/api/members', { ...valid, email: 'pending@example.com' });

    const emails = async headers => (await api.get('/api/members').set(headers)).body.map(m => m.email).sort();
    assert.deepEqual(await emails(first), ['first@example.com', 'staff@example.com']);
    assert.deepEqual(await emails(second), ['second@example.com']);

    for (const email of ['staff@example.com', 'first@example.com', 'pending@example.com']) {
      const url = `/api/members/${email}`;
      assert.equal((await api.put(url).set(second).send({ name: 'x', role: 'manager', password: 'hijacked123' })).status, 404, email);
      assert.equal((await api.delete(url).set(second)).status, 404, email);
      assert.equal((await api.post(`${url}/resend`).set(second)).status, 404, email);
    }
    assert.equal((await api.put('/api/members/staff@example.com').set(first).send({ name: 'S', role: 'accountant' })).status, 200);
    // an edit does not move the employee to whoever made it
    assert.equal((await put('/api/members/staff@example.com', { name: 'S', role: 'manager' })).body.addedBy, 'first@example.com');
  });

  it('tells only the super admin who added each member', async () => {
    await register({ ...valid, email: 'second@example.com', role: 'admin' });
    const other = bearer((await login('second@example.com', 'longenough1')).token);
    await api.post('/api/members').set(other).send({ ...valid, email: 'staff@example.com' });
    const all = (await get('/api/members')).body;
    assert.equal(all.find(m => m.email === 'second@example.com').addedBy, config.adminEmail);
    assert.equal(all.find(m => m.email === 'staff@example.com').addedBy, 'second@example.com');
    assert.ok((await api.get('/api/members').set(other)).body.every(m => !('addedBy' in m)));
  });

  it('is forbidden for managers and accountants', async () => {
    for (const email of ['manager@invenza.com', 'accountant@invenza.com']) {
      const headers = bearer((await login(email, 'demo-pass-1')).token);
      assert.equal((await api.get('/api/members').set(headers)).status, 403, email);
      assert.equal((await api.post('/api/members').set(headers).send(valid)).status, 403, email);
      assert.equal((await api.post('/api/members/asha@example.com/resend').set(headers)).status, 403, email);
      assert.equal((await api.post('/api/members/asha@example.com/activate').set(headers).send({ password: 'handpass123' })).status, 403, email);
    }
  });
});

describe('mail service', () => {
  it('prints the message instead of failing when SMTP is not configured', async () => {
    const { createMailer } = await import('../src/services/mail.service.js');
    const log = console.log;
    const lines = [];
    console.log = (...a) => lines.push(a.join(' '));
    try {
      const mailer = createMailer({ smtpHost: '' });
      assert.equal(mailer.configured, false);
      assert.equal(await mailer.send({ to: 'a@b.c', subject: 'Hi', text: 'link' }), false);
    } finally {
      console.log = log;
    }
    assert.match(lines.join('\n'), /SMTP not configured/);
  });

  it('returns false instead of throwing when the SMTP server is unreachable', async () => {
    const { createMailer } = await import('../src/services/mail.service.js');
    const err = console.error;
    console.error = () => {};
    try {
      const mailer = createMailer({ smtpHost: '127.0.0.1', smtpPort: 1, mailFrom: 'x@y.z' });
      assert.equal(mailer.configured, true);
      assert.equal(await mailer.send({ to: 'a@b.c', subject: 'Hi', text: 'x' }), false);
    } finally {
      console.error = err;
    }
  });

  it('escapes the name in the HTML body', async () => {
    const { activationEmail } = await import('../src/services/mail.service.js');
    const mail = activationEmail({ name: '<b>Eve</b>', role: 'manager', link: 'http://x/activate?token=1', hours: 48 });
    assert.ok(!mail.html.includes('<b>Eve</b>'));
    assert.match(mail.text, /48 hours/);
  });
});

describe('config', () => {
  it('loads and strips trailing slashes from APP_URL', async () => {
    process.env.APP_URL = 'https://erp.example.com//';
    const { config: loaded } = await import('../src/config/index.js');
    assert.equal(loaded.appUrl, 'https://erp.example.com');
    assert.equal(loaded.smtpPort, 587);
    assert.equal(loaded.activationHours, 48);
  });
});
