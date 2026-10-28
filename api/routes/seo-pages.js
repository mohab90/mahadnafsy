'use strict';
/**
 * Course and bundle pages, and the sitemap, served fresh between releases.
 *
 * «صفحات الكورسات في جوجل» (11 Oct 2026). tools/generate-seo.mjs writes them
 * into the client build at release time and nowhere else, so a course published
 * after a release had no page of its own and no place in the sitemap, and an
 * edited course kept its old title in Google and its old card on WhatsApp,
 * until the next release.
 *
 * Served rather than written: the build nginx serves lives in a release
 * directory that belongs to root and is replaced by every release, so a file
 * the API wrote there would be refused or thrown away. nginx sends /c/…,
 * /course/…, /bundle/… and /sitemap.xml here first and falls back to the
 * release's own files when this answers anything but 200 (deploy/nginx/
 * mahad-web.conf.example), so the site is never worse off than before.
 *
 * Fresh means: the catalogue is cached for ten minutes, and a course or bundle
 * saved in the admin drops the cache at once (cacheInvalidate('courses',
 * 'bundles') in routes/admin/catalog.js matches these keys).
 */
const express = require('express');
const fs = require('node:fs');
const router = express.Router();
const logger = require('../lib/logger').child({ module: 'seo-pages-route' });
const { pool, cached } = require('../lib/db');
const { publicLimiter } = require('../middleware/rateLimits');
const { STATIC_PAGES, render, coursePage, bundlePage, sitemapXml } = require('../lib/seoPages');

const CATALOG_TTL_MS = 10 * 60 * 1000;
const SHELL_URL_TTL_MS = 60 * 1000;

const siteUrl = () => String(process.env.SEO_SITE_URL || 'https://mahadnafsy.com').replace(/\/$/, '');

// The live build's index.html. Read from disk where nginx serves it, so the page
// always names the current release's asset files — stat'ed on every request,
// since a release swaps the directory behind the path. Elsewhere (the container
// deployment) it is fetched from the site itself and kept a minute.
const shellFiles = () => [process.env.SEO_SHELL_FILE, '/opt/mahad/static/client/index.html'].filter(Boolean);
const looksLikeShell = html => /<div id="root">/.test(html) && /<link rel="canonical"/.test(html);
let fileShell = { key: '', html: '' };
let urlShell = { at: 0, html: '' };

async function loadShell() {
  for (const file of shellFiles()) {
    try {
      const stat = fs.statSync(file);
      const key = `${file}:${stat.ino}:${stat.mtimeMs}:${stat.size}`;
      if (fileShell.key !== key) fileShell = { key, html: fs.readFileSync(file, 'utf8') };
      if (looksLikeShell(fileShell.html)) return fileShell.html;
    } catch { /* not on this host */ }
  }
  if (urlShell.html && Date.now() - urlShell.at < SHELL_URL_TTL_MS) return urlShell.html;
  const url = process.env.SEO_SHELL_URL || `${siteUrl()}/index.html`;
  const response = await fetch(url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(4000) });
  const html = response.ok ? await response.text() : '';
  if (!looksLikeShell(html)) throw new Error(`no app shell at ${url} (HTTP ${response.status})`);
  urlShell = { at: Date.now(), html };
  return html;
}

const courses = tenantId => cached(`courses-seo:${tenantId}`, CATALOG_TTL_MS, async () => {
  const [rows] = await pool.query(
    `SELECT id, slug, title, seo_title, seo_description, short_description, LEFT(description, 2000) AS description,
            thumbnail, updated_at, created_at
       FROM courses
      WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL
      ORDER BY sort_order ASC, created_at DESC LIMIT 1000`, [tenantId]);
  return rows;
});

const bundles = tenantId => cached(`bundles-seo:${tenantId}`, CATALOG_TTL_MS, async () => {
  const [rows] = await pool.query(
    `SELECT b.id, b.title, b.seo_title, b.seo_description, b.short_description, LEFT(b.description, 2000) AS description,
            b.thumbnail, b.updated_at, b.created_at,
            (SELECT c.thumbnail FROM bundle_courses bc
               JOIN courses c ON c.id=bc.course_id AND c.tenant_id=bc.tenant_id
              WHERE bc.bundle_id=b.id AND bc.tenant_id=b.tenant_id
              ORDER BY bc.sort_order LIMIT 1) AS first_course_thumbnail
       FROM bundles b
      WHERE b.tenant_id=? AND b.is_published=1 AND b.deleted_at IS NULL
      ORDER BY b.sort_order ASC, b.created_at DESC LIMIT 500`, [tenantId]);
  return rows;
});

// Under the community routes' own prefix, so saving an event drops it too.
const events = tenantId => cached(`community:${tenantId}:events-seo`, CATALOG_TTL_MS, async () => {
  const [rows] = await pool.query(
    'SELECT id, slug FROM community_events WHERE tenant_id=? ORDER BY event_date DESC, created_at DESC LIMIT 200', [tenantId]);
  return rows;
});

/** Everything the sitemap lists, in the order the release's generator lists it. */
async function sitemapUrls(tenantId) {
  const urls = STATIC_PAGES.map(([loc, priority, changefreq]) => ({ loc, priority, changefreq }));
  for (const course of await courses(tenantId)) {
    const slug = course.slug || course.id;
    if (slug) urls.push({ loc: `/c/${slug}`, priority: '0.8', changefreq: 'weekly', lastmod: course.updated_at || course.created_at });
  }
  for (const bundle of await bundles(tenantId)) {
    urls.push({ loc: `/bundle/${bundle.id}`, priority: '0.8', changefreq: 'weekly', lastmod: bundle.updated_at || bundle.created_at });
  }
  for (const event of await events(tenantId).catch(() => [])) {
    const slug = event.slug || event.id;
    if (slug) urls.push({ loc: `/community/events/${slug}`, priority: '0.6', changefreq: 'weekly' });
  }
  return urls;
}

router.get('/api/seo/sitemap.xml', publicLimiter, async (req, res) => {
  try {
    const xml = sitemapXml(await sitemapUrls(req.tenantId), siteUrl());
    res.set('Cache-Control', 'public, max-age=600');
    res.type('application/xml').send(xml);
  } catch (e) {
    logger.error('[seo/sitemap]', e.message);
    res.status(503).type('text/plain').send('sitemap unavailable');
  }
});

/**
 * One product's page: /c/<slug> or /course/<id> (both canonical to /c/<slug>),
 * or /bundle/<id>. 404 for anything unpublished, which nginx answers with the
 * app itself — the app has its own «not found».
 */
router.get('/api/seo/page/:kind(c|course|bundle)/:key', publicLimiter, async (req, res) => {
  try {
    const key = String(req.params.key || '').slice(0, 200);
    let page = null;
    if (req.params.kind === 'bundle') {
      const bundle = (await bundles(req.tenantId)).find(row => String(row.id) === key);
      if (bundle) page = bundlePage(bundle, siteUrl(), bundle.first_course_thumbnail);
    } else {
      const list = await courses(req.tenantId);
      const course = list.find(row => String(row.slug || '') === key) || list.find(row => String(row.id) === key);
      if (course) page = coursePage({ ...course, slug: course.slug || course.id }, siteUrl());
    }
    if (!page) return res.status(404).type('text/plain').send('not found');
    const html = render(await loadShell(), page);
    // Like every HTML page of the site: it names the release's asset files.
    res.set('Cache-Control', 'no-store');
    // This is the app's own page, not an API answer: the API's headers
    // (lib/httpApp.js helmet — script-src 'none', img-src 'self') would stop
    // the app's scripts and the course images from loading on it. It gets the
    // site's headers from nginx instead (deploy/nginx/mahad-security-headers.conf).
    for (const header of ['Content-Security-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy', 'X-Frame-Options']) {
      res.removeHeader(header);
    }
    res.type('html').send(html);
  } catch (e) {
    logger.warn('[seo/page]', e.message);
    res.status(503).type('text/plain').send('page unavailable');
  }
});

router._test = {
  loadShell, sitemapUrls,
  reset() { fileShell = { key: '', html: '' }; urlShell = { at: 0, html: '' }; },
};

module.exports = router;
