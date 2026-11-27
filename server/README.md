# Invenza API

Node.js + Express + MongoDB backend for the aluminium & glass inventory system. The Angular app in the
parent folder talks to it under `/api`.

## Run it

```bash
cd server
npm install
cp .env.example .env        # then edit MONGODB_URI / JWT_SECRET
npm start                   # API on http://localhost:3000, seeds demo data on first start
```

No MongoDB installed? `npm run dev:memory` runs the API on a throw-away in-memory MongoDB (data is lost on exit).

Then, from the project root, run the Angular app (it proxies `/api` to port 3000):

```bash
npm start                   # http://localhost:4200
```

Demo login: `admin@invenza.com` / `aluminium` (set `ADMIN_EMAIL` / `ADMIN_PASSWORD` before the first start).

## Environments

| | Development | Production |
| --- | --- | --- |
| API settings file | `.env.development`, then `.env` | `.env.production` only |
| Start the API (project root) | `npm run api` | `npm run api:prod` |
| Web app | `npm start` (port 4200) | `npm run build:prod`, then `npm run web:prod` (port 4000) |
| Web settings | `src/environments/environment.ts` | `src/environments/environment.prod.ts` |
| Demo data | loaded into an empty database | never loaded |

Real environment variables override the files. `--prod` or `NODE_ENV=production` selects production.

### First production run

1. `cp server/.env.production.example server/.env.production` and fill in the blanks.
2. Install dependencies: `npm ci`, then `npm ci --prefix server`.
3. `npm run build:prod`
4. Run `npm run api:prod` and `npm run web:prod` as two processes.

The web server forwards `/api` to `http://localhost:3000`; set `API_URL` for another address, and `PORT` to change
its port from 4000. On a real domain, set `NG_ALLOWED_HOSTS` for the web process (for example
`inventory.yourcompany.com`). Put HTTPS in front of it. The API refuses to start in production if a required setting is
missing, `JWT_SECRET` or `ADMIN_PASSWORD` is weak, or a demo / test switch is on. `seed:prod` rejects `--reset`.

## Registration emails

Registering a member (and **Resend email**) sends an activation link. Without `SMTP_HOST` the link is only printed
in the API log. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` and `APP_URL` in `.env` (production:
`.env.production`, where `SMTP_HOST` is required). For Gmail use `smtp.gmail.com`, port 587 and a Google
[app password](https://support.google.com/accounts/answer/185833), with your Gmail address in `MAIL_FROM`.

Check it from the `server` folder with `npm run mail:test -- you@example.com` (add `--prod` for production), then
restart the API; it logs `[mail] ready` or the reason it is not.

## Folder structure

```
server/
├─ scripts/            seed.js (CLI), dev-memory.js (in-memory MongoDB)
├─ tests/              API tests
└─ src/
   ├─ config/          env-based configuration
   ├─ database/
   │  ├─ connection.js   one pooled MongoClient
   │  ├─ collections.js  collection names
   │  ├─ indexes.js      unique / lookup indexes
   │  └─ seeds/          seed.js + data/ (demo products, bundles, parties, sales)
   ├─ models/          validation + shape of each document (product, bundle, sale, party, settings)
   ├─ controllers/     request handlers (business logic)
   ├─ routes/          URL -> controller wiring
   ├─ middleware/      auth, error handling
   ├─ services/        JWT and password helpers
   └─ utils/           validators, dates, csv, ids, errors
```

## Connection pooling

`src/database/connection.js` creates **one** `MongoClient` for the whole process. The driver keeps a pool of sockets inside it and
lends one to each operation, so concurrent requests share connections instead of opening their own.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MONGO_MAX_POOL_SIZE` | 20 | Upper bound of simultaneous connections |
| `MONGO_MIN_POOL_SIZE` | 2 | Connections kept warm |

Also set: `maxIdleTimeMS` 60 s, `waitQueueTimeoutMS` 10 s (fail instead of waiting forever when the pool is
exhausted), `serverSelectionTimeoutMS` 5 s. `GET /api/health` returns live pool numbers
(`open`, `inUse`, `maxPoolSize`). The process closes the pool on `SIGINT` / `SIGTERM`.

## Roles and access

Three roles: `admin`, `manager`, `accountant`. **`src/models/user.model.js` (`ROLE_MODULES`) is the one place that says which tabs each role can open.** Admin gets every tab; the manager and accountant lists are a starting point. Change a list and both sides follow: the API answers `403` for a tab the role lacks, and the Angular menu hides it (the login response and `GET /api/auth/me` return the user's `modules`).

### Who can register whom

The **super admin** is the account named by `ADMIN_EMAIL`. It is stored with the `admin` role.

| Signed in as | Can register | Can see and manage in Members |
| --- | --- | --- |
| Super admin | Admins, managers, accountants | Everyone (the list shows who added each member) |
| Admin | Managers, accountants | The employees they registered (their own row is listed but read-only) |
| Manager, accountant | Nobody | No access |

Each member stores `createdBy`, the email of whoever registered them. Members without it (added before this field existed) are managed by the super admin only. This limits the Members page only: inventory data is shared by everyone.

Demo users (created only when `SEED_DEMO_USERS=1`; off by default; password `DEMO_USERS_PASSWORD`): `manager@invenza.com`, `accountant@invenza.com`.

To see roles in action, turn real login on: `AUTH_DISABLED=0` here and `authDisabled: false` in `src/environments/environment.ts`.

## Endpoints

All routes except `/api/health` and `POST /api/auth/login` need `Authorization: Bearer <token>`.

| Method & path | Purpose |
| --- | --- |
| `POST /api/auth/login`, `GET /api/auth/me` | Sign in (JWT), current user |
| `GET/POST /api/products`, `GET/PUT /api/products/:dieNo` | Product master. Die No is unique (409 on duplicate). Editing a Die No keeps bundles linked |
| `GET/POST /api/bundles`, `GET/PUT /api/bundles/:bundleId` | Bundles. The server assigns a numeric, auto-incrementing bundle ID (1001, 1002, ...); the barcode value is that same ID. Average weight is calculated |
| `GET /api/bundles/lookup/:scan` | Barcode / scanner lookup by full ID; older non-numeric IDs also match a unique prefix (404 not found, 409 ambiguous) |
| `POST /api/sales` | `{ bundleId, quantity, customer? }` Deducts pieces, recalculates weight, sets status to Sold at zero, creates the bill |
| `GET /api/sales`, `GET /api/sales/:billNo` | Sales history and bill detail |
| `GET /api/stock`, `GET /api/stock/export.csv` | Stock by product with filters `q`, `state` (all/available/sold), `dieNo` |
| `GET /api/reports?range=Today\|Week\|Month\|All`, `.../sales.csv`, `.../packing.csv` | Report tables, totals and CSV |
| `GET /api/dashboard` | KPIs, status counts, low stock, today's numbers, 7-day trend |
| `GET/PUT /api/settings` | Company, low-stock threshold, weight unit, per-kg rates |
| `GET/POST /api/customers`, `/api/suppliers` | Parties |

Errors are JSON: `{ "error": "message" }` with 400 (validation), 401, 404, 409 (conflict / insufficient stock).

## Data model (collections)

`users`, `products` (unique `dieNo`), `bundles` (unique `bundleId`), `sales` (unique `billNo`, product name and
category are snapshotted on the bill), `customers`, `suppliers`, `settings` (one document), `counters` (bill numbers).

## Sales and concurrency

The stock deduction is a single atomic `findOneAndUpdate` guarded by `pieces >= quantity`, so two cashiers
selling the same bundle at once cannot oversell it (covered by a test that fires 12 simultaneous sales at a
40-piece bundle). The deduction and the bill insert are not wrapped in a multi-document transaction, so the
API also works on a standalone `mongod`; if the bill insert fails the stock change is reverted.

## Tests

```bash
npm test      # 33 API tests (supertest) on an in-memory MongoDB
```

From the project root, `npm run e2e` runs the Playwright suite. It starts this API on an in-memory MongoDB
(port 3000, with a test-only `POST /api/test/reset` route, enabled only when `ENABLE_TEST_ROUTES=1`) and the
Angular app on port 4300.

## Before going to production

- Set a long random `JWT_SECRET`, a real `ADMIN_PASSWORD`, and `CORS_ORIGIN` to your site; serve over HTTPS.
- Add login rate limiting (for example `express-rate-limit`); it is not included.
- The token is kept in `localStorage` for simplicity; use an httpOnly cookie if you need stronger XSS protection.
- The role is read from the login token, so removing or demoting a member takes effect only when their token expires (`JWT_EXPIRES_IN`).
