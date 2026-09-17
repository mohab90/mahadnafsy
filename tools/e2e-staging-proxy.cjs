#!/usr/bin/env node
'use strict';

/**
 * Serve a release's own admin and client bundles locally, with /api going to
 * staging — so the end-to-end suites can drive the real staging backend.
 *
 * Staging sits behind nginx basic auth, which the suites have no credentials
 * for. Rather than weaken that, this serves the bundles from the release
 * artifact and forwards /api and /uploads over an SSH tunnel to the staging
 * API. Same code, same backend, one gate fewer in the way.
 *
 *   ssh -N -L 13002:127.0.0.1:3002 root@<host>          # the tunnel
 *   node tools/e2e-staging-proxy.cjs <adminDist> <clientDist>
 *
 * Then: ADMIN_BASE_URL=http://127.0.0.1:4000 BASE_URL=http://127.0.0.1:5180
 *       API_BASE_URL=http://127.0.0.1:5180 npm --prefix e2e test
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const TUNNEL = { host: '127.0.0.1', port: Number(process.env.TUNNEL_PORT || 13002) };
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || '127.0.0.1:3002';
const SITES = [
  { name: 'admin', port: Number(process.env.ADMIN_PORT || 4000), root: path.resolve(process.argv[2] || '') },
  { name: 'client', port: Number(process.env.CLIENT_PORT || 5180), root: path.resolve(process.argv[3] || '') },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.xml': 'application/xml', '.txt': 'text/plain', '.map': 'application/json',
};

for (const site of SITES) {
  if (!site.root || !fs.existsSync(path.join(site.root, 'index.html'))) {
    console.error(`${site.name}: no index.html under ${site.root || '(missing argument)'}`);
    process.exit(2);
  }
}

function proxy(req, res) {
  // nginx presents the API same-origin, so Origin and Referer go: the API's
  // CORS allowlist drops localhost in production and would otherwise refuse.
  const headers = { ...req.headers, host: UPSTREAM_HOST };
  delete headers.origin;
  delete headers.referer;
  const upstream = http.request({ ...TUNNEL, method: req.method, path: req.url, headers }, up => {
    res.writeHead(up.statusCode, { ...up.headers });
    up.pipe(res);
  });
  upstream.on('error', error => { res.writeHead(502); res.end('tunnel: ' + error.message); });
  req.pipe(upstream);
}

function serveStatic(root, req, res) {
  const requested = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, requested);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); }
  catch { file = path.join(root, 'index.html'); }
  if (!fs.existsSync(file)) file = path.join(root, 'index.html');   // the SPA answers its own routes
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

for (const site of SITES) {
  http.createServer((req, res) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/uploads')) return proxy(req, res);
    serveStatic(site.root, req, res);
  }).listen(site.port, '127.0.0.1', () => {
    console.log(`${site.name.padEnd(7)} http://127.0.0.1:${site.port}  →  ${site.root}`);
  });
}
console.log(`/api and /uploads → 127.0.0.1:${TUNNEL.port} (tunnel to staging)`);
