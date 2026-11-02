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
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// The rendering is shared with the API, which serves the same pages fresh
// between releases (api/routes/seo-pages.js) — one copy of the rules.
const require = createRequire(import.meta.url);
const {
  STATIC_PAGES, render, summarise, coursePage, bundlePage, instructorPage, absoluteImage, sitemapXml, extractStaticSeo,
  bodyHtml, itemListJsonLd, faqJsonLd, robotsTxt, plainText,
} = require('../api/lib/seoPages.js');

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
    // The list carries no description; the course's own page does. Without it the page's text is the short blurb only.
    const detail = await getJson(`/api/courses/${encodeURIComponent(slug)}`).catch(() => null);
    const page = coursePage({ ...c, slug, description: detail?.description || c.description }, SITE);
    const html = render(shell, page);
    writePage(page.path, html);
    if (c.id && c.id !== slug) writePage(`/course/${c.id}`, html);
    urls.push({ loc: page.path, priority: '0.8', changefreq: 'weekly', lastmod: c.updatedAt || c.createdAt });
    pages++;
  }

  for (const b of bundles) {
    if (!b.id) continue;
    const page = bundlePage(b, SITE, b.courses?.[0]?.thumbnail);
    writePage(page.path, render(shell, page));
    urls.push({ loc: page.path, priority: '0.8', changefreq: 'weekly' });
    pages++;
  }

  // Each instructor's page: a name, a job title and a bio a search engine can match to a person.
  const instructors = await getJson('/api/therapists?limit=200').catch(() => []);
  for (const t of Array.isArray(instructors) ? instructors : []) {
    if (!t.id || !t.name) continue;
    const page = instructorPage(t, SITE);
    writePage(page.path, render(shell, page));
    urls.push({ loc: page.path, priority: '0.6', changefreq: 'monthly' });
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

  // The sections of the site, each with the title, description and canonical its own page sets.
  // '/' keeps the shell's tags and '/community/events' was written above.
  const pagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'pages');
  const seoSources = readdirSync(pagesDir).filter(name => name.endsWith('.tsx'))
    .map(name => ({ file: name, text: readFileSync(join(pagesDir, name), 'utf8') }));
  const sections = extractStaticSeo(seoSources);
  const faqs = await getJson('/api/faq').catch(() => []);
  // The listing pages are the site's table of contents: their body is the links a crawler follows to the products.
  const listings = {
    '/courses': courses.map(c => [`/c/${c.slug || c.id}`, c.title]),
    '/bundles': bundles.map(b => [`/bundle/${b.id}`, b.title]),
    '/instructors': (Array.isArray(instructors) ? instructors : []).filter(t => t.id && t.name).map(t => [`/instructor/${t.id}`, t.name]),
  };
  let sectionPages = 0;
  for (const [loc] of STATIC_PAGES) {
    if (loc === '/' || loc === '/community/events' || !sections[loc]) continue;
    const heading = sections[loc].title.split(' | ')[0];
    const description = sections[loc].description || sections[loc].title;
    const faqList = loc === '/faq' && Array.isArray(faqs) ? faqs.filter(f => f.question && f.answer) : [];
    let jsonLd = '';
    if (listings[loc]?.length) jsonLd = itemListJsonLd(listings[loc].map(([href, title]) => ({ title, url: `${SITE}${href}` })), loc);
    if (faqList.length) jsonLd = faqJsonLd(faqList, loc);
    writePage(loc, render(shell, {
      url: `${SITE}${loc}`, title: sections[loc].title, description, type: 'website', jsonLd,
      body: bodyHtml({
        heading, intro: description,
        sections: faqList.map(f => [plainText(f.question), plainText(f.answer)]),
        links: [...(listings[loc] || []), ['/', 'الرئيسية']],
      }),
    }));
    sectionPages++;
  }
  console.log(`seo: ${sectionPages} section page(s) prerendered (${STATIC_PAGES.length - 1 - sectionPages} keep the shell's tags)`);

  const sitemap = sitemapXml(urls, SITE);
  writeFileSync(join(DIST, 'sitemap.xml'), sitemap);
  writeFileSync(join(DIST, 'robots.txt'), robotsTxt(SITE));

  console.log(`seo: ${pages} product page(s) prerendered, sitemap has ${urls.length} url(s)`);
  console.log(`     ${courses.length} course(s), ${bundles.length} bundle(s), ${Array.isArray(events) ? events.length : 0} event(s), from ${API}`);
})().catch(err => {
  console.error('seo generation failed:', err.message);
  process.exit(1);
});
