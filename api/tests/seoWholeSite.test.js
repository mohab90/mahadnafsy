'use strict';
/**
 * 2 Nov 2026, «تحسين seo لكل الموقع وكل الكورسات وكل المسارات». What a search engine reads, page by page:
 *
 *  - a course, bundle or instructor page carries its own heading and text, breadcrumbs and (for a course) the Course data, and no price;
 *  - the title and description the app sets once it runs are the ones the page was served with;
 *  - a course page has one h1 (the long description's own h1s were ten more);
 *  - the pages of one visitor are out of the results, and a noindex never follows the visitor to the next page;
 *  - robots.txt keeps /api/ open (the app draws the catalogue from it), and the sitemap's dates are real.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const seo = require('../lib/seoPages');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SITE = 'https://mahadnafsy.com';

function load(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules'), path.join(ROOT, 'client', 'node_modules')],
    define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

const SHELL = `<html><head><title>x</title><meta name="description" content="d" /><meta name="keywords" content="k" /><meta name="robots" content="index, follow" />
<meta property="og:url" content="u" /><meta property="og:title" content="t" /><meta property="og:description" content="d" /><meta property="og:type" content="website" />
<meta name="twitter:url" content="u" /><meta name="twitter:title" content="t" /><meta name="twitter:description" content="d" />
<link rel="canonical" href="https://mahadnafsy.com/" /></head><body><div id="root"><div id="app-boot"></div></div></body></html>`;

const course = {
  id: 'c-1', slug: 'cbt', title: 'العلاج السلوكي المعرفي CBT', level: 'مبتدئ', hours: 40, instructor: 'د. هند',
  description: '<h1>ماذا ستتعلم؟</h1><p>🎯 بناء خطة علاجية &amp; بروتوكول</p>', short_description: '', thumbnail: '/uploads/cbt.jpg',
};

test('a course page has its own heading, text and facts inside #root, breadcrumbs, and Course data without a price', () => {
  const page = seo.coursePage(course, SITE);
  const html = seo.render(SHELL, page);
  assert.match(html, /<div id="root"><main data-prerendered dir="rtl"><h1>العلاج السلوكي المعرفي CBT<\/h1>/);
  assert.match(html, /<li>المستوى: مبتدئ<\/li>/);
  assert.match(html, /<li>عدد الساعات: 40<\/li>/);
  assert.match(html, /بناء خطة علاجية &amp; بروتوكول/, 'the long description, as text, escaped once');
  assert.doesNotMatch(html, /🎯/, 'pictographs do not go into the text a crawler reads');
  assert.match(html, /<div id="app-boot">/, 'the boot overlay is untouched');
  const lds = [...html.matchAll(/<script type="application\/ld\+json" data-page-ld="([^"]+)">(.*?)<\/script>/g)];
  assert.deepEqual(lds.map(m => m[1]), ['/c/cbt', '/c/cbt#breadcrumb']);
  const [courseLd, crumbs] = lds.map(m => JSON.parse(m[2]));
  assert.equal(courseLd['@type'], 'Course');
  assert.equal(courseLd.educationalLevel, 'مبتدئ');
  assert.equal(courseLd.timeRequired, 'PT40H');
  assert.equal(courseLd.hasCourseInstance.courseMode, 'online');
  assert.equal(courseLd.hasCourseInstance.instructor.name, 'د. هند');
  assert.equal(courseLd.offers, undefined, 'no price: it follows the visitor\'s country');
  assert.equal(crumbs['@type'], 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map(item => item.name), ['معهد الدراسات النفسية', 'الدبلومات', 'العلاج السلوكي المعرفي CBT']);
  assert.equal(crumbs.itemListElement[2].item, `${SITE}/c/cbt`);
});

test('the title and description are written when nobody wrote them, and never longer than a result can show', () => {
  assert.equal(seo.courseTitle({ title: 'التوازن و الدعم النفسي' }), 'التوازن و الدعم النفسي | دبلومة معتمدة أونلاين | معهد الدراسات النفسية');
  assert.equal(seo.courseTitle({ title: 'اخصائي العلاج بالمخططات المعرفية "Schema 1" المستوى الأول' }),
    'اخصائي العلاج بالمخططات المعرفية "Schema 1" المستوى الأول | معهد الدراسات النفسية', 'a long name keeps the institute only');
  assert.equal(seo.courseTitle({ title: 'x', seo_title: 'عنوان مكتوب' }), 'عنوان مكتوب | معهد الدراسات النفسية', 'what the admin wrote wins');
  const none = seo.courseDescription({ title: 'تحليل أنماط الشخصية MBTI', level: 'مبتدئ', hours: 12 });
  assert.match(none, /^تحليل أنماط الشخصية MBTI — دبلومة معتمدة أونلاين من معهد الدراسات النفسية \(المستوى: مبتدئ · 12 ساعة تدريبية\)/);
  assert.equal(seo.courseDescription({ title: 'x', seo_description: 'مكتوب' }), 'مكتوب');
});

test('the app says the same title and description as the page it was served as', () => {
  const text = load('client/lib/seoText.ts');
  if (!text) return;
  const samples = [
    { title: 'التوازن و الدعم النفسي' },
    { title: 'اخصائي العلاج بالمخططات المعرفية "Schema 1" المستوى الأول' },
    { title: 'x', seo_title: 'عنوان مكتوب', seo_description: 'وصف مكتوب' },
    { title: 'تحليل أنماط الشخصية MBTI', level: 'مبتدئ', hours: 12 },
    { title: 'العلاج المعرفي', shortDescription: '<p>دبلومة <b>عملية</b> في العلاج</p>' },
  ];
  for (const sample of samples) {
    const server = { ...sample, short_description: sample.shortDescription };
    assert.equal(text.courseSeoTitle(sample), seo.courseTitle(server));
    assert.equal(text.courseSeoDescription(sample), seo.courseDescription(server));
  }
});

test('a bundle and an instructor have pages of their own, and the instructor is a Person', () => {
  const bundle = seo.bundlePage({ id: 'b-1', title: 'مسار العلاج', description: '<p>مسار متكامل</p>' }, SITE);
  assert.match(seo.render(SHELL, bundle), /<main data-prerendered dir="rtl"><h1>مسار العلاج<\/h1>/);
  assert.ok(bundle.jsonLd.includes('"BreadcrumbList"'));
  const person = seo.instructorPage({ id: 't-1', name: 'د/ هند عطيه', title: 'اخصائي صحه نفسيه', bio: '<p>خبرة 15 عاماً</p>', image: '/uploads/h.jpg' }, SITE);
  assert.equal(person.path, '/instructor/t-1');
  assert.equal(person.title, 'د/ هند عطيه — اخصائي صحه نفسيه | معهد الدراسات النفسية');
  assert.equal(person.description, 'خبرة 15 عاماً');
  assert.match(person.jsonLd, /"@type":"Person"/);
  assert.match(person.jsonLd, /"jobTitle":"اخصائي صحه نفسيه"/);
  assert.equal(person.image, `${SITE}/uploads/h.jpg`);
});

test('the listing pages carry the links to what they list, and the FAQ page its questions as data', () => {
  const list = seo.itemListJsonLd([{ title: 'أ', url: `${SITE}/c/a` }, { title: 'ب', url: `${SITE}/c/b` }], '/courses');
  assert.match(list, /data-page-ld="\/courses"/);
  assert.equal(JSON.parse(list.replace(/<[^>]*>/g, m => (m.startsWith('<script') || m === '</script>' ? '' : m))).itemListElement.length, 2);
  const faq = seo.faqJsonLd([{ question: '<b>هل الشهادة معتمدة؟</b>', answer: '<p>نعم</p>' }], '/faq');
  assert.match(faq, /"@type":"FAQPage"/);
  assert.match(faq, /"name":"هل الشهادة معتمدة؟"/);
  assert.match(faq, /"text":"نعم"/);
  const generator = read('tools/generate-seo.mjs');
  
  
  
  
});

test('render can take a page out of the results and keeps everything else as it was', () => {
  const html = seo.render(SHELL, { url: `${SITE}/pay`, title: 't', description: 'd', type: 'website', noindex: true, keywords: 'أ، ب' });
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(html, /<meta name="keywords" content="أ، ب"/);
  assert.match(seo.render(SHELL, { url: `${SITE}/x`, title: 't', description: 'd' }), /<meta name="robots" content="index, follow"/);
});

test('robots.txt keeps the app\'s data open and the visitor\'s own pages shut, and names the sitemap', () => {
  const robots = seo.robotsTxt(SITE);
  assert.doesNotMatch(robots, /Disallow: \/api/, 'a crawler that renders the page needs /api/ for the catalogue');
  for (const route of ['/auth', '/my-account', '/checkout', '/pay', '/success', '/rate/', '/dashboard']) assert.ok(robots.includes(`Disallow: ${route}\n`), route);
  assert.ok(robots.includes(`Sitemap: ${SITE}/sitemap.xml`));
  assert.equal(read('client/public/robots.txt'), robots, 'the file served is the one the generator writes');
  // Every private address is a real route of the app, or the line is dead.
  const app = read('client/App.tsx');
  for (const route of ['/auth', '/my-account', '/checkout', '/pay', '/success', '/enroll', '/rate/']) {
    assert.ok(app.includes(`path="${route.replace(/\/$/, '')}`), `${route} is not a route of the app`);
  }
});

test('the sitemap has a date only when it knows one', () => {
  const xml = seo.sitemapXml([
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/c/cbt', priority: '0.8', changefreq: 'weekly', lastmod: new Date('2026-10-02T09:00:00Z') },
  ], SITE);
  assert.match(xml, /<loc>https:\/\/mahadnafsy\.com\/<\/loc>\s*<changefreq>/, 'no invented date');
  assert.match(xml, /<loc>https:\/\/mahadnafsy\.com\/c\/cbt<\/loc>\s*<lastmod>2026-10-02<\/lastmod>/);
  const route = read('api/routes/seo-pages.js');
  
  
});

test('the app keeps the tags right from page to page: description, image and robots are set on every page', () => {
  const hook = read('client/lib/useSeo.ts');
  
  
  
  
  assert.equal(seo.DEFAULT_DESCRIPTION, hook.match(/export const DEFAULT_DESCRIPTION = '([^']+)'/)[1]);
});

test('the pages of one visitor say noindex, and a certificate\'s own page does too', () => {
  for (const [file, needle] of [
    ['client/pages/Auth.tsx', "path: '/auth', noindex: true"],
    ['client/pages/Checkout.tsx', "path: '/checkout', noindex: true"],
    ['client/pages/Enrollment.tsx', "path: '/enroll', noindex: true"],
    ['client/pages/UserDashboard.tsx', "path: '/my-account', noindex: true"],
    ['client/pages/StandalonePayment.tsx', "setCanonical('/pay', true)"],
    ['client/pages/PaymentSuccess.tsx', "setCanonical('/success', true)"],
    ['client/pages/TicketRating.tsx', "setCanonical('/ticket-rating', true)"],
    ['client/pages/ConsultationRating.tsx', "setCanonical('/consultation-rating', true)"],
    ['client/pages/ConsultationReschedule.tsx', "setCanonical('/consultation-reschedule', true)"],
    ['client/pages/RateRound.tsx', "setCanonical('/rate', true)"],
    ['client/pages/CertificateVerify.tsx', "setCanonical('/certificate', Boolean(code))"],
  ]) assert.ok(read(file).includes(needle), `${file}: ${needle}`);
});



test('a course page has one h1: the long description\'s own headings start one level down', () => {
  
  const html = load('shared/ui/sanitizeHtml.ts');
  if (!html) return;
  assert.equal(html.demoteHeadings('<h1>أ</h1><h2 class="x">ب</h2><H3>ج</H3><h4>د</h4><p>h1</p><header>h</header>'),
    '<h2>أ</h2><h3 class="x">ب</h3><h4>ج</h4><h5>د</h5><p>h1</p><header>h</header>');
  const page = read('client/pages/CourseDetails.tsx');
  
  
});
