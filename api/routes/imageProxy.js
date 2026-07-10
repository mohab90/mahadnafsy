'use strict';
// ── On-the-fly image resize + WebP proxy with disk cache ─────────────────────
// GET /api/img?src=<external-url>&w=<width>
// Course/therapist/bundle images are hosted on top4top.io as full-resolution
// PNG/JPEG (some are 8–12 MB TIFFs mislabelled .jpg). This fetches each once,
// downscales to the requested width, re-encodes as WebP, caches the result on
// disk, and serves it with an immutable long-cache header — turning a 12 MB
// original into ~20–50 KB. On ANY failure it redirects to the original URL so
// an image never fails to render because of the optimizer.
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const fs      = require('fs');
const fsp     = require('fs/promises');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const logger  = require('../lib/logger');

let sharp = null;
try { sharp = require('sharp'); }
catch { logger.warn('[img] sharp not installed — proxy will pass through to originals'); }

// Cache lives OUTSIDE the deploy dir so a redeploy doesn't wipe warmed images.
const CACHE_DIR = process.env.IMG_CACHE_DIR || path.join(__dirname, '..', '.img-cache');
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* noop */ }

// SSRF guard — only fetch from hosts we actually serve images from. Anything
// else redirects to the original (no proxying of arbitrary user-supplied URLs).
const ALLOWED_HOST_RE = /(^|\.)top4top\.io$/i;
// Fixed width set so the cache can't be bloated by arbitrary ?w= values.
const ALLOWED_WIDTHS = [80, 120, 160, 240, 320, 400, 500, 640, 800, 1000, 1200];
const MAX_SOURCE_BYTES = 25 * 1024 * 1024; // don't buffer more than 25 MB of source

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchBuffer(new URL(res.headers.location, url).toString()).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('upstream ' + res.statusCode)); }
      const chunks = []; let len = 0;
      res.on('data', (c) => {
        len += c.length;
        if (len > MAX_SOURCE_BYTES) { req.destroy(); reject(new Error('source too large')); }
        else chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

router.get('/api/img', async (req, res) => {
  const src = String(req.query.src || '');
  try {
    let u;
    try { u = new URL(src); } catch { return res.status(400).end(); }
    if (!/^https?:$/.test(u.protocol)) return res.status(400).end();

    // Not an optimizable host, or sharp unavailable → let the original serve.
    if (!sharp || !ALLOWED_HOST_RE.test(u.hostname)) return res.redirect(302, src);

    let w = parseInt(req.query.w, 10) || 500;
    if (!ALLOWED_WIDTHS.includes(w)) {
      w = ALLOWED_WIDTHS.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
    }

    const key = crypto.createHash('sha1').update(src + '|' + w).digest('hex');
    const cachePath = path.join(CACHE_DIR, key + '.webp');

    res.type('image/webp');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');

    // Fast path: already optimized.
    try {
      const cached = await fsp.readFile(cachePath);
      return res.end(cached);
    } catch { /* cache miss — build it below */ }

    const source = await fetchBuffer(src);
    const out = await sharp(source, { failOn: 'none' })
      .rotate()                                      // honor EXIF orientation
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();

    fsp.writeFile(cachePath, out).catch(() => {});   // cache write is best-effort
    return res.end(out);
  } catch (e) {
    logger.warn('[img]', e.message);
    // Never break an image: fall back to the original URL.
    if (src) return res.redirect(302, src);
    return res.status(500).end();
  }
});

module.exports = router;
