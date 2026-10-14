'use strict';

// «صفحات الكورسات في جوجل» (11 Oct 2026): a course published or edited after a
// release has its own page — title, preview, canonical, Course JSON-LD — and its
// place in the sitemap at once, served by the API with nginx falling back to the
// release's files whenever the API does not answer 200.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-seo-pages-secret-0123456789-abcdefghijklmnop';

let courses = [];
const cache = new Map();
const query = async (sql) => {
  if (/FROM courses/.test(sql)) return [courses];
  if (/FROM bundles b/.test(sql)) return [[{ id: 'b-1', title: 'مسار الإرشاد', short_description: 'مسار كامل', thumbnail: null, first_course_thumbnail: '/uploads/c.jpg', updated_at: new Date('2026-10-01T10:00:00Z') }]];
  if (/FROM community_events/.test(sql)) return [[{ id: 'e-1', slug: 'ندوة-القلق' }]];
  return [[]];
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query, execute: query },
  // The real cache's contract: a key holds until a matching prefix is dropped.
  cached: async (key, _ttl, fn) => { if (!cache.has(key)) cache.set(key, await fn()); return cache.get(key); },
  cacheInvalidate: (...prefixes) => { for (const key of [...cache.keys()]) if (prefixes.some(p => key.startsWith(p))) cache.delete(key); },
  requireDb: (_q, _s, n) => n(), isDbDown: () => false,
});

const { cacheInvalidate } = require('../lib/db');
const router = require('../routes/seo-pages');
const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const shellFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seo-shell-')), 'index.html');
process.env.SEO_SHELL_FILE = shellFile;
const shellOf = asset => read('client/index.html').replace('/index.tsx', `/assets/${asset}.js`);
fs.writeFileSync(shellFile, shellOf('index-aaa'));

const handlerOf = route => router.stack.find(l => l.route && l.route.path === route).route.stack.slice(-1)[0].handle;
async function call(route, params = {}) {
  const res = {
    statusCode: 200, body: '', headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    type(value) { this.headers['content-type'] = value; return this; },
    send(body) { this.body = String(body); return this; },
  };
  await handlerOf(route)({ tenantId: 'tenant-default', params, query: {}, headers: {} }, res);
  return res;
}
const PAGE = '/api/seo/page/:kind(c|course|bundle)/:key';
const SITEMAP = '/api/seo/sitemap.xml';

test('a course saved after the release is in the sitemap as soon as the admin saves it', async () => {
  courses = [{ id: 'c-1', slug: 'cbt', title: 'العلاج المعرفي', updated_at: new Date('2026-10-02T09:00:00Z') }];
  let xml = (await call(SITEMAP)).body;
  assert.match(xml, /<loc>https:\/\/mahadnafsy\.com\/c\/cbt<\/loc>\s*<lastmod>2026-10-02<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/mahadnafsy\.com\/bundle\/b-1<\/loc>/);
  assert.match(xml, /<loc>https:\/\/mahadnafsy\.com\/community\/events\/%D9%86%D8%AF/, 'an Arabic slug escaped once');

  courses = [...courses, { id: 'c-2', slug: 'غضب', title: 'إدارة الغضب', updated_at: new Date('2026-10-11T08:00:00Z') }];
  assert.doesNotMatch((await call(SITEMAP)).body, /c-2|%D8%BA%D8%B6%D8%A8/, 'cached until the catalogue changes');
  cacheInvalidate('courses', 'bundles'); // what routes/admin/catalog.js does on every course save
  xml = (await call(SITEMAP)).body;
  assert.match(xml, /\/c\/%D8%BA%D8%B6%D8%A8<\/loc>/);
});

test('its page names it, canonicalises to it, and tells Google it is a course', async () => {
  courses = [{
    id: 'c-1', slug: 'cbt', title: 'العلاج المعرفي', seo_description: 'دبلومة <العلاج> المعرفي السلوكي',
    thumbnail: '/uploads/cbt.jpg', short_description: '',
  }];
  cacheInvalidate('courses');
  const res = await call(PAGE, { kind: 'c', key: 'cbt' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const html = res.body;
  assert.match(html, /<title>العلاج المعرفي \| معهد الدراسات النفسية<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/mahadnafsy\.com\/c\/cbt"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/mahadnafsy\.com\/uploads\/cbt\.jpg"/);
  assert.match(html, /content="دبلومة &lt;العلاج&gt; المعرفي السلوكي"/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"Course".*?)<\/script>/)[1]);
  assert.equal(ld.name, 'العلاج المعرفي');
  assert.equal(ld.provider['@type'], 'EducationalOrganization');
  assert.equal(ld.offers, undefined, 'no price: it follows the visitor\'s country');

  const byId = await call(PAGE, { kind: 'course', key: 'c-1' });
  assert.match(byId.body, /<link rel="canonical" href="https:\/\/mahadnafsy\.com\/c\/cbt"/, '/course/<id> is the same page');
  assert.equal((await call(PAGE, { kind: 'c', key: 'unpublished' })).statusCode, 404, 'nginx then serves the app');
});

test('the page names the live release\'s assets, read again when a release swaps the build', async () => {
  courses = [{ id: 'c-1', slug: 'cbt', title: 'العلاج المعرفي' }];
  cacheInvalidate('courses');
  assert.match((await call(PAGE, { kind: 'c', key: 'cbt' })).body, /\/assets\/index-aaa\.js/);
  fs.writeFileSync(shellFile, `${shellOf('index-bbb')}\n`);
  assert.match((await call(PAGE, { kind: 'c', key: 'cbt' })).body, /\/assets\/index-bbb\.js/);
});

test('no shell is a 503, which nginx answers with the release\'s own page', async () => {
  fs.writeFileSync(shellFile, 'not the app');
  process.env.SEO_SHELL_URL = 'http://127.0.0.1:9/index.html';
  router._test.reset();
  const res = await call(PAGE, { kind: 'c', key: 'cbt' });
  assert.equal(res.statusCode, 503);
  fs.writeFileSync(shellFile, shellOf('index-ccc'));
  delete process.env.SEO_SHELL_URL;
});

test('nginx asks the API first and falls back to the release, and the brand files have a fallback', () => {
  for (const rel of ['deploy/nginx/mahad-web.conf.example', 'deploy/docker/nginx-spa.conf.template']) {
    const conf = read(rel);
    assert.match(conf, /location ~ \^\/\(c\|course\|bundle\)\/\[\^\/\]\+\/\?\$ \{/, rel);
    assert.match(conf, /\/api\/seo\/page\$request_uri;/, `${rel}: the escaped path, as sent`);
    assert.match(conf, /location = \/sitemap\.xml \{/, rel);
    assert.equal(conf.split('error_page 404 429 500 502 503 504 = @').length - 1, 2, rel);
    assert.match(conf, /try_files \$uri @brand_fallback;/, rel);
  }
  assert.match(read('api/lib/registerRoutes.js'), /'\.\.\/routes\/seo-pages'/);
});

test('the release checks an escaped sitemap against the pages it carries', async () => {
  const { findMissingPages } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'tools', 'verifyPrerender.mjs')).href);
  const result = findMissingPages(['./c/غضب/index.html', './sitemap.xml'],
    '<urlset><url><loc>https://mahadnafsy.com/c/%D8%BA%D8%B6%D8%A8</loc></url></urlset>');
  assert.deepEqual(result.missingFromSitemap, []);
});

test('the logo and the share image are the institute\'s own', () => {
  const html = read('client/index.html');
  assert.match(html, /<meta property="og:image" content="https:\/\/mahadnafsy\.com\/brand\/og\.jpg"/);
  assert.match(html, /"logo": "https:\/\/mahadnafsy\.com\/brand\/logo\.png"/);
  assert.doesNotMatch(html, /top4top/);
  // (the certificate carries the logo inside the institute's own design picture)
  for (const rel of ['client/components/Header.tsx', 'client/components/Footer.tsx']) {
    const source = read(rel);
    assert.match(source, /BRAND_LOGO/, rel);
    assert.doesNotMatch(source, /top4top/, rel);
  }
});
