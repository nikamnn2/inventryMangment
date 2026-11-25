/** Purpose: serves the built Angular app from the API, so the website and /api share one address. */
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import express from 'express';

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
      if (/-[A-Z0-9]{8}\.(js|css)$/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

  app.use((req, res, next) => {
    const isPage = (req.method === 'GET' || req.method === 'HEAD') && !/^\/api(\/|$)/i.test(req.path) && !extname(req.path);
    if (!isPage) return next();
    res.sendFile(shell, { headers: { 'Cache-Control': 'no-cache' } });
  });
  return true;
}
