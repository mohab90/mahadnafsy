#!/usr/bin/env node
/**
 * Per-page SEO for a client-rendered site, without a rendering server.
 *
 * Every URL was serving the same shell, so every course page carried the
 * homepage's `<title>`, its `og:*` tags and — worst — `<link rel="canonical"
 * href="https://mahadnafsy.com/">`, which tells Google that all 24 courses and
 * 7 bundles are duplicates of the front page. And because Facebook and WhatsApp
 * read the served HTML rather than running JavaScript, every course link shared
 * anywhere previewed as the generic institute card.
 *
 * The fix rides on the nginx rule that is already there:
 *
 *     location / { try_files $uri $uri/ /index.html; }
 *
 * `$uri/` means a real directory wins before the SPA fallback. So writing
 * dist/c/<slug>/index.html — the same shell with that course's meta block —
 * makes nginx serve it for /c/<slug>, no configuration change, no new service.
 * The app boots and hydrates exactly as before; only the bytes a crawler reads
 * are different.
 *
 * The sitemap is written from the same catalogue, so the 31 pages that sell
 * things stop being the 31 that are missing from it.
 *
 *   node tools/generate-seo.mjs [--api https://…] [--dist client/dist]
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// The rendering is shared with the API, which serves the same pages fresh
// between releases (api/routes/seo-pages.js) — one copy of the rules.
const require = createRequire(import.meta.url);
const { STATIC_PAGES, render, summarise, coursePage, bundlePage, absoluteImage, sitemapXml } = require('../api/lib/seoPages.js');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const API = (arg('api', process.env.SEO_API_BASE || 'https://www.mahadnafsy.com')).replace(/\/$/, '');
const DIST = arg('dist', 'client/dist');
const SITE = (arg('site', 'https://mahadnafsy.com')).replace(/\/$/, '');

async function getJson(path) {
  const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

function writePage(relUrl, html) {
  const dir = join(DIST, relUrl.replace(/^\//, ''));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}

(async () => {
  const shellPath = join(DIST, 'index.html');
  if (!existsSync(shellPath)) {
    console.error(`no shell at ${shellPath} — build the client first`);
    process.exit(1);
  }
  const shell = readFileSync(shellPath, 'utf8');

  const coursesRaw = await getJson('/api/courses?limit=500&offset=0');
  const courses = Array.isArray(coursesRaw) ? coursesRaw : (coursesRaw.items || []);
  const bundles = await getJson('/api/bundles?limit=200');

  const urls = STATIC_PAGES.map(([loc, priority, changefreq]) => ({ loc, priority, changefreq }));
  let pages = 0;

  for (const c of courses) {
    const slug = c.slug || c.id;
    if (!slug) continue;
    const page = coursePage({ ...c, slug }, SITE);
    const html = render(shell, page);
    writePage(page.path, html);
    if (c.id && c.id !== slug) writePage(`/course/${c.id}`, html);
    urls.push({ loc: page.path, priority: '0.8', changefreq: 'weekly' });
    pages++;
  }

  for (const b of bundles) {
    if (!b.id) continue;
    const page = bundlePage(b, SITE, b.courses?.[0]?.thumbnail);
    writePage(page.path, render(shell, page));
    urls.push({ loc: page.path, priority: '0.8', changefreq: 'weekly' });
    pages++;
  }

  // Each community event's page, so a link shared on WhatsApp or Facebook
  // shows the event rather than the front page. Events are optional here: a
  // release is never held up because the list could not be read.
  const events = await getJson('/api/community/events').catch(() => []);
  // The events' folders make /community/events a directory, which nginx
  // answered with a redirect to /community/events/ and then 403 — the list
  // itself needs a page there too.
  writePage('/community/events', render(shell, {
    url: `${SITE}/community/events`,
    title: 'الفعاليات والندوات | معهد الدراسات النفسية',
    description: 'فعاليات وندوات معهد الدراسات النفسية — سجّل اهتمامك وتابع الجديد.',
  }));
  for (const ev of Array.isArray(events) ? events : []) {
    const slug = ev.slug || ev.id;
    if (!slug) continue;
    writePage(`/community/events/${slug}`, render(shell, {
      url: `${SITE}/community/events/${encodeURIComponent(slug)}`,
      title: `${ev.title} | فعاليات معهد الدراسات النفسية`,
      description: summarise(ev.description || ev.content, `${ev.title} — فعالية من معهد الدراسات النفسية.`),
      image: absoluteImage(ev.imageUrl, SITE),
    }));
    urls.push({ loc: `/community/events/${slug}`, priority: '0.6', changefreq: 'weekly' });
    pages++;
  }

  const sitemap = sitemapXml(urls, SITE);
  writeFileSync(join(DIST, 'sitemap.xml'), sitemap);

  console.log(`seo: ${pages} product page(s) prerendered, sitemap has ${urls.length} url(s)`);
  console.log(`     ${courses.length} course(s), ${bundles.length} bundle(s), ${Array.isArray(events) ? events.length : 0} event(s), from ${API}`);
})().catch(err => {
  console.error('seo generation failed:', err.message);
  process.exit(1);
});
