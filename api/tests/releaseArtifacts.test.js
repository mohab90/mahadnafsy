'use strict';

// Two things this release pass found only by looking at what actually ships.
//
// 1. Release mahad-1ca54e6900a2 shipped /c/dbt and /course/c-1774350781908 as
//    empty directories — Windows Defender deleted the generated pages before tar
//    packed the tree — and nginx answers 403 for a directory with no index. The
//    DBT course page was 403 for every visitor. The release script now reads the
//    finished archive back; this pins that check against the real listing that
//    shipped.
//
// 2. Escaping the welcome message's course title for HTML also escaped it for
//    the subject line and the WhatsApp text, which are plain. Two live titles
//    carry double quotes («… "Schema 1"», «… "Schema 2"») and would have reached
//    students' phones as &quot;Schema 1&quot;.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const loadGate = () => import(pathToFileURL(path.join(ROOT, 'tools', 'verifyPrerender.mjs')).href);

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://mahadnafsy.com/</loc></url>
  <url><loc>https://mahadnafsy.com/courses</loc></url>
  <url><loc>https://mahadnafsy.com/c/cbt</loc></url>
  <url><loc>https://mahadnafsy.com/c/dbt</loc></url>
  <url><loc>https://mahadnafsy.com/bundle/b-1</loc></url>
</urlset>`;

// The shape of the listing that actually shipped, trimmed.
const SHIPPED = [
  './', './index.html', './sitemap.xml', './assets/', './assets/index-abc.js',
  './c/', './c/cbt/', './c/cbt/index.html',
  './c/dbt/',
  './course/', './course/c-1774350781909/', './course/c-1774350781909/index.html',
  './course/c-1774350781908/',
  './bundle/', './bundle/b-1/', './bundle/b-1/index.html',
];

test('the gate refuses the archive that shipped the 403', async () => {
  const { findMissingPages } = await loadGate();
  const result = findMissingPages(SHIPPED, SITEMAP);
  assert.deepEqual(result.emptyDirectories, ['c/dbt', 'course/c-1774350781908']);
  assert.deepEqual(result.missingFromSitemap, ['c/dbt']);
});

test('a complete archive passes', async () => {
  const { findMissingPages } = await loadGate();
  const complete = [...SHIPPED, './c/dbt/index.html', './course/c-1774350781908/index.html'];
  const result = findMissingPages(complete, SITEMAP);
  assert.deepEqual(result, { emptyDirectories: [], missingFromSitemap: [] });
});

test('a page the sitemap lists but the archive lacks entirely is caught too', async () => {
  // That one would fall back to the app shell rather than 403, but the sitemap
  // is still telling Google a page exists that the release does not carry.
  const { findMissingPages } = await loadGate();
  const noBundle = SHIPPED.filter(n => !n.startsWith('./bundle/b-1'));
  const result = findMissingPages([...noBundle, './c/dbt/index.html', './course/c-1774350781908/index.html'], SITEMAP);
  assert.deepEqual(result.missingFromSitemap, ['bundle/b-1']);
});

test('listings from either tar flavour are read the same', async () => {
  // GNU tar prints ./c/dbt/index.html; others print c/dbt/index.html or use \\.
  const { findMissingPages } = await loadGate();
  const bare = SHIPPED.map(n => n.replace(/^\.\//, ''));
  const windows = SHIPPED.map(n => n.replace(/\//g, '\\'));
  assert.deepEqual(findMissingPages(bare, SITEMAP).emptyDirectories, ['c/dbt', 'course/c-1774350781908']);
  assert.deepEqual(findMissingPages(windows, SITEMAP).emptyDirectories, ['c/dbt', 'course/c-1774350781908']);
});

test('the release script checks the packed client archive before recording it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'prepare-release.mjs'), 'utf8');
  assert.match(src, /import \{ describeMissing, findMissingPages \} from '\.\/verifyPrerender\.mjs'/);
  const verify = src.indexOf("if (build.name === 'client') verifyClientArchive(target);");
  const record = src.indexOf('artifacts.push({ component: build.name, path: target });');
  assert.ok(verify > 0, 'the client archive is no longer verified');
  assert.ok(verify < record, 'the archive is recorded as an artifact before it is verified');
  assert.match(src, /throw new Error\(`client archive is incomplete — not releasing/);
});

test('the welcome message escapes for HTML only', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'routes', 'admin', 'subscribers.js'), 'utf8');
  assert.match(src, /const safeTitle = escapeHtml\(courseLabel\);/);
  assert.match(src, /const safeName = escapeHtml\(personName\);/);
  // Plain-text channels take the raw forms.
  assert.match(src, /subject: `تم تسجيلك في \$\{courseLabel\} — معهد الدراسات النفسية`/);
  const whatsapp = src.match(/`مرحباً \$\{(\w+)\} 🎉\\nتم تسجيلك بنجاح في: \$\{(\w+)\}/g) || [];
  assert.equal(whatsapp.length, 2, 'expected both WhatsApp branches');
  for (const line of whatsapp) {
    assert.ok(!/safeName|safeTitle/.test(line), 'a WhatsApp message carries the HTML-escaped form: ' + line);
  }
  // And the HTML body still takes the escaped forms.
  assert.match(src, /<strong>\$\{safeName\}<\/strong>/);
  assert.match(src, /🎓 \$\{safeTitle\}<\/span>/);
});

test('the shell references its icons and manifest by absolute path, and only files that exist', () => {
  // Every course and bundle page is served from /c/<slug>/ (nginx redirects to
  // the trailing slash), so ./favicon.svg there meant /c/<slug>/favicon.svg and
  // came back as the HTML page. And favicon.png never existed at all.
  const shell = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
  const publicDir = path.join(ROOT, 'client', 'public');
  const refs = [...shell.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 3, 'expected the icon, apple-touch-icon and manifest links');
  for (const ref of refs) {
    assert.ok(ref.startsWith('/') && !ref.startsWith('//'), `${ref} is relative — it breaks on every nested page`);
    assert.ok(fs.existsSync(path.join(publicDir, ref.replace(/^\//, ''))), `${ref} is referenced but not in client/public`);
  }
  // App.tsx fills these slots with the branding icon; it only updates tags
  // that exist, so the apple-touch-icon tag has to stay.
  assert.match(shell, /<link rel="apple-touch-icon"/);

  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.json'), 'utf8'));
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(publicDir, icon.src.replace(/^\//, ''))), `manifest icon ${icon.src} does not exist`);
  }
});
