import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connect } from '../src/database/connection.js';
import { createApp } from '../src/app.js';
import { requireAuth } from '../src/middleware/auth.middleware.js';
import { errorHandler } from '../src/middleware/error.middleware.js';
import { signToken, verifyToken, hashPassword, checkPassword } from '../src/services/auth.service.js';
import { HttpError, escapeRegex, num, oneOf, rangeStart, round2, sendCsv, str, wrap, isoDate } from '../src/utils/index.js';

const config = { jwtSecret: 's3cret', jwtExpiresIn: '1h', adminEmail: 'a@b.c', authDisabled: false };

describe('validators', () => {
  it('str trims, enforces required and max length', () => {
    assert.equal(str('  hi ', 'X'), 'hi');
    assert.equal(str(undefined, 'X'), '');
    assert.throws(() => str('', 'X', { required: true }), /X is required/);
    assert.throws(() => str('abcd', 'X', { max: 3 }), /at most 3/);
  });

  it('num parses numeric strings and enforces bounds', () => {
    assert.equal(num('5', 'N'), 5);
    assert.equal(num(0, 'N'), 0);
    assert.throws(() => num('', 'N'), /must be a number/);
    assert.throws(() => num('abc', 'N'), /must be a number/);
    assert.throws(() => num(NaN, 'N'), /must be a number/);
    assert.throws(() => num(1.5, 'N', { integer: true }), /whole number/);
    assert.throws(() => num(-1, 'N'), /at least 0/);
    assert.throws(() => num(0, 'N', { exclusiveMin: true }), /greater than 0/);
  });

  it('oneOf accepts only allowed values', () => {
    assert.equal(oneOf('a', 'L', ['a', 'b']), 'a');
    assert.throws(() => oneOf('c', 'L', ['a', 'b']), /one of: a, b/);
  });
});

describe('helpers', () => {
  it('round2 rounds to two decimals', () => {
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(2.5), 2.5);
  });

  it('escapeRegex neutralises metacharacters', () => {
    const re = new RegExp(`^${escapeRegex('a.b*c(1)')}$`);
    assert.ok(re.test('a.b*c(1)'));
    assert.ok(!re.test('aXb*c(1)'));
  });

  it('rangeStart resolves every range and rejects unknown ones', () => {
    const now = new Date(2026, 5, 15, 13, 30);
    assert.equal(rangeStart('Today', now).getDate(), 15);
    assert.equal(rangeStart('Week', now).getDate(), 9);
    assert.equal(rangeStart('Month', now).getMonth(), 4);
    assert.equal(rangeStart('All', now).getTime(), 0);
    assert.throws(() => rangeStart('Year', now), HttpError);
    assert.match(isoDate(now), /^2026-06-15$/);
  });

  it('wrap forwards rejections to next()', async () => {
    const err = new Error('boom');
    let received;
    await wrap(async () => { throw err; })({}, {}, e => { received = e; });
    assert.equal(received, err);
  });

  it('sendCsv quotes cells, escapes quotes and sets headers', () => {
    const headers = {};
    let body;
    sendCsv({ setHeader: (k, v) => { headers[k] = v; }, send: b => { body = b; } }, 'f.csv', ['a', 'b'], [['x"y', null]]);
    assert.equal(headers['Content-Disposition'], 'attachment; filename="f.csv"');
    assert.match(headers['Content-Type'], /text\/csv/);
    assert.ok(body.endsWith('"a","b"\r\n"x""y",""'));
  });
});

describe('auth service', () => {
  it('signs and verifies tokens, rejects tampering and wrong secrets', () => {
    const token = signToken({ email: 'a@b.c', name: 'A', role: 'admin' }, config);
    const claims = verifyToken(token, config);
    assert.equal(claims.sub, 'a@b.c');
    assert.equal(claims.role, 'admin');
    assert.throws(() => verifyToken(token + 'x', config));
    assert.throws(() => verifyToken(token, { ...config, jwtSecret: 'other' }));
  });

  it('hashes and checks passwords', async () => {
    const hash = await hashPassword('pw');
    assert.notEqual(hash, 'pw');
    assert.ok(await checkPassword('pw', hash));
    assert.ok(!(await checkPassword('nope', hash)));
  });
});

describe('auth middleware', () => {
  const account = { email: 'a@b.c', name: 'A', role: 'admin', status: 'active', passwordHash: 'hash-1' };
  /** A stand-in database holding at most one account. */
  const dbWith = user => ({ collection: () => ({ findOne: async () => user }) });
  const run = async (cfg, headers = {}, db = dbWith(account)) => {
    const req = { headers };
    let out;
    await requireAuth({ config: cfg, db })(req, {}, e => { out = e; });
    return { req, err: out };
  };
  const bearer = (user = account) => ({ authorization: `Bearer ${signToken(user, config)}` });

  it('accepts a valid bearer token', async () => {
    const { req, err } = await run(config, bearer());
    assert.equal(err, undefined);
    assert.equal(req.user.sub, 'a@b.c');
  });

  it('rejects missing, malformed and invalid tokens with 401', async () => {
    for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer garbage' }]) {
      assert.equal((await run(config, headers)).err.status, 401);
    }
  });

  it('rejects an unsigned token', async () => {
    const part = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: 'a@b.c', role: 'admin' })}.`;
    assert.equal((await run(config, { authorization: `Bearer ${forged}` })).err.status, 401);
  });

  it('rejects a good token once the account is removed, pending or has a new password', async () => {
    for (const current of [null, { ...account, status: 'pending' }, { ...account, passwordHash: 'hash-2' }]) {
      assert.equal((await run(config, bearer(), dbWith(current))).err.status, 401);
    }
  });

  it('takes the role from the database, not from the token', async () => {
    const { req } = await run(config, bearer(), dbWith({ ...account, role: 'accountant' }));
    assert.equal(req.user.role, 'accountant');
  });

  it('reports a database failure as a server error, not as signed out', async () => {
    const broken = { collection: () => ({ findOne: async () => { throw new Error('db down'); } }) };
    assert.equal((await run(config, bearer(), broken)).err.message, 'db down');
  });

  it('treats everyone as admin when auth is disabled', async () => {
    const { req, err } = await run({ ...config, authDisabled: true });
    assert.equal(err, undefined);
    assert.equal(req.user.role, 'admin');
    assert.equal(req.user.sub, config.adminEmail);
  });
});

describe('error middleware', () => {
  const call = err => {
    const res = { status(s) { this.code = s; return this; }, json(b) { this.body = b; return this; } };
    errorHandler(err, {}, res, () => {});
    return res;
  };

  it('maps parse failures, duplicate keys and HttpErrors', () => {
    assert.deepEqual([call({ type: 'entity.parse.failed' }).code, call({ code: 11000 }).code, call(new HttpError(404, 'nf')).code], [400, 409, 404]);
    assert.equal(call(new HttpError(422, 'bad')).body.error, 'bad');
  });

  it('hides internal details on 500s', () => {
    const orig = console.error;
    console.error = () => {};
    try {
      const res = call(new Error('db exploded'));
      assert.equal(res.code, 500);
      assert.equal(res.body.error, 'Internal server error.');
    } finally { console.error = orig; }
  });
});

describe('app wiring with test routes enabled', () => {
  let mongod, conn, api;
  const cfg = {
    jwtSecret: 't', jwtExpiresIn: '1h', corsOrigin: 'http://localhost:4200,http://x.test', dbName: 'unit_test',
    adminEmail: 'admin@invenza.com', adminPassword: 'aluminium', enableTestRoutes: true, authDisabled: false,
  };

  before(async () => {
    mongod = await MongoMemoryServer.create();
    conn = await connect({ uri: mongod.getUri(), dbName: cfg.dbName, maxPoolSize: 5, minPoolSize: 0 });
    api = request(createApp({ db: conn.db, config: cfg }));
  });
  after(async () => { await conn?.close(); await mongod?.stop(); });

  it('POST /api/test/reset reseeds the database', async () => {
    const res = await api.post('/api/test/reset');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.ok((await conn.db.collection('products').countDocuments()) > 0);
  });

  it('health works without poolStats', async () => {
    const res = await api.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.pool, null);
  });

  it('allows configured CORS origins', async () => {
    const res = await api.get('/api/health').set('Origin', 'http://x.test');
    assert.equal(res.headers['access-control-allow-origin'], 'http://x.test');
  });

  it('does not expose x-powered-by', async () => {
    assert.equal((await api.get('/api/health')).headers['x-powered-by'], undefined);
  });
});
