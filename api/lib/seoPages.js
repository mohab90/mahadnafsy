'use strict';
/**
 * Per-page SEO for the client-rendered site: each course and bundle page is the
 * same shell with its own title, description, og:* tags, canonical and Course
 * JSON-LD; the sitemap lists every one of them.
 *
 * Pure on purpose — no database, no network — because two callers share it:
 * tools/generate-seo.mjs, which writes the pages into a release's build, and
 * routes/seo-pages.js, which serves them fresh between releases. «صفحات الكورسات
 * في جوجل» (11 Oct 2026): written only at release time, a course published on
 * Tuesday stayed out of the sitemap, and its page out of Google, until the next
 * release, and an edited title or price kept the old preview.
 */

const SITE_NAME = 'معهد الدراسات النفسية';

const STATIC_PAGES = [
  ['/', '1.0', 'weekly'], ['/courses', '0.9', 'weekly'], ['/bundles', '0.9', 'weekly'],
  ['/consultations', '0.8', 'weekly'], ['/instructors', '0.7', 'monthly'],
  ['/community', '0.6', 'weekly'], ['/community/events', '0.6', 'weekly'],
  ['/community/discussions', '0.5', 'daily'], ['/community/videos', '0.5', 'weekly'],
  ['/community/library', '0.4', 'weekly'], ['/about', '0.5', 'monthly'],
  ['/institute-gallery', '0.4', 'monthly'], ['/faq', '0.4', 'monthly'],
  ['/contact', '0.4', 'monthly'], ['/join', '0.4', 'monthly'],
  ['/join-us', '0.4', 'monthly'], ['/policies', '0.2', 'yearly'],
];

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Strip markup and collapse to a sentence a preview card can hold. */
function summarise(html, fallback, limit = 180) {
  const text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * An image a crawler can fetch: absolute, on the web. A data: URI or a blob is
 * no preview at all, so it is dropped and the shell's own og:image stays.
 */
function absoluteImage(url, site) {
  const value = String(url || '').trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return `${site}${value}`;
  return '';
}

// What a search engine reads as «this page is a course, taught by the
// institute» — the rich result a plain title and description cannot earn. No
// price: the site's price follows the visitor's country.
function courseJsonLd({ name, description, url, image, site }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name,
    description,
    url,
    inLanguage: 'ar',
    ...(image ? { image } : {}),
    provider: {
      '@type': 'EducationalOrganization',
      name: SITE_NAME,
      url: `${site}/`,
      logo: `${site}/brand/logo.png`,
    },
  };
  // A description can hold «</script>»; escaped, it cannot close the tag.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/<\//g, '<\\/')}</script>`;
}

/** Swap the shell's meta block for this page's. */
function render(shell, { url, title, description, image, jsonLd = '' }) {
  const t = esc(title);
  const d = esc(description);
  const u = esc(url);
  let html = String(shell)
    .replace('</head>', `${jsonLd}</head>`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${d}"`)
    .replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${u}"`)
    .replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${t}"`)
    .replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${d}"`)
    .replace(/<meta property="og:type" content="[^"]*"/, '<meta property="og:type" content="article"')
    .replace(/<meta name="twitter:url" content="[^"]*"/, `<meta name="twitter:url" content="${u}"`)
    .replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${t}"`)
    .replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${d}"`)
    .replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${u}"`);
  if (image) {
    html = html
      .replace(/<meta property="og:image" content="[^"]*"/, `<meta property="og:image" content="${esc(image)}"`)
      .replace(/<meta name="twitter:image" content="[^"]*"/, `<meta name="twitter:image" content="${esc(image)}"`);
  }
  return html;
}

/** A course's page: its address, and what the shell is rendered with. */
function coursePage(course, site) {
  const slug = course.slug || course.id;
  const url = `${site}/c/${encodeURIComponent(slug)}`;
  const description = course.seo_description || summarise(course.short_description || course.shortDescription || course.description,
    `${course.title} — دبلومة معتمدة من ${SITE_NAME}.`);
  const image = absoluteImage(course.thumbnail, site);
  return {
    path: `/c/${slug}`,
    url,
    title: `${course.seo_title || course.title} | ${SITE_NAME}`,
    description,
    image,
    jsonLd: courseJsonLd({ name: course.title, description, url, image, site }),
  };
}

function bundlePage(bundle, site, firstCourseThumbnail = '') {
  const url = `${site}/bundle/${encodeURIComponent(bundle.id)}`;
  const description = bundle.seo_description || summarise(bundle.short_description || bundle.shortDescription || bundle.description,
    `${bundle.title} — مسار تعليمي متكامل من ${SITE_NAME}.`);
  const image = absoluteImage(bundle.thumbnail || firstCourseThumbnail, site);
  return {
    path: `/bundle/${bundle.id}`,
    url,
    title: `${bundle.seo_title || bundle.title} — مسار | ${SITE_NAME}`,
    description,
    image,
    jsonLd: courseJsonLd({ name: bundle.title, description, url, image, site }),
  };
}

const ymd = value => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

// Each segment encoded once. A loc is passed as written (an Arabic slug, not
// its %-escapes), so it is never escaped twice.
const encodePath = loc => String(loc).split('/').map(segment => encodeURIComponent(segment)).join('/');

/** urls: [{ loc: '/c/x', priority, changefreq, lastmod? }] — loc relative to the site, unescaped. */
function sitemapXml(urls, site, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(entry => `  <url>
    <loc>${esc(`${site}${entry.loc === '/' ? '/' : encodePath(entry.loc)}`)}</loc>
    <lastmod>${ymd(entry.lastmod) || today}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

module.exports = {
  SITE_NAME,
  STATIC_PAGES,
  absoluteImage,
  bundlePage,
  courseJsonLd,
  coursePage,
  esc,
  render,
  sitemapXml,
  summarise,
};
