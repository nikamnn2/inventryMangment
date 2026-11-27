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
  it('creates a bundle with the next numeric ID and matching barcode', async () => {
    const res = await post('/api/bundles', { dieNo: 'AL-1001', pieces: 10, weight: 55 });
    assert.equal(res.status, 201);
    assert.equal(res.body.bundleId, '1001');
    assert.equal(res.body.barcode, res.body.bundleId);
    assert.equal(res.body.avgWeight, 5.5);
    assert.equal(res.body.status, 'Packed');
  });

  it('numbers bundles in order, with no repeats or gaps when saved together or after a rejected save', async () => {
    const body = { dieNo: 'AL-1001', pieces: 1, weight: 1 };
    const saved = await Promise.all(Array.from({ length: 10 }, () => post('/api/bundles', body)));
    assert.deepEqual(saved.map(r => r.body.bundleId).sort(), Array.from({ length: 10 }, (_, i) => String(1001 + i)));
    assert.equal((await post('/api/bundles', { ...body, dieNo: 'NOPE' })).status, 400);
    assert.equal((await post('/api/bundles', body)).body.bundleId, '1011');
  });

  it('does not open a longer bundle number from a partial numeric scan', async () => {
    await post('/api/bundles', { dieNo: 'AL-1001', pieces: 1, weight: 1 });
    assert.equal((await get('/api/bundles/lookup/1001')).body.bundleId, '1001');
    assert.equal((await get('/api/bundles/lookup/100')).status, 404);
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

  it('blocks an accountant from products, bundles and sales but allows reports', async () => {
    const { headers } = await as('accountant@invenza.com');
    for (const url of ['/api/products', '/api/bundles', '/api/sales']) assert.equal((await api.get(url).set(headers)).status, 403, url);
    for (const url of ['/api/reports', '/api/stock', '/api/dashboard', '/api/customers']) assert.equal((await api.get(url).set(headers)).status, 200, url);
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

    assert.equal((await activate('staff@example.com', second)).status, 403);
    assert.equal((await activate('newadmin@example.com', first)).status, 403);
    // an admin who once added someone still cannot activate them after they become an admin
    await put('/api/members/staff@example.com', { name: 'S', role: 'admin' });
    assert.equal((await activate('staff@example.com', first)).status, 403);
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

  it('lets each admin see everyone but the super admin, and change only the employees they registered', async () => {
    await register({ ...valid, email: 'first@example.com', role: 'admin' });
    await register({ ...valid, email: 'second@example.com', role: 'admin' });
    const first = bearer((await login('first@example.com', 'longenough1')).token);
    const second = bearer((await login('second@example.com', 'longenough1')).token);
    await register({ ...valid, email: 'staff@example.com', role: 'manager' }, 'longenough1', first);
    await post('/api/members', { ...valid, email: 'pending@example.com' });

    const emails = async headers => (await api.get('/api/members').set(headers)).body.map(m => m.email).sort();
    const everyone = ['accountant@invenza.com', 'first@example.com', 'manager@invenza.com', 'pending@example.com', 'second@example.com', 'staff@example.com'];
    assert.deepEqual(await emails(first), everyone);
    assert.deepEqual(await emails(second), everyone);
    const changeable = async headers => (await api.get('/api/members').set(headers)).body.filter(m => m.manageable).map(m => m.email).sort();
    assert.deepEqual(await changeable(first), ['first@example.com', 'staff@example.com']);
    assert.deepEqual(await changeable(second), ['second@example.com']);
    assert.equal((await api.post('/api/members/pending@example.com/activate').set(second).send({ password: 'hijacked123' })).status, 403);

    for (const email of ['staff@example.com', 'first@example.com', 'pending@example.com']) {
      const url = `/api/members/${email}`;
      assert.equal((await api.put(url).set(second).send({ name: 'x', role: 'manager', password: 'hijacked123' })).status, 403, email);
      assert.equal((await api.delete(url).set(second)).status, 403, email);
      assert.equal((await api.post(`${url}/resend`).set(second)).status, 403, email);
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

describe('security', () => {
  /** A fresh app, so failed-attempt counts do not carry over between tests. */
  const freshApp = (extra = {}) => request(createApp({ db: conn.db, config: { ...config, ...extra }, mailer }));
  const signIn = (app, password, email = config.adminEmail) => app.post('/api/auth/login').send({ email, password });

  it('blocks password guessing after five failures, even with the right password', async () => {
    const app = freshApp();
    for (let i = 0; i < 5; i++) assert.equal((await signIn(app, `wrong-${i}`)).status, 401);
    const blocked = await signIn(app, config.adminPassword);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal(blocked.body.token, undefined);
  });

  it('limits parallel guesses too', async () => {
    const app = freshApp();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => signIn(app, `wrong-${i}`)));
    assert.equal(results.filter(r => r.status === 401).length, 5);
  });

  it('limits one account across many addresses when behind a proxy', async () => {
    const app = freshApp({ trustProxy: 1 });
    const statuses = [];
    for (let i = 0; i < 32; i++) statuses.push((await signIn(app, 'wrong').set('X-Forwarded-For', `10.0.0.${i}`)).status);
    assert.equal(statuses.filter(s => s === 401).length, 30);
  });

  it('does not count successful sign-ins', async () => {
    const app = freshApp();
    for (let i = 0; i < 8; i++) assert.equal((await signIn(app, config.adminPassword)).status, 200);
  });

  it('limits guessing of activation links', async () => {
    const app = freshApp();
    for (let i = 0; i < 20; i++) assert.equal((await app.get(`/api/auth/activate/guess-${i}`)).status, 404);
    assert.equal((await app.get('/api/auth/activate/one-more')).status, 429);
  });

  it('signs a member out at once when their role changes, password changes or they are removed', async () => {
    const email = 'revoke@example.com';
    await conn.db.collection('users').deleteMany({ email });
    await post('/api/members', { name: 'R', email, role: 'manager' });
    await post(`/api/members/${email}/activate`, { password: 'first-pass-123' });
    const tokenFor = async password => ({ Authorization: `Bearer ${(await signIn(api, password, email)).body.token}` });

    const session = await tokenFor('first-pass-123');
    assert.equal((await api.get('/api/products').set(session)).status, 200);
    await put(`/api/members/${email}`, { name: 'R', role: 'accountant' });
    assert.equal((await api.get('/api/products').set(session)).status, 403); // new role applies immediately

    await put(`/api/members/${email}`, { name: 'R', role: 'accountant', password: 'second-pass-123' });
    assert.equal((await api.get('/api/sales').set(session)).status, 401);
    assert.equal((await api.get('/api/auth/me').set(session)).status, 401);

    const renewed = await tokenFor('second-pass-123');
    await api.delete(`/api/members/${email}`).set(auth);
    assert.equal((await api.get('/api/sales').set(renewed)).status, 401);
  });

  it('refuses well-known passwords', async () => {
    const email = 'weak@example.com';
    await conn.db.collection('users').deleteMany({ email });
    await post('/api/members', { name: 'W', email, role: 'manager' });
    const res = await post(`/api/members/${email}/activate`, { password: 'Aluminium' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /too common/);
  });

  it('ignores database operators sent in place of the email or password', async () => {
    const res = await freshApp().post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    assert.equal(res.status, 400);
  });

  it('keeps health details private in production', async () => {
    assert.deepEqual((await freshApp({ isProduction: true }).get('/api/health')).body, { status: 'ok' });
  });

  it('stops customer names from running as formulas in the sales export', async () => {
    const bundle = (await get('/api/bundles')).body.find(b => b.pieces > 0);
    await post('/api/sales', { bundleId: bundle.bundleId, quantity: 1, customer: '=HYPERLINK("http://evil.test")' });
    const csv = (await get('/api/reports/sales.csv')).text;
    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.test"")"`));
  });
});

describe('keep me signed in', () => {
  const lifetimeHours = token => {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    return (claims.exp - claims.iat) / 3600;
  };

  it('gives a longer sign-in only when asked for', async () => {
    const body = { email: config.adminEmail, password: config.adminPassword };
    assert.equal(lifetimeHours((await api.post('/api/auth/login').send(body)).body.token), 1);
    assert.equal(lifetimeHours((await api.post('/api/auth/login').send({ ...body, remember: 'yes' })).body.token), 1);
    assert.equal(lifetimeHours((await api.post('/api/auth/login').send({ ...body, remember: true })).body.token), 30 * 24);
  });
});

describe('forgotten password', () => {
  const email = 'manager@invenza.com';
  let app; // a new app for each test, so the request limits start from zero
  beforeEach(async () => {
    // fresh demo accounts, so a password changed by one test does not affect the next
    await conn.db.collection('users').deleteMany({ email: { $ne: config.adminEmail } });
    await seed(conn.db, { ...config });
    app = request(createApp({ db: conn.db, poolStats: conn.poolStats, config, mailer }));
  });

  const forgot = async (who = email) => (await app.post('/api/auth/forgot').send({ email: who })).body;
  const status = async (token, who = email) => (await app.post('/api/auth/forgot/status').send({ email: who, token })).body.status;
  const reset = (token, password = 'brand-new-pass', who = email) => app.post('/api/auth/forgot/reset').send({ email: who, token, password });
  const approve = (code, headers = auth, who = email) => app.post(`/api/members/${who}/reset/approve`).set(headers).send({ code });
  const signIn = (password, who = email) => app.post('/api/auth/login').send({ email: who, password });
  const member = async (who = email) => (await app.get('/api/members').set(auth)).body.find(m => m.email === who);

  it('works only after approval, only from the asking device, and only once', async () => {
    const oldSession = { Authorization: `Bearer ${(await signIn('demo-pass-1')).body.token}` };
    const before = sent.length;
    const { token, code } = await forgot();
    assert.match(code, /^\d{6}$/);
    await new Promise(r => setTimeout(r, 100));
    const notice = sent.slice(before).find(m => m.to === config.adminEmail);
    assert.match(notice.subject, /password reset request/);
    assert.ok(!notice.text.includes(code), 'the code is not emailed: the admin must ask the person');

    const listed = await member();
    assert.deepEqual([listed.passwordReset.status, listed.passwordReset.code], ['requested', code]);
    assert.ok(!JSON.stringify(listed).includes('tokenHash'));
    assert.equal(await status(token), 'waiting');
    assert.equal((await reset(token)).status, 403);

    assert.equal((await approve('000000' === code ? '111111' : '000000')).status, 409);
    assert.equal((await approve(code)).status, 200);
    assert.equal(await status(token), 'approved');
    // knowing the email is not enough: another device has no valid token
    assert.equal(await status('f'.repeat(64)), 'none');
    assert.equal((await reset('f'.repeat(64))).status, 403);
    assert.equal((await reset('')).status, 403);
    assert.equal((await reset(token, 'short')).status, 400);

    assert.equal((await reset(token)).status, 200);
    assert.equal((await signIn('brand-new-pass')).status, 200);
    assert.equal((await signIn('demo-pass-1')).status, 401);
    assert.equal((await app.get('/api/products').set(oldSession)).status, 401);
    assert.equal((await reset(token, 'another-pass-1')).status, 403);
    assert.equal((await member()).passwordReset, undefined);
  });

  it('does not approve an older code after a newer request, and expires', async () => {
    const first = await forgot();
    const second = await forgot();
    if (first.code !== second.code) assert.equal((await approve(first.code)).status, 409);
    assert.equal((await approve(second.code)).status, 200);
    assert.equal(await status(first.token), 'none');
    await conn.db.collection('users').updateOne({ email }, { $set: { 'resetRequest.expires': new Date(Date.now() - 1000) } });
    assert.equal(await status(second.token), 'none');
    assert.equal((await reset(second.token)).status, 403);
    assert.equal((await member()).passwordReset, undefined);
  });

  it('can be rejected, and is dropped when the old password is used again', async () => {
    const a = await forgot();
    assert.equal((await app.post(`/api/members/${email}/reset/reject`).set(auth)).status, 204);
    assert.equal(await status(a.token), 'none');
    const b = await forgot();
    assert.equal((await signIn('demo-pass-1')).status, 200);
    assert.equal(await status(b.token), 'none');
  });

  it('answers the same for unknown accounts and stores nothing for the super admin', async () => {
    for (const who of ['nobody@example.com', config.adminEmail]) {
      const res = await app.post('/api/auth/forgot').send({ email: who });
      assert.equal(res.status, 200, who);
      assert.deepEqual(Object.keys(res.body).sort(), ['code', 'token']);
      assert.equal(await status(res.body.token, who), 'none');
    }
  });

  it('lets only the right admin decide', async () => {
    const body = { password: 'longenough1' };
    for (const who of ['first@example.com', 'second@example.com']) {
      await app.post('/api/members').set(auth).send({ name: who, email: who, role: 'admin' });
      await app.post(`/api/members/${who}/activate`).set(auth).send(body);
    }
    const bearer = async who => ({ Authorization: `Bearer ${(await signIn(body.password, who)).body.token}` });
    const first = await bearer('first@example.com');
    const second = await bearer('second@example.com');
    await app.post('/api/members').set(first).send({ name: 'S', email: 'staff@example.com', role: 'manager' });
    await app.post('/api/members/staff@example.com/activate').set(first).send(body);

    const staff = await forgot('staff@example.com');
    assert.equal((await approve(staff.code, second, 'staff@example.com')).status, 403);
    const adminRequest = await forgot('first@example.com');
    assert.equal((await approve(adminRequest.code, first, 'first@example.com')).status, 403, 'not your own');
    assert.equal((await approve(adminRequest.code, second, 'first@example.com')).status, 403);
    const manager = { Authorization: `Bearer ${(await signIn('demo-pass-1')).body.token}` };
    assert.equal((await approve(staff.code, manager, 'staff@example.com')).status, 403);
    assert.equal((await approve(staff.code, first, 'staff@example.com')).status, 200);
    assert.equal((await approve(adminRequest.code, auth, 'first@example.com')).status, 200);
  });

  it('limits how often a reset can be asked for', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await app.post('/api/auth/forgot').send({ email })).status, 200);
    const res = await app.post('/api/auth/forgot').send({ email });
    assert.equal(res.status, 429);
    assert.match(res.body.error, /Too many requests/);
  });
});

describe('sales invoices', () => {
  const customer = { name: 'Ganesh Landge', contact: '9860470406', email: 'G@Example.com' };
  const IDS = { a: '90001', b: '90002', c: '90003' };
  let seller; // a sales department user

  beforeEach(async () => {
    const users = conn.db.collection('users');
    await users.deleteMany({ email: { $ne: config.adminEmail } });
    await seed(conn.db, { ...config });
    const { passwordHash } = await users.findOne({ email: 'manager@invenza.com' });
    await users.insertOne({ email: 'sales@invenza.com', name: 'Sales Person', role: 'sales', status: 'active', passwordHash });
    seller = await bearer('sales@invenza.com');
    await conn.db.collection('bundles').insertMany([[IDS.a, 22.54, 10], [IDS.b, 26.8, 10], [IDS.c, 19.78, 16]].map(([bundleId, weight, pieces]) => ({
      bundleId, barcode: bundleId, dieNo: 'AL-1001', pieces, weight, packed: '2026-10-14', status: 'Packed', rack: 'A', createdAt: new Date(),
    })));
  });

  async function bearer(email) {
    return { Authorization: `Bearer ${(await api.post('/api/auth/login').send({ email, password: 'demo-pass-1' })).body.token}` };
  }
  const create = (headers, bundleIds = [IDS.a, IDS.b], who = customer) => api.post('/api/sales/invoices').set(headers).send({ bundleIds, customer: who });
  const bundle = id => conn.db.collection('bundles').findOne({ bundleId: id });
  const lines = saleNo => conn.db.collection('sales').find({ invoiceNo: saleNo }).toArray();
  const lookup = (id, headers = seller) => api.get(`/api/sales/lookup/${id}`).set(headers);

  it('is only for admins and the sales department', async () => {
    for (const email of ['manager@invenza.com', 'accountant@invenza.com']) {
      const headers = await bearer(email);
      for (const res of [await lookup(IDS.a, headers), await api.get('/api/sales/invoices').set(headers), await create(headers), await api.get('/api/sales').set(headers)]) {
        assert.equal(res.status, 403, email);
      }
    }
    assert.equal((await api.get('/api/sales/invoices').set(seller)).status, 200);
    assert.equal((await api.get('/api/products').set(seller)).status, 403);
    assert.deepEqual((await api.get('/api/auth/me').set(seller)).body.modules, ['sales']);
    // the older single-bundle sale would skip approval
    assert.equal((await api.post('/api/sales').set(seller).send({ bundleId: IDS.a, quantity: 1 })).status, 403);
  });

  it('gives all details of a bundle by its number, matching numbers in full only', async () => {
    const res = await lookup(IDS.a);
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.bundleId, res.body.dieNo, res.body.pcs, res.body.weight], [IDS.a, 'AL-1001', 10, 22.54]);
    assert.ok(res.body.product);
    assert.equal(res.body.amount, undefined);
    assert.equal((await lookup('9000')).status, 404);
    assert.equal((await api.get('/api/bundles/lookup/9000').set(auth)).status, 404);
  });

  it('waits for approval when the sales department creates it, with the bundles reserved', async () => {
    const res = await create(seller);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const inv = res.body;
    assert.match(inv.saleNo, /^SALE-\d{6}$/);
    assert.equal(inv.status, 'pending');
    assert.deepEqual([inv.totals.bundles, inv.totals.pcs, inv.totals.weight], [2, 20, 49.34]);
    assert.deepEqual(inv.customer, { ...customer, email: 'g@example.com' });
    assert.equal((await bundle(IDS.a)).pieces, 10, 'stock is not taken before approval');
    assert.equal((await lines(inv.saleNo)).length, 0);
    assert.match((await lookup(IDS.a)).body.error, /waiting for approval/);
    assert.equal((await create(seller, [IDS.c, IDS.a])).status, 409);
    assert.equal((await bundle(IDS.c)).reservedBy, undefined, 'nothing stays reserved after a refusal');
    assert.equal((await post('/api/sales', { bundleId: IDS.a, quantity: 1 })).status, 409);
    assert.equal((await put(`/api/bundles/${IDS.a}`, { dieNo: 'AL-1001', pieces: 1, weight: 1, status: 'Packed' })).status, 409);

    assert.equal((await api.post(`/api/sales/invoices/${inv.saleNo}/approve`).set(seller)).status, 403);
    const ok = await post(`/api/sales/invoices/${inv.saleNo}/approve`);
    assert.equal(ok.body.status, 'issued');
    const sold = await bundle(IDS.a);
    assert.deepEqual([sold.pieces, sold.weight, sold.status, sold.reservedBy], [0, 0, 'Sold', undefined]);
    assert.equal((await lines(inv.saleNo)).length, 2);
    assert.equal((await post(`/api/sales/invoices/${inv.saleNo}/approve`)).status, 409);
    assert.equal((await post(`/api/sales/invoices/${inv.saleNo}/reject`)).status, 409);
    assert.equal((await lines(inv.saleNo)).length, 2);
    assert.match((await lookup(IDS.a)).body.error, /already sold/);
  });

  it('is issued at once when an admin creates it, and counts as one bill', async () => {
    const billsToday = async () => (await get('/api/dashboard')).body.today.bills;
    const before = await billsToday();
    const res = await create(auth, [IDS.a, IDS.b, IDS.c]);
    assert.equal(res.body.status, 'issued');
    assert.equal((await bundle(IDS.c)).status, 'Sold');
    assert.equal((await lines(res.body.saleNo)).length, 3);
    assert.equal(await billsToday(), before + 1);
    const next = await create(auth, [IDS.a]);
    assert.equal(next.status, 409);
  });

  it('frees the bundles when it is rejected', async () => {
    const { saleNo } = (await create(seller)).body;
    assert.equal((await post(`/api/sales/invoices/${saleNo}/reject`)).body.status, 'rejected');
    assert.equal((await lookup(IDS.a)).status, 200);
    assert.equal((await post(`/api/sales/invoices/${saleNo}/approve`)).status, 409);
    assert.equal((await post('/api/sales/invoices/SALE-999999/approve')).status, 404);
  });

  it('checks the bundle list and the customer details', async () => {
    assert.equal((await create(seller, [])).status, 400);
    assert.equal((await create(seller, [IDS.a, IDS.a])).status, 400);
    assert.equal((await create(seller, ['nope-1'])).status, 404);
    for (const who of [{ ...customer, name: '' }, { ...customer, contact: '' }, { ...customer, contact: '12ab' }, { ...customer, email: 'bad' }]) {
      assert.equal((await create(seller, [IDS.a], who)).status, 400, JSON.stringify(who));
    }
    assert.equal((await create(seller, [IDS.a], { name: 'N', contact: '+91 98604 70406' })).status, 201);
  });

  it("saves a new customer once, and offers saved customers for suggestions", async () => {
    const names = async () => (await api.get("/api/sales/customers").set(seller)).body;
    const mine = async () => (await names()).filter(c => c.name.toLowerCase() === "ganesh landge");
    assert.ok((await names()).some(c => c.contact), "saved customers are suggested");
    assert.equal((await mine()).length, 0);

    await create(seller, [IDS.a], { name: "Ganesh Landge", contact: "9860470406" });
    assert.deepEqual(await mine(), [{ name: "Ganesh Landge", contact: "9860470406", email: "", city: "" }]);
    // the same person, typed differently: no duplicate, and the email is filled in
    await create(seller, [IDS.b], { name: "ganesh landge", contact: "+91 98604 70406", email: "g@example.com" });
    assert.deepEqual((await mine()).map(c => [c.contact, c.email]), [["9860470406", "g@example.com"]]);
    // the same name with another number is somebody else
    await create(seller, [IDS.c], { name: "Ganesh Landge", contact: "9000000001" });
    assert.equal((await mine()).length, 2);
    const manager = await bearer("manager@invenza.com");
    assert.equal((await api.get("/api/sales/customers").set(manager)).status, 403);
  });

  describe('rack and PDF download', () => {
    const asBuffer = (res, done) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    };
    const download = (saleNo, headers = auth) => api.get(`/api/sales/invoices/${saleNo}/pdf?tz=Asia%2FKolkata`).set(headers).buffer(true).parse(asBuffer);
    /** The words of an uncompressed PDF (pdfkit writes them as hex strings). */
    const words = file => file.toString('latin1').split('\n').filter(l => l.endsWith(' TJ'))
      .map(l => [...l.matchAll(/<([0-9a-f]+)>/g)].map(m => Buffer.from(m[1], 'hex').toString('latin1')).join(''));

    it('keeps each bundle\'s rack on the invoice', async () => {
      await conn.db.collection('bundles').updateOne({ bundleId: IDS.b }, { $set: { rack: 'Gold' } });
      assert.equal((await lookup(IDS.b)).body.rack, 'Gold');
      const inv = (await create(auth)).body;
      assert.deepEqual(inv.items.map(i => i.rack), ['A', 'Gold']);
    });

    it('downloads an issued invoice as a PDF', async () => {
      const { saleNo } = (await create(auth)).body;
      const res = await download(saleNo);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/pdf');
      assert.equal(res.headers['content-disposition'], `attachment; filename="${saleNo}.pdf"`);
      assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
      assert.equal((await download(saleNo, seller)).status, 200);
      assert.equal((await download(saleNo, await bearer('manager@invenza.com'))).status, 403);
      assert.equal((await download('SALE-999999')).status, 404);
    });

    it('draws the same table as the printed invoice, without prices, over several pages', async () => {
      const { renderInvoicePdf, formatDate, lengthOf } = await import('../src/services/invoice-pdf.service.js');
      const items = Array.from({ length: 90 }, (_, i) => ({ bundleId: String(103700 + i), dieNo: i < 45 ? '' : 'D2', product: i < 45 ? '1.5+1 PLAIN PIPE' : '18+60 HANDLE', length: '15/FT', rack: '', pcs: 40, weight: 44.9, amount: 99999 }));
      const invoice = {
        saleNo: 'SALE-000150', company: 'Siddheshwar Aluminium & Glass', customer: { name: 'Dull Nagar', contact: '9860470406', email: '' },
        items, totals: { bundles: 90, pcs: 3600, weight: 4041 }, issuedAt: '2026-11-23T10:19:00Z',
      };
      const text = words(await renderInvoicePdf(invoice, { timeZone: 'Asia/Kolkata', compress: false }));
      for (const part of ['SALES INVOICE', 'Siddheshwar Aluminium & Glass', 'SALE-000150', 'DULL NAGAR', 'Date  23/11/2026', 'BILLED TO', 'TOTAL WEIGHT', '4041.00 Kg', 'Thank you for your business!', 'Sr No', 'Barcode', 'WT', 'PC', 'LE', 'WT/PC', '1.5+1 PLAIN PIPE', '18+60 HANDLE',
        '103700', '103789', '44.90', '40.00', '15', '1.12', '2020.50', '1800.00', '4041.00', '3600.00', 'GRAND TOTAL \xB7 90 bundles']) {
        assert.ok(text.includes(part), `missing: ${part}`);
      }
      assert.ok(!text.includes('Rack'), 'no rack column without racks');
      assert.equal(text.filter(t => /^1037\d\d$/.test(t)).length, 90, 'every bundle once');
      assert.ok(text.filter(t => t === 'Barcode').length > 1, 'headings repeat on each page');
      assert.ok(text.some(t => /Page 2 of \d/.test(t)), 'page numbers');
      assert.ok(!text.join(' ').includes('99999'));

      const racked = words(await renderInvoicePdf({ ...invoice, items: [{ ...items[0], rack: 'Black' }], totals: { bundles: 1, pcs: 40, weight: 44.9 } }, { compress: false }));
      for (const part of ['Rack', 'Black', 'GRAND TOTAL \xB7 1 bundle']) assert.ok(racked.includes(part), `missing: ${part}`);
      assert.equal(formatDate('2026-11-23T20:00:00Z', 'Asia/Kolkata'), '24/11/2026');
      assert.equal(formatDate('2026-11-23T10:00:00Z', 'Not/AZone'), '23/11/2026');
      assert.deepEqual([lengthOf('15/FT'), lengthOf(''), lengthOf(undefined)], ['15', '-', '-']);
    });

    it('keeps the product length on each line, also for invoices made before it was stored', async () => {
      await conn.db.collection('products').updateOne({ dieNo: 'AL-1001' }, { $set: { clValue: '15/FT' } });
      const made = (await create(auth, [IDS.a])).body;
      assert.equal(made.items[0].length, '15/FT');
      await conn.db.collection('invoices').updateOne({ saleNo: made.saleNo }, { $unset: { 'items.0.length': '' } });
      assert.equal((await api.get(`/api/sales/invoices/${made.saleNo}`).set(auth)).body.items[0].length, '15/FT');
      assert.equal((await api.get('/api/sales/invoices').set(auth)).body.find(i => i.saleNo === made.saleNo).items[0].length, '15/FT');
    });

    it('refuses to download a waiting invoice, or one it cannot draw correctly', async () => {
      const waiting = (await create(seller, [IDS.a])).body;
      assert.equal((await api.get(`/api/sales/invoices/${waiting.saleNo}/pdf`).set(seller)).status, 409);
      const marathi = (await create(auth, [IDS.b], { name: 'गणेश', contact: '9860470406' })).body;
      const res = await api.get(`/api/sales/invoices/${marathi.saleNo}/pdf`).set(auth);
      assert.equal(res.status, 422);
      assert.match(res.body.error, /Save as PDF/);
    });
  });

  it('suggests only bundles that can be sold, matching every word typed', async () => {
    await conn.db.collection('products').insertOne({ dieNo: 'ZX-9', name: 'Zebra Handle', category: 'Aluminium', size: '7/8', finish: '', clValue: '12' });
    const add = (bundleId, more) => conn.db.collection('bundles').insertOne({ bundleId, barcode: bundleId, dieNo: 'ZX-9', pieces: 5, weight: 9, packed: '2026-11-27', status: 'Packed', rack: 'Black', createdAt: new Date(), ...more });
    await add('92001', {});
    await add('92002', { rack: 'Gold' });
    await add('92003', { status: 'Sold', pieces: 0 });
    await add('92004', { reservedBy: 'SALE-000099' });
    const search = async (q, headers = seller) => (await api.get(`/api/sales/search?q=${encodeURIComponent(q)}`).set(headers)).body;
    const ids = async q => (await search(q)).map(b => b.bundleId).sort();

    assert.deepEqual(await ids('zebra'), ['92001', '92002']);
    assert.deepEqual(await ids('9200'), ['92001', '92002']);
    assert.deepEqual(await ids('ZX-9 gold'), ['92002']);
    assert.deepEqual(await ids('7/8 black handle'), ['92001']);
    assert.deepEqual(await ids('zebra nothing'), []);
    assert.deepEqual(await ids('(.*'), [], 'typed text is not a pattern');
    const [first] = await search('92002');
    assert.deepEqual([first.product, first.size, first.rack, first.pcs, first.weight, first.length], ['Zebra Handle', '7/8', 'Gold', 5, 9, '12']);
    assert.equal(first.amount, undefined);
    assert.ok((await search('')).length > 0, 'with nothing typed the newest bundles are offered');
    const manager = await bearer('manager@invenza.com');
    assert.equal((await api.get('/api/sales/search?q=zebra').set(manager)).status, 403);
  });

  it('lets only one of two sales people take the same bundle', async () => {
    const results = await Promise.all([create(seller, [IDS.a, IDS.b]), create(seller, [IDS.b, IDS.a])]);
    const winners = results.filter(r => r.status === 201);
    assert.ok(winners.length <= 1, 'never both');
    const held = [(await bundle(IDS.a)).reservedBy, (await bundle(IDS.b)).reservedBy];
    assert.deepEqual(held, winners.length ? [winners[0].body.saleNo, winners[0].body.saleNo] : [undefined, undefined]);
  });
});

describe('changing racks', () => {
  const ids = ['91001', '91002', '91003'];
  beforeEach(async () => {
    await conn.db.collection('bundles').insertMany(ids.map(bundleId => ({
      bundleId, barcode: bundleId, dieNo: 'AL-1001', pieces: 10, weight: 30, packed: '2026-11-27', status: 'Packed', rack: 'Black', createdAt: new Date(),
    })));
  });
  const racks = async () => (await conn.db.collection('bundles').find({ bundleId: { $in: ids } }).sort({ bundleId: 1 }).toArray()).map(b => [b.rack, b.pieces, b.weight]);

  it('changes only the rack of the chosen bundles', async () => {
    const res = await put('/api/bundles/rack', { bundleIds: ids.slice(0, 2), rack: ' Champagne ' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { rack: 'Champagne', updated: 2, held: [] });
    assert.deepEqual(await racks(), [['Champagne', 10, 30], ['Champagne', 10, 30], ['Black', 10, 30]]);
    assert.equal((await put('/api/bundles/rack', { bundleIds: [ids[2]], rack: '' })).body.rack, '—');
  });

  it('leaves bundles held by a waiting invoice, and says which', async () => {
    await conn.db.collection('bundles').updateOne({ bundleId: ids[0] }, { $set: { reservedBy: 'SALE-000009' } });
    const res = await put('/api/bundles/rack', { bundleIds: ids, rack: 'Gold' });
    assert.deepEqual([res.body.updated, res.body.held], [2, [ids[0]]]);
    assert.deepEqual((await racks()).map(r => r[0]), ['Black', 'Gold', 'Gold']);
  });

  it('checks the request and the role', async () => {
    assert.equal((await put('/api/bundles/rack', { bundleIds: [], rack: 'Gold' })).status, 400);
    assert.equal((await put('/api/bundles/rack', { bundleIds: [ids[0]], rack: 'x'.repeat(21) })).status, 400);
    assert.equal((await put('/api/bundles/rack', { bundleIds: [ids[0], 'nope'], rack: 'Gold' })).status, 404);
    assert.deepEqual((await racks()).map(r => r[0]), ['Black', 'Black', 'Black']);
    const login = await api.post('/api/auth/login').send({ email: 'accountant@invenza.com', password: 'demo-pass-1' });
    const res = await api.put('/api/bundles/rack').set({ Authorization: `Bearer ${login.body.token}` }).send({ bundleIds: ids, rack: 'Gold' });
    assert.ok([401, 403].includes(res.status));
  });
});

describe('search engines', () => {
  it('may list the sign-in page only', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'web-'));
    try {
      for (const [file, text] of [['index.csr.html', '<html></html>'], ['robots.txt', 'User-agent: *'], ['sitemap.xml', '<urlset/>'], ['main.js', '']]) {
        writeFileSync(join(dir, file), text);
      }
      const site = request(createApp({ db: conn.db, poolStats: conn.poolStats, config: { ...config, webDir: dir }, mailer }));
      const robots = async url => (await site.get(url)).headers['x-robots-tag'] ?? '';
      for (const url of ['/', '/login', '/login/', '/robots.txt', '/sitemap.xml', '/main.js']) assert.equal(await robots(url), '', url);
      for (const url of ['/dashboard', '/sales', '/members', '/activate?token=abc', '/reset-password', '/index.csr.html', '/api/health', '/api/products', '/api/nothing']) {
        assert.equal(await robots(url), 'noindex, nofollow', url);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
