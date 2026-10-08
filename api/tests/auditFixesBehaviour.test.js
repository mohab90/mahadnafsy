'use strict';
/**
 * Behavioural tests for the fixes that followed the 2 Oct 2026 audit. These run
 * the code — none of them reads a source file and looks for a pattern.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'audit-fixes-behaviour-test-secret-0123456789';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

async function withServer(app, fn) {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

// ── body sanitizer ───────────────────────────────────────────────────────────
const { sanitizeBody, latinDigits } = require('../middleware/sanitize');
const sanitizeApp = () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(sanitizeBody);
  app.post('/x', (req, res) => res.json(req.body));
  return app;
};
const post = (base, body, headers = {}) => fetch(`${base}/x`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('a list over the limit is refused, not silently cut to the first 1000', async () => {
  await withServer(sanitizeApp(), async base => {
    const ok = await post(base, { rows: Array.from({ length: 2000 }, (_, i) => ({ i })) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).rows.length, 2000, 'a 2,000-row import arrives whole');
    const tooMany = await post(base, { ids: Array.from({ length: 6000 }, (_, i) => i) });
    assert.equal(tooMany.status, 413);
    assert.equal((await tooMany.json()).code, 'BODY_TOO_LARGE');
  });
});

test('Arabic-Indic digits are made Latin in phone and amount fields only', async () => {
  await withServer(sanitizeApp(), async base => {
    const got = await (await post(base, {
      phone: '٠١٠١٢٣٤٥٦٧٨', whatsapp: '+٢٠ ١٠١٢٣٤٥٦٧٨', amount: '١٢٥٠٫٥', notes: 'دفع ٣ أقساط',
      nested: { customerPhone: '۰۱۰۱۲۳۴۵۶۷۸' },
    })).json();
    assert.equal(got.phone, '01012345678');
    assert.equal(got.whatsapp, '+20 1012345678');
    assert.equal(got.amount, '1250.5');
    assert.equal(got.nested.customerPhone, '01012345678');
    assert.equal(got.notes, 'دفع ٣ أقساط', 'the same digits inside a note are the writer\'s own');
  });
  assert.equal(latinDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
});

test('a phone typed in Arabic digits is a real phone to the identity rules', () => {
  const { isRealPhone, toIdentity, identitySpellings } = require('../lib/phoneNumber');
  assert.equal(isRealPhone('٠١٠١٢٣٤٥٦٧٨'), true);
  assert.equal(toIdentity('٠١٠١٢٣٤٥٦٧٨'), toIdentity('01012345678'));
  assert.ok(identitySpellings('٠١٠١٢٣٤٥٦٧٨').includes('201012345678'));
});

// ── text sanitiser ───────────────────────────────────────────────────────────
test('sanitize strips markup and leaves ordinary text alone', () => {
  const { sanitize } = require('../lib/helpers');
  assert.equal(sanitize('Condition=cash, section=3'), 'Condition=cash, section=3');
  assert.equal(sanitize('السعر <500 أو >200 كاش'), 'السعر <500 أو >200 كاش');
  assert.equal(sanitize('hi <b onclick="x">there</b> <script>alert(1)</script>ok'), 'hi there ok');
  assert.equal(sanitize('<img src=x onerror=alert(1)>'), '');
  assert.equal(sanitize('<!-- note -->kept'), 'kept');
});

// ── IP whitelist, both families ──────────────────────────────────────────────
test('the IP whitelist matches IPv6 addresses and prefixes as well as IPv4', () => {
  const { matches } = require('../middleware/ipWhitelist')._test;
  assert.equal(matches('197.1.2.3', '197.1.2.0/24'), true);
  assert.equal(matches('197.1.3.3', '197.1.2.0/24'), false);
  assert.equal(matches('2001:db8::1', '2001:db8::/32'), true);
  assert.equal(matches('2001:db9::1', '2001:db8::/32'), false);
  assert.equal(matches('2001:db8:0:0:0:0:0:1', '2001:db8::1'), true);
  assert.equal(matches('::ffff:197.1.2.3', '197.1.2.3'), true);
  assert.equal(matches('2001:db8::1', '197.1.2.3'), false, 'families never match each other');
  assert.equal(matches('2001:db8::1', '2001:db8::/129'), false);
});

// ── cross-site writes with the session cookie ────────────────────────────────
test('a write from another site that carries the session cookie is refused', async () => {
  const prior = process.env.ALLOWED_ORIGINS;
  const priorEnforce = process.env.CSRF_ORIGIN_ENFORCE;
  process.env.ALLOWED_ORIGINS = 'https://admin.example.com';
  process.env.CSRF_ORIGIN_ENFORCE = 'true';
  try {
    const { csrfOriginGuard } = require('../lib/httpApp');
    const app = express();
    app.use(csrfOriginGuard());
    app.all('/w', (_req, res) => res.json({ ok: true }));
    await withServer(app, async base => {
      const call = (method, headers) => fetch(`${base}/w`, { method, headers });
      const cookie = { cookie: 'authToken=abc' };
      assert.equal((await call('POST', { ...cookie, origin: 'https://evil.example' })).status, 403);
      assert.equal((await call('POST', { ...cookie, origin: 'https://admin.example.com' })).status, 200, 'the listed origin');
      assert.equal((await call('POST', { ...cookie, origin: base })).status, 200, 'same origin as the host asked');
      assert.equal((await call('GET', { ...cookie, origin: 'https://evil.example' })).status, 200, 'reads are not writes');
      assert.equal((await call('POST', { origin: 'https://evil.example' })).status, 200, 'no cookie: a webhook, nothing to forge');
      assert.equal((await call('POST', cookie)).status, 200, 'no Origin: not a browser cross-site write');
    });
  } finally {
    if (prior === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = prior;
    if (priorEnforce === undefined) delete process.env.CSRF_ORIGIN_ENFORCE; else process.env.CSRF_ORIGIN_ENFORCE = priorEnforce;
  }
});

// MED-12 of the 7 Oct 2026 audit: enforcement is the default; only an explicit
// false leaves it report-only.
test('unset, an unlisted origin is refused; set to false, it is reported, not blocked', async () => {
  const priorEnforce = process.env.CSRF_ORIGIN_ENFORCE;
  try {
    const { csrfOriginGuard } = require('../lib/httpApp');
    const app = express();
    app.use(csrfOriginGuard());
    app.all('/w', (_req, res) => res.json({ ok: true }));
    await withServer(app, async base => {
      const write = () => fetch(`${base}/w`, { method: 'POST', headers: { cookie: 'authToken=abc', origin: 'https://evil.example' } });
      delete process.env.CSRF_ORIGIN_ENFORCE;
      assert.equal((await write()).status, 403);
      process.env.CSRF_ORIGIN_ENFORCE = 'false';
      assert.equal((await write()).status, 200);
    });
  } finally {
    if (priorEnforce === undefined) delete process.env.CSRF_ORIGIN_ENFORCE; else process.env.CSRF_ORIGIN_ENFORCE = priorEnforce;
  }
});

// ── staff addresses ──────────────────────────────────────────────────────────
test('a staff address, or an administrator address, is never given a customer login', async () => {
  const { staffOwnsEmail } = require('../lib/staffEmailGuard');
  const db = { async query(_sql, params) { return [[params[1] === 'manager@inst.com' ? { id: 's1' } : undefined]]; } };
  assert.equal(await staffOwnsEmail(db, 't1', ' Manager@Inst.com '), true, 'case and spaces do not hide it');
  assert.equal(await staffOwnsEmail(db, 't1', 'customer@x.com'), false);
  assert.equal(await staffOwnsEmail(db, 't1', 'owner@x.com', ['OWNER@x.com']), true, 'ADMIN_EMAILS count');
  assert.equal(await staffOwnsEmail(db, 't1', ''), false);
});

// ── rate limit key ───────────────────────────────────────────────────────────
test('the admin limiter keys on the verified user, so one office address is not one bucket', () => {
  const { keyBy } = require('../middleware/rateLimits');
  const req = uid => ({ tenantId: 't', ip: '10.0.0.1', method: 'GET', baseUrl: '/api/admin', path: '/leads', signedUid: uid });
  assert.notEqual(keyBy('user')(req('u1')), keyBy('user')(req('u2')));
  assert.equal(keyBy('user')(req('u1')), keyBy('user')(req('u1')));
});

// ── lead identity spellings ──────────────────────────────────────────────────
test('finding a lead by phone looks under every spelling of the number', async () => {
  const { findLeadByIdentity } = require('../lib/leadRepository');
  let seen;
  const db = { async query(sql, params) { seen = { sql, params }; return [[undefined]]; } };
  await findLeadByIdentity({ tenantId: 't1', phone: '01012345678', db });
  assert.match(seen.sql, /phone IN \(/);
  for (const spelling of ['01012345678', '1012345678', '201012345678']) assert.ok(seen.params.includes(spelling), spelling);
});
