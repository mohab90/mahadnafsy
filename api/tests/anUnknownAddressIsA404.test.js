'use strict';
/**
 * An unknown address answers 404, not 200 (31 Oct 2026 audit).
 *
 *   curl -s -o /dev/null -w "%{http_code}" https://mahadnafsy.com/no-such-page-xyz   ->  200
 *
 * nginx's catch-all was `try_files $uri $uri/ /index.html`, so every mistyped, removed or probed address was a page of the
 * site as far as Google was concerned (a soft 404). Now the addresses the app has are listed in nginx and everything else
 * is served the app's own «not found» page with a 404 status. The list has to follow the app, so this reads client/App.tsx
 * and fails when a route is added there and not in nginx — a real page answering 404 is a worse bug than the one fixed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const CONFS = ['deploy/nginx/mahad-web.conf.example', 'deploy/docker/nginx-spa.conf.template'];

const appSegments = () => {
  const found = new Set();
  for (const match of read('client/App.tsx').matchAll(/<Route path="\/([^"/:*]+)[^"]*"/g)) found.add(match[1]);
  return [...found];
};

const listed = conf => {
  const match = conf.match(/location ~ \^\/\(([^)]+)\)\(\/\|\$\) \{/);
  assert.ok(match, 'the known-routes location');
  return match[1].split('|');
};

test('the app has routes (the scan is not reading nothing)', () => {
  assert.ok(appSegments().length > 30);
});

for (const rel of CONFS) {
  test(`${rel}: every first segment the app routes is listed, and nothing else is`, () => {
    const conf = read(rel);
    const known = listed(conf);
    const missing = appSegments().filter(segment => !known.includes(segment));
    assert.deepEqual(missing, [], `routes in client/App.tsx that nginx would answer 404: ${missing.join(', ')}`);
    const extra = known.filter(segment => !appSegments().includes(segment));
    assert.deepEqual(extra, [], `listed in nginx but not routed by the app: ${extra.join(', ')}`);
  });

  test(`${rel}: the catch-all is a 404 with the app's page, and the pages the app has are 200`, () => {
    const conf = read(rel);
    const catchAll = conf.slice(conf.indexOf('location / {'));
    const body = catchAll.slice(0, catchAll.indexOf('\n    }'));
    assert.match(body, /try_files \$uri \$uri\/index\.html =404;/);
    assert.match(body, /error_page 404 \/index\.html;/);
    assert.match(body, /Cache-Control "no-store"/);
    const known = conf.slice(conf.indexOf('location ~ ^/(eg|'));
    assert.match(known.slice(0, known.indexOf('\n    }')), /try_files \$uri \$uri\/index\.html \/index\.html;/);
    // The product regex (and so the API's fresh page) is declared first: nginx takes the first regex that matches.
    assert.ok(conf.indexOf('location ~ ^/(c|course|bundle)/') < conf.indexOf('location ~ ^/(eg|'));
  });

  test(`${rel}: the fallback for a prerendered folder does not redirect to a trailing slash`, () => {
    const conf = read(rel);
    assert.match(conf, /location @(release|build)_files \{\n\s+try_files \$uri \$uri\/index\.html \/index\.html;/);
  });
}

// The other half: the pages the app does have carry their own tags in the HTML a crawler fetches.
const { extractStaticSeo, STATIC_PAGES, render } = require('../lib/seoPages');

test('the sections of the site have their own title, description and canonical in the prerendered HTML', () => {
  const dir = path.join(ROOT, 'client', 'pages');
  const sections = extractStaticSeo(fs.readdirSync(dir).filter(name => name.endsWith('.tsx'))
    .map(name => ({ file: name, text: fs.readFileSync(path.join(dir, name), 'utf8') })));
  for (const loc of ['/about', '/courses', '/bundles', '/consultations', '/instructors', '/contact', '/policies', '/join', '/join-us', '/institute-gallery']) {
    assert.ok(sections[loc]?.title, `${loc} has a title in its page`);
    assert.ok(STATIC_PAGES.some(([page]) => page === loc), `${loc} is a sitemap page`);
  }
  const html = render('<head><title>x</title><meta name="description" content="x"><meta property="og:type" content="website"><link rel="canonical" href="https://mahadnafsy.com/"></head>',
    { url: 'https://mahadnafsy.com/about', title: sections['/about'].title, description: sections['/about'].description, type: 'website' });
  assert.match(html, /<link rel="canonical" href="https:\/\/mahadnafsy\.com\/about"/);
  assert.match(html, /og:type" content="website"/);
  assert.ok(html.includes(sections['/about'].title));
});
