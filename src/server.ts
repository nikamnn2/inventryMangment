/** Purpose: small Express server that serves the built Angular app and server-side-renders pages in production. (The business API lives in /server.) */
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
/** Hostnames allowed to be server-rendered. For a real domain set NG_ALLOWED_HOSTS (comma separated). */
const angularApp = new AngularNodeAppEngine({ allowedHosts: ['localhost', '127.0.0.1'] });

/**
 * Forward /api to the business API (in development `ng serve` does this via proxy.conf.json).
 * Set API_URL when the API is not on this machine's port 3000.
 */
const apiUrl = new URL(process.env['API_URL'] || 'http://localhost:3000');
const apiRequest = apiUrl.protocol === 'https:' ? httpsRequest : httpRequest;

app.use('/api', (req, res) => {
  const upstream = apiRequest(
    new URL(req.originalUrl, apiUrl),
    { method: req.method, headers: { ...req.headers, host: apiUrl.host } },
    (apiRes) => {
      res.writeHead(apiRes.statusCode ?? 502, apiRes.headers);
      apiRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (res.headersSent) res.destroy();
    else res.status(502).json({ error: 'Cannot reach the API server.' });
  });
  req.pipe(upstream);
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
