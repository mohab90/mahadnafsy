'use strict';
/**
 * 29 Oct 2026: «بنرفع قسط شهاده يروح يسمع الفلوس في الكورس وبلغي الشهاده … دي حسابات مش لعبه».
 *
 * A certificate payment names the client's course («الكورس المرتبط») — it has to, the certificate is for that course — and it
 * carries the certificate's price in course_expected. Every place that totals what a course was paid, or what it costs, took those
 * rows for the course's own money (lib/agreedPrice.js ITEM_PAYMENT_TYPES already said they are not, and only some queries listened):
 *   - the course's agreed price became the certificate's if that was higher, and its «paid» included the certificate instalment;
 *   - the instalment plan of the course took the certificate's price as the course price;
 *   - the automatic certificate sweep counted the certificate money as the course's and issued on it;
 *   - voiding or refunding the certificate instalment closed the course (revokeAccessWithoutOtherGrant) and revoked the certificate
 *     already issued on it, and an instalment still standing kept a refunded course open.
 * The money rules (agreed price, paid, the sweep, voiding) are asserted on a real database in
 * integration/certificateMoneyIsNotCourseMoney.integration.test.js; what stays here is what a refund and a payment correction look up.
 * Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-certificate-secret-0123456789-abcdefghijk';

const flat = sql => String(sql).replace(/\s+/g, ' ').trim();
const ITEM_FILTER = /payment_type IS NULL OR (?:p\.)?payment_type IN \('COURSE','BUNDLE','OTHER'\)/;

test('taking back a certificate instalment leaves the course and its certificate as they are', async () => {
  const { revokeAccessWithoutOtherGrant } = require('../lib/refunds');
  const queries = [];
  const conn = { async query(sql) { queries.push(flat(sql)); return [[]]; } };
  await revokeAccessWithoutOtherGrant(conn, {
    tenantId: 't', actor: 'a',
    pay: { id: 'p1', subscriber_id: 's', course_id: 'c1', bundle_id: null, payment_type: 'CERTIFICATE' },
  });
  assert.deepEqual(queries, [], 'nothing is looked up, so nothing is revoked');
});

test('a course payment that is taken back still looks for another payment of the COURSE, never a certificate, a book or a carnet', async () => {
  const { revokeAccessWithoutOtherGrant } = require('../lib/refunds');
  const queries = [];
  const conn = { async query(sql) { queries.push(flat(sql)); return [[{ id: 'p2' }]]; } };
  await revokeAccessWithoutOtherGrant(conn, {
    tenantId: 't', actor: 'a',
    pay: { id: 'p1', subscriber_id: 's', course_id: 'c1', bundle_id: null, payment_type: 'COURSE' },
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0], ITEM_FILTER);
});
