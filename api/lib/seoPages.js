'use strict';
/**
 * Per-page SEO for the client-rendered site: each course, bundle and instructor page is the
 * same shell with its own title, description, og:* tags, canonical, JSON-LD and a
 * crawlable body (heading + text), and the sitemap lists every one of them.
 *
 * Pure on purpose — no database, no network — because two callers share it:
 * tools/generate-seo.mjs, which writes the pages into a release's build, and
 * routes/seo-pages.js, which serves them fresh between releases. «صفحات الكورسات
 * في جوجل» (11 Oct 2026): written only at release time, a course published on
 * Tuesday stayed out of the sitemap, and its page out of Google, until the next
 * release, and an edited title or price kept the old preview.
 *
 * 2 Nov 2026 («تحسين seo لكل الموقع وكل الكورسات وكل المسارات»): the pages carried
 * the meta block only, so a crawler that does not run the app (Bing, Facebook, WhatsApp,
 * most AI crawlers) read an empty shell with a spinner. They now also carry the
 * page's own heading and text inside #root — the app replaces them the moment it
 * paints, and the boot overlay covers them until then — plus breadcrumbs, a
 * sitemap whose dates are real, and noindex for the pages no one should find.
 */

const SITE_NAME = 'معهد الدراسات النفسية';
const DEFAULT_DESCRIPTION = 'معهد الدراسات النفسية — رواد التعليم النفسي منذ 2010. دبلومات معتمدة في الصحة النفسية والعلاج النفسي والإرشاد الأسري.';

const STATIC_PAGES = [
  ['/', '1.0', 'weekly'], ['/courses', '0.9', 'weekly'], ['/bundles', '0.9', 'weekly'],
  ['/consultations', '0.8', 'weekly'], ['/instructors', '0.7', 'monthly'],
  ['/community', '0.6', 'weekly'], ['/community/events', '0.6', 'weekly'],
  ['/community/discussions', '0.5', 'daily'], ['/community/videos', '0.5', 'weekly'],
  ['/community/library', '0.4', 'weekly'], ['/about', '0.5', 'monthly'],
  ['/institute-gallery', '0.4', 'monthly'], ['/faq', '0.5', 'monthly'],
  ['/contact', '0.4', 'monthly'], ['/join', '0.4', 'monthly'],
  ['/join-us', '0.4', 'monthly'], ['/policies', '0.2', 'yearly'],
];

// Pages that belong to one visitor (an account, a payment, a rating link). They are in no sitemap, robots.txt keeps crawlers out
// of them, and the app sets noindex on them as well (client/lib/useSeo.ts) for the crawler that arrives by a shared link.
const PRIVATE_PATHS = [
  '/auth', '/my-account', '/checkout', '/pay', '/payments', '/standalone-payment', '/success', '/enroll',
  '/ticket-rating', '/consultation-rating', '/consultation-reschedule', '/rate/', '/dashboard', '/staff/', '/client/',
  '/lead/', '/subscriber/', '/therapist-portal',
];

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Strip markup and collapse to a sentence a preview card can hold. */
function summarise(html, fallback, limit = 180) {
  const text = plainText(html);
  if (!text) return fallback;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Markup, entities and pictographs out: the text a person reads, for a description or the crawlable body. */
function plainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/[\p{Extended_Pictographic}️‍]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
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

/**
 * A JSON-LD script. The path it describes rides on it (data-page-ld) so the app, which swaps pages without reloading, can
 * tell a block that belongs to the page it just left from one that belongs to the page it is on (client/lib/useSeo.ts).
 * A description can hold «</script>»; escaped, it cannot close the tag.
 */
function ldScript(data, path) {
  return `<script type="application/ld+json" data-page-ld="${esc(path)}">${JSON.stringify(data).replace(/<\//g, '<\\/')}</script>`;
}

const provider = site => ({
  '@type': 'EducationalOrganization',
  name: SITE_NAME,
  url: `${site}/`,
  logo: `${site}/brand/logo.png`,
});

// What a search engine reads as «this page is a course, taught by the
// institute» — the rich result a plain title and description cannot earn. No
// price: the site's price follows the visitor's country.
function courseJsonLd({ name, description, url, image, site, path = '', level = '', hours = 0, instructor = '', code = '', keywords = '' }) {
  const workload = Number(hours) > 0 ? `PT${Math.round(Number(hours))}H` : '';
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name,
    description,
    url,
    inLanguage: 'ar',
    ...(image ? { image } : {}),
    ...(code ? { courseCode: code } : {}),
    ...(level ? { educationalLevel: level } : {}),
    ...(keywords ? { keywords } : {}),
    ...(workload ? { timeRequired: workload } : {}),
    provider: provider(site),
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'online',
      ...(workload ? { courseWorkload: workload } : {}),
      ...(instructor ? { instructor: { '@type': 'Person', name: instructor } } : {}),
    },
  };
  return ldScript(data, path || new URL(url).pathname);
}

/** Home > section > this page. `trail` is [[name, absoluteUrl], …] ending with the page itself. */
function breadcrumbJsonLd(trail, path) {
  return ldScript({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, url], index) => ({ '@type': 'ListItem', position: index + 1, name, item: url })),
  }, `${path}#breadcrumb`);
}

/** The catalogue as a list a search engine can follow: [{ title, url }]. */
function itemListJsonLd(items, path) {
  return ldScript({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.title, url: item.url })),
  }, path);
}

/** The questions the FAQ page answers, [{ question, answer }] — what earns the expandable answers in a result. */
function faqJsonLd(faqs, path) {
  return ldScript({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: plainText(f.question), acceptedAnswer: { '@type': 'Answer', text: plainText(f.answer) } })),
  }, path);
}

/** The site itself, once, on the front page. */
function websiteJsonLd(site) {
  return ldScript({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${site}/`,
    inLanguage: 'ar',
    publisher: provider(site),
  }, '/');
}

function personJsonLd({ name, title, bio, image, url, site }, path) {
  return ldScript({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
    ...(title ? { jobTitle: title } : {}),
    ...(bio ? { description: bio } : {}),
    ...(image ? { image } : {}),
    url,
    worksFor: provider(site),
  }, path);
}

/**
 * The page's own words, inside #root. A crawler that does not run the app reads this as the page; the app replaces it when
 * it paints (createRoot), and the boot overlay hides it until then. facts: [[label, value]], sections: [[heading, text]],
 * links: [[href, text]]. Everything is escaped here.
 */
function bodyHtml({ heading, intro = '', facts = [], sections = [], links = [] }) {
  const parts = [`<h1>${esc(heading)}</h1>`];
  if (intro) parts.push(`<p>${esc(intro)}</p>`);
  const shown = facts.filter(([, value]) => String(value || '').trim());
  if (shown.length) parts.push(`<ul>${shown.map(([label, value]) => `<li>${esc(label)}: ${esc(value)}</li>`).join('')}</ul>`);
  for (const [title, text] of sections) {
    if (!String(text || '').trim()) continue;
    parts.push(`<section><h2>${esc(title)}</h2><p>${esc(text)}</p></section>`);
  }
  if (links.length) parts.push(`<nav>${links.map(([href, text]) => `<a href="${esc(href)}">${esc(text)}</a>`).join(' ')}</nav>`);
  return `<main data-prerendered dir="rtl">${parts.join('')}</main>`;
}

/** Swap the shell's meta block for this page's. */
function render(shell, { url, title, description, image, jsonLd = '', type = 'article', noindex = false, keywords = '', body = '' }) {
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
  if (type === 'website') html = html.replace('og:type" content="article"', 'og:type" content="website"');
  if (keywords) html = html.replace(/<meta name="keywords" content="[^"]*"/, `<meta name="keywords" content="${esc(keywords)}"`);
  if (noindex) html = html.replace(/<meta name="robots" content="[^"]*"/, '<meta name="robots" content="noindex, nofollow"');
  if (body) html = html.replace('<div id="root">', () => `<div id="root">${body}`);
  if (image) {
    html = html
      .replace(/<meta property="og:image" content="[^"]*"/, `<meta property="og:image" content="${esc(image)}"`)
      .replace(/<meta name="twitter:image" content="[^"]*"/, `<meta name="twitter:image" content="${esc(image)}"`);
  }
  return html;
}

/**
 * What each page of the app sets for itself with useSeo({ title, path, description }) — read from the page files, so the
 * HTML a crawler fetches (which never runs the app) carries the same title, description and canonical the app sets once
 * it is running. Without it every address outside the catalogue served the homepage's tags: a link to /about shared on
 * WhatsApp previewed as the front page, and its canonical said so. Pages whose path is built at run time (the community
 * sections) are not here and keep the shell's.
 * sources: [{ file, text }]. Returns { '/about': { title, description } }.
 */
function extractStaticSeo(sources) {
  const found = {};
  const pattern = /useSeo\(\{\s*title:\s*'([^']+)',\s*path:\s*'(\/[^']*)'(?:,\s*description:\s*'([^']*)')?/g;
  for (const { text } of sources) {
    for (const match of String(text).matchAll(pattern)) {
      const [, title, pagePath, description] = match;
      if (!found[pagePath]) found[pagePath] = { title, description: description || '' };
    }
  }
  return found;
}

const trim = (value, max) => {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}…`;
};

/**
 * The title a course page gets when its seo_title is empty: the name, what it is, who it is from. Kept in step with the app's
 * own (client/lib/seoText.ts — api/tests/courseSeoTextsMatch.test.js compares them). Under about 70 characters, or the name
 * and the institute only.
 */
function courseTitle(course) {
  const title = String(course.title || '').trim();
  if (course.seo_title) return `${course.seo_title} | ${SITE_NAME}`;
  const full = `${title} | دبلومة معتمدة أونلاين | ${SITE_NAME}`;
  return full.length <= 72 ? full : `${title} | ${SITE_NAME}`;
}

/** What a course page says about itself when nobody wrote a description: the name, the level and the hours, never a made-up claim. */
function courseDescription(course) {
  const title = String(course.title || '').trim();
  const written = course.seo_description || summarise(course.short_description || course.shortDescription || course.description, '');
  if (written) return written;
  const level = String(course.level || '').trim();
  const hours = Number(course.hours) > 0 ? `${Math.round(Number(course.hours))} ساعة تدريبية` : '';
  const facts = [level && `المستوى: ${level}`, hours].filter(Boolean).join(' · ');
  return `${title} — دبلومة معتمدة أونلاين من ${SITE_NAME}${facts ? ` (${facts})` : ''}. سجّل الآن وابدأ التعلّم مع شهادة معتمدة.`;
}

/** A course's page: its address, and what the shell is rendered with. */
function coursePage(rawCourse, site) {
  // Titles are typed by hand and some end in a space: the heading, the data and the title all read the trimmed one.
  const course = { ...rawCourse, title: String(rawCourse.title || '').trim() };
  const slug = course.slug || course.id;
  const url = `${site}/c/${encodeURIComponent(slug)}`;
  const path = `/c/${slug}`;
  const description = courseDescription(course);
  const image = absoluteImage(course.thumbnail, site);
  const keywords = course.seo_keywords || [course.title, 'دبلومة معتمدة', 'دورة أونلاين', 'معهد الدراسات النفسية'].join('، ');
  const body = bodyHtml({
    heading: course.title,
    intro: description,
    facts: [
      ['المستوى', course.level], ['عدد الساعات', Number(course.hours) > 0 ? Math.round(Number(course.hours)) : ''],
      ['المدة', course.duration], ['المحاضر', course.instructor],
    ],
    sections: [['عن الدبلومة', trim(plainText(course.description), 1500)]],
    links: [['/courses', 'كل الدبلومات'], ['/bundles', 'المسارات والباقات'], ['/faq', 'الأسئلة الشائعة'], ['/', SITE_NAME]],
  });
  return {
    path,
    url,
    title: courseTitle(course),
    description,
    image,
    keywords,
    body,
    jsonLd: courseJsonLd({
      name: course.title, description, url, image, site, path,
      level: course.level, hours: course.hours, instructor: course.instructor, code: course.course_code || course.courseCode, keywords,
    }) + breadcrumbJsonLd([[SITE_NAME, `${site}/`], ['الدبلومات', `${site}/courses`], [course.title, url]], path),
  };
}

function bundlePage(rawBundle, site, firstCourseThumbnail = '') {
  const bundle = { ...rawBundle, title: String(rawBundle.title || '').trim() };
  const url = `${site}/bundle/${encodeURIComponent(bundle.id)}`;
  const path = `/bundle/${bundle.id}`;
  const description = bundle.seo_description || summarise(bundle.short_description || bundle.shortDescription || bundle.description,
    `${bundle.title} — مسار تعليمي متكامل من ${SITE_NAME}.`);
  const image = absoluteImage(bundle.thumbnail || firstCourseThumbnail, site);
  const body = bodyHtml({
    heading: bundle.title,
    intro: description,
    sections: [['عن المسار', trim(plainText(bundle.description), 1500)]],
    links: [['/bundles', 'كل المسارات'], ['/courses', 'كل الدبلومات'], ['/faq', 'الأسئلة الشائعة'], ['/', SITE_NAME]],
  });
  return {
    path,
    url,
    title: `${bundle.seo_title || bundle.title} — مسار | ${SITE_NAME}`,
    description,
    image,
    body,
    jsonLd: courseJsonLd({ name: bundle.title, description, url, image, site, path })
      + breadcrumbJsonLd([[SITE_NAME, `${site}/`], ['المسارات', `${site}/bundles`], [bundle.title, url]], path),
  };
}

/** An instructor's page: the name, the job title and the bio, as a Person. */
function instructorPage(instructor, site) {
  const url = `${site}/instructor/${encodeURIComponent(instructor.id)}`;
  const path = `/instructor/${instructor.id}`;
  const name = String(instructor.name || '').trim();
  const title = String(instructor.title || instructor.specialty || '').trim();
  const bio = plainText(instructor.bio);
  const description = summarise(bio, `${name}${title ? ` — ${title}` : ''} من فريق ${SITE_NAME}.`);
  const image = absoluteImage(instructor.image, site);
  return {
    path,
    url,
    title: `${name}${title ? ` — ${trim(title, 40)}` : ''} | ${SITE_NAME}`,
    description,
    image,
    body: bodyHtml({
      heading: name, intro: title, sections: [['نبذة', trim(bio, 1500)]],
      links: [['/instructors', 'كل الخبراء والمدربين'], ['/consultations', 'احجز استشارة'], ['/', SITE_NAME]],
    }),
    jsonLd: personJsonLd({ name, title, bio: description, image, url, site }, path)
      + breadcrumbJsonLd([[SITE_NAME, `${site}/`], ['الخبراء والمدربين', `${site}/instructors`], [name, url]], path),
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

/**
 * urls: [{ loc: '/c/x', priority, changefreq, lastmod? }] — loc relative to the site, unescaped.
 * An entry with no known date has no <lastmod>: a date that is always «today» teaches a crawler to ignore every date.
 */
function sitemapXml(urls, site) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(entry => {
    const lastmod = ymd(entry.lastmod);
    return `  <url>
    <loc>${esc(`${site}${entry.loc === '/' ? '/' : encodePath(entry.loc)}`)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`;
  }).join('\n')}
</urlset>
`;
}

/**
 * The robots.txt: everything public is open, the pages of one visitor are not, and the sitemap is named. /api/ is NOT closed:
 * the app draws the catalogue from it, and a crawler that renders the page is refused its data by a Disallow there.
 */
function robotsTxt(site) {
  return `User-agent: *
Allow: /
${PRIVATE_PATHS.map(p => `Disallow: ${p}`).join('\n')}

Sitemap: ${site}/sitemap.xml
`;
}

module.exports = {
  DEFAULT_DESCRIPTION,
  PRIVATE_PATHS,
  SITE_NAME,
  STATIC_PAGES,
  absoluteImage,
  breadcrumbJsonLd,
  bundlePage,
  courseDescription,
  courseJsonLd,
  coursePage,
  courseTitle,
  extractStaticSeo,
  esc,
  faqJsonLd,
  instructorPage,
  itemListJsonLd,
  plainText,
  render,
  robotsTxt,
  sitemapXml,
  summarise,
  websiteJsonLd,
  bodyHtml,
};
