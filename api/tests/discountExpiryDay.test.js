'use strict';

// «تاريخ الانتهاء» is a date an admin picks from a date field, and it means the
// offer runs through that day. Four places decided it and two of them decided
// it differently: the public route and the two customer pages compared instants
// — Date.parse('2026-09-15') is midnight UTC — so the offer left the site at
// 02:00 or 03:00 Cairo on the morning of the day it was meant to run, while the
// admin's own list, comparing date strings, still had it under «الخصومات
// النشطة». The admin's string was the UTC day too, so it had a mirror-image
// error of its own between midnight and 02:00 Cairo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dateOnlyInTimeZone } = require('../lib/dates');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

const loadShared = rel => {
  const js = require('node:module').stripTypeScriptTypes(read(rel)).replace(/^export /gm, '');
  const module_ = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${js}\nmodule.exports = { cairoDateOnly, isExpiryActive };`)(module_, module_.exports);
  return module_.exports;
};

test('an offer dated today is still running at 00:30 Cairo and at 23:30 Cairo', () => {
  const { isExpiryActive } = loadShared('shared/cairoDate.ts');

  // 2026-09-15 00:30 Cairo is 2026-09-14 21:30 UTC — the window where the old
  // admin check called yesterday "today".
  assert.equal(isExpiryActive('2026-09-15', '2026-09-14T21:30:00.000Z'), true);
  // 2026-09-15 03:00 Cairo is 2026-09-15 00:00 UTC — the exact instant the old
  // public route dropped the offer.
  assert.equal(isExpiryActive('2026-09-15', '2026-09-15T00:00:00.000Z'), true);
  // 2026-09-15 23:30 Cairo — still the 15th, still running.
  assert.equal(isExpiryActive('2026-09-15', '2026-09-15T20:30:00.000Z'), true);
  // 2026-09-16 00:30 Cairo — the day is over.
  assert.equal(isExpiryActive('2026-09-15', '2026-09-15T21:30:00.000Z'), false);
  // No expiry means no expiry.
  assert.equal(isExpiryActive('', '2026-09-15T00:00:00.000Z'), true);
  assert.equal(isExpiryActive(null, '2026-09-15T00:00:00.000Z'), true);
  // A stored datetime still answers on its date half.
  assert.equal(isExpiryActive('2026-09-15T00:00:00.000Z', '2026-09-15T20:30:00.000Z'), true);
});

test('cairoDateOnly names the Cairo day, not the UTC one', () => {
  const { cairoDateOnly } = loadShared('shared/cairoDate.ts');
  assert.equal(cairoDateOnly('2026-09-14T21:30:00.000Z'), '2026-09-15');
  assert.equal(cairoDateOnly('2026-09-15T20:30:00.000Z'), '2026-09-15');
  // Matches what the server already uses for the same question.
  assert.equal(cairoDateOnly('2026-09-14T21:30:00.000Z'), dateOnlyInTimeZone(new Date('2026-09-14T21:30:00.000Z')));
});

test('the public discounts route compares the Cairo day, not an instant', () => {
  const route = codeOnly(read('api/routes/config.js'));
  assert.match(route, /const today = dateOnlyInTimeZone\(\);/);
  assert.match(route, /String\(rule\.expiresAt\)\.slice\(0, 10\) >= today/);
  assert.ok(!route.includes('Date.parse(rule.expiresAt)'),
    'the route still drops an offer at midnight UTC');
});

test('all four screens judge the expiry the same way', () => {
  for (const rel of [
    'client/pages/CourseDetails.tsx',
    'client/pages/Home.tsx',
    'admin/pages/dashboard/tabs/courses/DiscountsView.tsx',
  ]) {
    const source = codeOnly(read(rel));
    assert.match(source, /isExpiryActive\(/, `${rel} does not use the shared rule`);
    assert.ok(!/new Date\(d\.expiresAt\) >= now/.test(source), `${rel} still compares instants`);
    assert.ok(!/expiresAt >= new Date\(\)\.toISOString\(\)/.test(source), `${rel} still uses the UTC day`);
    assert.ok(!/expiresAt < new Date\(\)\.toISOString\(\)/.test(source), `${rel} still uses the UTC day`);
  }
});

test("the customer's certificate requests carry the note an admin wrote them", () => {
  const { mapSubscriber } = require('../lib/mappers');
  const mapped = mapSubscriber({
    id: 's1', name: 'عميل', enrollments: [], payments: [],
    certRequests: [{
      id: 'cr-1', type: 'OTHER', status: 'PRICED', price: '250.00', currency: 'EGP',
      admin_note: 'برجاء إرسال صورة البطاقة', issued_at: '2026-09-01', c_title: 'دبلومة الإرشاد',
      requested_at: '2026-08-20',
    }],
  });
  // The screen renders req.adminNote on this list and it was never sent, so the
  // paragraph an admin wrote the customer never drew for them.
  const [request] = mapped.extraCertificateRequests;
  assert.equal(request.adminNote, 'برجاء إرسال صورة البطاقة');
  assert.equal(request.issuedAt, '2026-09-01');
  assert.equal(request.courseTitle, 'دبلومة الإرشاد');
  // And the parts that already worked still do.
  assert.equal(request.status, 'priced');
  assert.equal(request.price, 250);
});
