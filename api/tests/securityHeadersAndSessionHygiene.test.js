'use strict';
/**
 * Security headers and session hygiene (22 Oct 2026 review):
 *   - the site and the admin get HSTS, nosniff, framing, referrer and
 *     permissions headers from nginx, in every location (nginx drops server-
 *     level add_header in a location with its own), and a full CSP that only
 *     reports — to /api/security/csp-report — until it is shown not to break
 *     the analytics, embeds and checkout;
 *   - a course page served through the API (routes/seo-pages.js) no longer
 *     carries the API's own CSP, which forbade every script on it;
 *   - a cross-site write with the session cookie and no Origin is refused on
 *     Sec-Fetch-Site;
 *   - the session cookie stays HttpOnly + Secure.
 * Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-headers-secret-0123456789-abcdefghijklmnop';

const root = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('the header snippet enforces what cannot break a page and reports the rest', () => {
  const snippet = read('deploy/nginx/mahad-security-headers.conf');
  assert.match(snippet, /Strict-Transport-Security "max-age=31536000; includeSubDomains" always/);
  assert.match(snippet, /X-Content-Type-Options "nosniff" always/);
  assert.match(snippet, /X-Frame-Options "SAMEORIGIN" always/);
  assert.match(snippet, /Referrer-Policy "strict-origin-when-cross-origin" always/);
  assert.match(snippet, /Permissions-Policy "[^"]*payment=\(self\)/);
  assert.match(snippet, /add_header Content-Security-Policy "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" always/);
  const reportOnly = snippet.match(/Content-Security-Policy-Report-Only "([^"]+)"/);
  assert.ok(reportOnly, 'the full policy is report-only');
  for (const needed of ['https://www.googletagmanager.com', 'https://connect.facebook.net', 'https://accept.paymob.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'report-uri /api/security/csp-report']) {
    assert.ok(reportOnly[1].includes(needed), `the report-only policy allows/names ${needed}`);
  }
});

for (const [rel, include] of [
  ['deploy/nginx/mahad-web.conf.example', 'include snippets/mahad-security-headers.conf;'],
  ['deploy/docker/nginx-spa.conf.template', 'include /etc/nginx/snippets/mahad-security-headers.conf;'],
]) {
  test(`${rel}: every location that sets its own header includes the security headers`, () => {
    const conf = read(rel);
    const locations = conf.split(/\n\s*location /).slice(1);
    for (const block of locations) {
      const body = block.slice(0, block.indexOf('\n    }') + 1 || undefined);
      if (/add_header/.test(body) || /error_page [^\n]*@(release|build)_files/.test(body)) {
        assert.ok(body.includes(include), `location ${body.split('\n')[0]} drops the security headers`);
      }
    }
  });
}

test('the docker image carries the snippet it includes', () => {
  assert.match(read('deploy/docker/Dockerfile.static'), /COPY deploy\/nginx\/mahad-security-headers\.conf \/etc\/nginx\/snippets\/mahad-security-headers\.conf/);
});

test('a course page from the API sheds the API\'s CSP, which forbade every script on it', () => {
  const source = read('api/routes/seo-pages.js');
  assert.match(source, /for \(const header of \['Content-Security-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy', 'X-Frame-Options'\]\)/);
  assert.match(source, /res\.removeHeader\(header\)/);
  // The API's own policy is still strict for its JSON.
  assert.match(read('api/lib/httpApp.js'), /scriptSrc: \["'none'"\]/);
});

function post(port, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/w', method: 'POST', headers }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end('{}');
  });
}

test('a cross-site write with the session cookie and no Origin is refused on Sec-Fetch-Site', async () => {
  const priorEnforce = process.env.CSRF_ORIGIN_ENFORCE;
  delete process.env.CSRF_ORIGIN_ENFORCE;
  const { csrfOriginGuard } = require('../lib/httpApp');
  const app = express();
  app.use(csrfOriginGuard());
  app.all('/w', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const cookie = 'authToken=abc';
    assert.equal(await post(port, { cookie, 'sec-fetch-site': 'cross-site' }), 403);
    assert.equal(await post(port, { cookie, 'sec-fetch-site': 'same-origin' }), 200);
    assert.equal(await post(port, { cookie, 'sec-fetch-site': 'same-site' }), 200, 'admin.<domain> to <domain> is the same site');
    assert.equal(await post(port, { cookie }), 200, 'a script with neither header is not a browser');
    assert.equal(await post(port, { 'sec-fetch-site': 'cross-site' }), 200, 'no session: nothing to forge');
    process.env.CSRF_ORIGIN_ENFORCE = 'false';
    assert.equal(await post(port, { cookie, 'sec-fetch-site': 'cross-site' }), 200, 'report-only mode stays report-only');
  } finally {
    server.close();
    if (priorEnforce === undefined) delete process.env.CSRF_ORIGIN_ENFORCE; else process.env.CSRF_ORIGIN_ENFORCE = priorEnforce;
  }
});

test('the session cookie is HttpOnly and Secure', () => {
  const token = read('api/lib/token.js');
  assert.match(token, /`authToken=\$\{token\}; HttpOnly; Path=\/; Max-Age=\$\{maxAge\}; SameSite=None; Secure`/);
});

test('CSP reports are accepted and logged, and the route is rate limited', () => {
  const source = read('api/routes/monitoring.js');
  assert.match(source, /router\.post\('\/api\/security\/csp-report', publicLimiter, cspReportBody,/);
  assert.match(source, /type: \['application\/csp-report', 'application\/reports\+json', 'application\/json'\], limit: '16kb'/);
  assert.match(source, /res\.status\(204\)\.end\(\)/);
});
