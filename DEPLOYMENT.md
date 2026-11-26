# Deploying to Hostinger

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): it checks the settings,
runs the tests, uploads the API, then builds and uploads the website. If a step fails, the later ones do not run.

| Part | What is uploaded | Where it runs |
| --- | --- | --- |
| Website | The built Angular app (static files) | A Hostinger website, e.g. `https://inventory.example.com` |
| API | The source in `server/` | A Hostinger Node.js app, e.g. `https://inventory-api.example.com` |

## Alternative: one app at one address (Hostinger's GitHub deployment)

One Node.js app serves both the website and `/api`. Settings: main folder as root, entry file `server.js`, no build
command, Node 22. The root `server.js` always runs in production mode. The root `npm install` also installs the
packages in `server/` and builds the website, which is why the Angular build tools are listed under `dependencies`.
(The build step is skipped when `@playwright/test` is installed, as on a developer machine.)

Add the variables listed below, with `CORS_ORIGIN` and `APP_URL` set to this app's own address. No second
subdomain, `API_URL` or FTP workflow is needed with this method.

## One-time setup

### 1. Hostinger

1. Create the website (domain or subdomain) for the front end and note its folder.
2. Create a Node.js app on a second subdomain for the API: Node 22, entry file `src/server.js`.
3. In the Node.js app, add these environment variables. `NODE_ENV=production` is essential: without it the API
   starts in development mode and loads demo data into the database.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI`, `MONGODB_DB` | Production database. In MongoDB Atlas, also allow the Hostinger server's IP address |
| `JWT_SECRET` | A new random value of at least 32 characters |
| `JWT_EXPIRES_IN` | `12h` |
| `CORS_ORIGIN`, `APP_URL` | The website address, e.g. `https://inventory.example.com` (no trailing slash) |
| `ADMIN_EMAIL` | The super admin's email |
| `ADMIN_PASSWORD` | At least 12 characters |
| `AUTH_DISABLED`, `SEED_DEMO_USERS`, `ENABLE_TEST_ROUTES` | `0` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Mail settings for activation links |

The API refuses to start in production when a required value is missing or unsafe; the reason is in its log.

`ADMIN_PASSWORD` is only used when the super admin account is first created. It does not change the password of
an account that already exists in the database.

### 2. GitHub

Open the repository, then **Settings → Secrets and variables → Actions**.

Secrets:

| Name | Value |
| --- | --- |
| `HOSTINGER_FTP_SERVER` | FTP host name from hPanel → FTP Accounts |
| `HOSTINGER_FTP_USERNAME` | FTP user |
| `HOSTINGER_FTP_PASSWORD` | FTP password |

Variables (the **Variables** tab):

| Name | Value |
| --- | --- |
| `API_URL` | API address, e.g. `https://inventory-api.example.com` (no trailing slash, no `/api`) |
| `FRONTEND_REMOTE_DIR` | Website folder as the FTP user sees it, ending with `/` |
| `BACKEND_REMOTE_DIR` | Node.js app folder as the FTP user sees it, ending with `/` |

Use folders that belong only to this app. Do not reuse the folders of another project in the same hosting account.

## After a deployment

- **API changes:** the upload does not run `npm install`, and it has not been confirmed that Hostinger restarts
  a Node.js app after an FTP upload. Restart the app in hPanel. When `server/package.json` changed, install the
  packages (or redeploy the app) there first.
- Check `https://<api address>/api/health`. It should report `"status":"ok"`. This shows the API is up, not that
  it is running the newest code.
- Sign in on the website and open a page, then refresh it.

## Security

What the app does:

- Every API request except sign-in, activation and the health check needs a login token. Each request is checked
  against the database, so removing a member, changing a role or changing a password takes effect at once.
- Failed sign-ins are limited to 5 per address and account, 30 per account and 100 per address in 15 minutes.
  Failed activation links are limited to 20 per address. The counts are kept in memory and restart with the API.
  Because of the per-account limit, someone who knows an email can keep that account locked for 15 minutes at a time.
- `TRUST_PROXY` is the number of proxies in front of the API (default `1` in production). Set `0` if visitors connect
  to the API directly; otherwise they can fake their address.
- In production the health check reports only `"status":"ok"`.

What you have to do:

- Use long, unique passwords for the app, the database, the mail account and Hostinger / GitHub, and turn on
  two-step sign-in for Hostinger, GitHub, MongoDB Atlas and the mail account.
- In MongoDB Atlas, allow only the server's IP address, give the app a database user limited to its own database,
  and turn on backups.
- Keep the Android signing key (`~/.invenza-android`) private and backed up.
- Run `npm audit` now and then, both in the project root and in `server/`.

The website uses Angular 21, which needs Node `20.19+`, `22.12+` or `24+` wherever it is built. `overrides` in
`package.json` forces patched versions of `glob`, `minimatch` and `uuid` that some build tools would otherwise
leave old; remove an override once `npm audit` stays clean without it. Keep `@angular/build` under `dependencies`:
the one-app deployment installs without development packages and needs it to build the website.

## Turning automatic deployment off

Disable the workflow in the repository's **Actions** tab, or remove the `push` trigger from the workflow file.
