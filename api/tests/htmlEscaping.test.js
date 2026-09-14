'use strict';

// Customer-supplied text rendered into HTML has to be escaped.
//
// The public certificate page is the one that matters. `subscribers.name` is
// whatever the customer typed — registration writes it with a bare `.trim()` —
// and /api/completions/:code/certificate rendered it straight into an HTML
// document served to anyone holding the code. The page's CSP (`script-src
// 'none'`) stops it executing, so this is not account takeover; it is markup
// injected into the institute's own certificate, at the institute's own
// verification URL. A certificate is the product.
//
// There were nine identical `escapeHtml` declarations across the API and the
// one page that needed it had none. Now there is one, in api/lib/html.js, and
// this pins both that it works and that the pages call it.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');
const { escapeHtml, safeUrl } = require('../lib/html');

test('escapeHtml neutralises every character that can leave its context', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  // Attribute context: both quote styles, or the value escapes its attribute.
  assert.equal(escapeHtml('" onmouseover="x'), '&quot; onmouseover=&quot;x');
  assert.equal(escapeHtml("' onfocus='x"), '&#39; onfocus=&#39;x');
  // Ampersand first, or the other replacements get double-decoded.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
  // Arabic passes through untouched — this is an Arabic product.
  assert.equal(escapeHtml('أحمد محمد'), 'أحمد محمد');
});

test('safeUrl admits http(s) and nothing else', () => {
  assert.equal(safeUrl('https://cdn.example.com/logo.png'), 'https://cdn.example.com/logo.png');
  assert.equal(safeUrl('http://example.com/a.png'), 'http://example.com/a.png');
  for (const hostile of [
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    '//evil.example.com/logo.png',
    'vbscript:msgbox(1)',
    '/relative/path.png',
    'https://ok.example.com/a.png" onerror="alert(1)',
    '', null, undefined,
  ]) {
    assert.equal(safeUrl(hostile), '', `safeUrl let through: ${hostile}`);
  }
});

test('the public certificate escapes every value a customer controls', () => {
  const src = read('routes/public.js');

  // The handler must import the shared escaper.
  assert.match(src, /const \{ escapeHtml, safeUrl \} = require\('\.\.\/lib\/html'\)/,
    'public.js does not import the shared escaper');

  // Isolate the certificate handler.
  const start = src.indexOf("router.get('/api/completions/:code/certificate'");
  assert.ok(start > 0, 'the certificate route moved');
  const end = src.indexOf("router.get('/api/referral/my-code'", start);
  const handler = src.slice(start, end > 0 ? end : start + 12000);

  // Only the HTML document itself — the QR payload below is a URL parameter,
  // encoded rather than escaped, and must stay that way.
  const htmlStart = handler.indexOf('const html = `');
  assert.ok(htmlStart > 0, 'the certificate template moved');
  const markup = handler.slice(htmlStart);

  // Nothing a customer or an admin can set may reach the markup raw.
  for (const name of ['studentName', 'courseName', 'instituteName', 'serialNo', 'trainingMgr']) {
    const raw = new RegExp('\\$\\{' + name + '(?:\\.toUpperCase\\(\\))?\\}');
    assert.ok(!raw.test(markup),
      `${name} is interpolated into the certificate without escapeHtml`);
  }
  // The logo is a URL, so it takes the URL guard rather than the text one.
  assert.ok(!/\$\{LOGO_URL\}/.test(markup),
    'LOGO_URL goes into an img src without safeUrl');
  assert.match(markup, /\$\{safeUrl\(LOGO_URL\)\}/);
  assert.match(markup, /\$\{escapeHtml\(studentName\)\}/);
  assert.match(markup, /\$\{escapeHtml\(courseName\)\}/);

  // The QR payload is a URL parameter, not markup — encoded, not escaped.
  assert.match(handler, /encodeURIComponent\(`CERT:\$\{certCode\}\|\$\{studentName\}/);
});

test('there is exactly one escapeHtml in the API', () => {
  // Nine copies is nine answers to "is this page escaped". The certificate's
  // answer was "there is no escaper here at all".
  const declarations = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (/^const escapeHtml = |^function escapeHtml\b/m.test(fs.readFileSync(full, 'utf8'))) {
        declarations.push(path.relative(API, full).split(path.sep).join('/'));
      }
    }
  };
  walk(API);
  assert.deepEqual(declarations, ['lib/html.js'],
    'escapeHtml is declared in more than one place again');
});

test('customer names in HTML mail are escaped', () => {
  // Mail clients do not run script, so this is markup injection rather than
  // takeover — but a lead who names themselves with a closing tag rewrites the
  // message a salesperson is reading.
  const pins = [
    ['routes/misc/_shared.js', '${escapeHtml(lead.name)}'],
    ['routes/misc/_shared.js', '${escapeHtml(p.name)}'],
    ['routes/public-orders.js', "${escapeHtml(order.customer_name || 'عزيزنا')}"],
    ['lib/lifecycle.js', "${escapeHtml(c.name || '')}"],
    ['routes/admin/subscribers.js', "const safeName = escapeHtml((name || 'عزيزنا').trim());"],
  ];
  for (const [rel, needle] of pins) {
    assert.ok(read(rel).includes(needle), `${rel} lost: ${needle}`);
  }
});

test('the WhatsApp templates are NOT html-escaped', () => {
  // The same file carries both. Escaping a WhatsApp body ships «&amp;» to the
  // customer's phone — the fix for one channel is a bug in the other.
  const src = read('lib/lifecycle.js');
  const templates = src.match(/build:\s*\(c\)\s*=>\s*`(?:[^`\\]|\\.)*`/g) || [];
  const whatsapp = templates.filter(t => !/<(?:p|div|b|a|br|h[1-6]|table|strong)\b/i.test(t));
  assert.ok(whatsapp.length >= 5, 'expected several plain-text templates; the shape changed');
  for (const t of whatsapp) {
    assert.ok(!t.includes('escapeHtml'),
      'a plain-text WhatsApp body was html-escaped:\n' + t.slice(0, 120));
  }
});
