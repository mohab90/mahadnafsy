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
import { join, dirname } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const API = (arg('api', process.env.SEO_API_BASE || 'https://www.mahadnafsy.com')).replace(/\/$/, '');
const DIST = arg('dist', 'client/dist');
const SITE = (arg('site', 'https://mahadnafsy.com')).replace(/\/$/, '');

const STATIC_PAGES = [
  ['/', '1.0', 'weekly'], ['/courses', '0.9', 'weekly'], ['/bundles', '0.9', 'weekly'],
  ['/consultations', '0.8', 'weekly'], ['/instructors', '0.7', 'monthly'],
  ['/community', '0.6', 'weekly'], ['/about', '0.5', 'monthly'],
  ['/institute-gallery', '0.4', 'monthly'], ['/faq', '0.4', 'monthly'],
  ['/contact', '0.4', 'monthly'], ['/join', '0.4', 'monthly'],
  ['/join-us', '0.4', 'monthly'], ['/policies', '0.2', 'yearly'],
];

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Strip markup and collapse to a sentence a preview card can hold. */
const summarise = (html, fallback, limit = 180) => {
  const text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
};

async function getJson(path) {
  const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

/** Swap the shell's meta block for this page's. */
function render(shell, { url, title, description, image }) {
  const t = esc(title);
  const d = esc(description);
  const u = esc(url);
  return shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${d}"`)
    .replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${u}"`)
    .replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${t}"`)
    .replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${d}"`)
    .replace(/<meta property="og:type" content="[^"]*"/, `<meta property="og:type" content="article"`)
    .replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${d}"`)
    .replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${u}"`)
    .replace(image ? /<meta property="og:image" content="[^"]*"/ : /$^/,
      `<meta property="og:image" content="${esc(image)}"`);
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
    const description = summarise(c.shortDescription || c.description,
      `${c.title} — دبلومة معتمدة من معهد الدراسات النفسية.`);
    const html = render(shell, {
      url: `${SITE}/c/${slug}`,
      title: `${c.title} | معهد الدراسات النفسية`,
      description,
      image: c.thumbnail,
    });
    writePage(`/c/${slug}`, html);
    if (c.id && c.id !== slug) writePage(`/course/${c.id}`, html);
    urls.push({ loc: `/c/${slug}`, priority: '0.8', changefreq: 'weekly' });
    pages++;
  }

  for (const b of bundles) {
    if (!b.id) continue;
    const description = summarise(b.shortDescription || b.description,
      `${b.title} — مسار تعليمي متكامل من معهد الدراسات النفسية.`);
    const html = render(shell, {
      url: `${SITE}/bundle/${b.id}`,
      title: `${b.title} — مسار | معهد الدراسات النفسية`,
      description,
      image: b.thumbnail || b.courses?.[0]?.thumbnail,
    });
    writePage(`/bundle/${b.id}`, html);
    urls.push({ loc: `/bundle/${b.id}`, priority: '0.8', changefreq: 'weekly' });
    pages++;
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${SITE}${u.loc === '/' ? '/' : u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
  writeFileSync(join(DIST, 'sitemap.xml'), sitemap);

  console.log(`seo: ${pages} product page(s) prerendered, sitemap has ${urls.length} url(s)`);
  console.log(`     ${courses.length} course(s), ${bundles.length} bundle(s), from ${API}`);
})().catch(err => {
  console.error('seo generation failed:', err.message);
  process.exit(1);
});
