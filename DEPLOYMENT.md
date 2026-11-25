# Deploying to Hostinger

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): it checks the settings,
runs the tests, uploads the API, then builds and uploads the website. If a step fails, the later ones do not run.

| Part | What is uploaded | Where it runs |
| --- | --- | --- |
| Website | The built Angular app (static files) | A Hostinger website, e.g. `https://inventory.example.com` |
| API | The source in `server/` | A Hostinger Node.js app, e.g. `https://inventory-api.example.com` |

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

## Turning automatic deployment off

Disable the workflow in the repository's **Actions** tab, or remove the `push` trigger from the workflow file.
