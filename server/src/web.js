/** Purpose: serves the built Angular app from the API, so the website and /api share one address. */
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import express from 'express';

/** The addresses search engines may list; the site's files (script, styles, images) are listed below. */
const PUBLIC_PAGES = new Set(['/', '/login', '/robots.txt', '/sitemap.xml', '/og-image.png', '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']);

/**
 * Adds the website to `app` when a build exists in `dir`; returns whether it did. Angular's own router
 * decides what each page shows, so every page address gets the same HTML shell (refreshing /login or
 * opening an activation link works). /api and missing files are left to answer 404.
 */
export function serveWeb(app, dir) {
  const shell = dir ? join(dir, 'index.csr.html') : '';
  if (!shell || !existsSync(shell)) return false;

  app.use(express.static(dir, {
    index: false,
    redirect: false,
    // only files with a content hash in their name may be cached for long
    setHeaders: (res, file) => {
      // the empty page shell, asked for by its file name, is not a page of its own
      if (file.endsWith('index.csr.html')) res.set('X-Robots-Tag', 'noindex, nofollow');
      if (/-[A-Z0-9]{8}\.(js|css)$/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

  app.use((req, res, next) => {
    // only the sign-in page belongs in search results: not the app behind it, nor one-time activation links
    if (!extname(req.path).match(/^\.(js|css|woff2?)$/) && !PUBLIC_PAGES.has(req.path.replace(/(?<=.)\/+$/, '').toLowerCase())) res.set('X-Robots-Tag', 'noindex, nofollow');
    const isPage = (req.method === 'GET' || req.method === 'HEAD') && !/^\/api(\/|$)/i.test(req.path) && !extname(req.path);
    if (!isPage) return next();
    res.sendFile(shell, { headers: { 'Cache-Control': 'no-cache' } });
  });
  return true;
}
