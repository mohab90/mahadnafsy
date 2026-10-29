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
 * Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-certificate-secret-0123456789-abcdefghijk';

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const flat = sql => String(sql).replace(/\s+/g, ' ').trim();
const ITEM_FILTER = /payment_type IS NULL OR (?:p\.)?payment_type IN \('COURSE','BUNDLE','OTHER'\)/;

test('the agreed price of a course is read from the course\'s own payments, not from a certificate that names it', async () => {
  const { agreedPrice } = require('../lib/agreedPrice');
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(flat(sql));
      if (/FROM subscribers/.test(sql)) return [[{ crm_json: null }]];
      return [[{ price: 1000, paid: 1000 }]];
    },
  };
  assert.equal(await agreedPrice(db, { tenantId: 't', subscriberId: 's', courseId: 'c1', currency: 'EGP' }), 1000);
  const booked = seen.find(sql => /MAX\(course_expected\)/.test(sql));
  assert.match(booked, ITEM_FILTER, 'a certificate row must not set the price or add to what is paid');
});

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

test('every query that decides what a course is paid or costs asks for the course\'s own payments', () => {
  const needs = [
    ['lib/agreedPrice.js', /SELECT MAX\(course_expected\) AS price,[\s\S]*?payment_type IS NULL OR payment_type IN \('COURSE','BUNDLE','OTHER'\)/],
    ['lib/planEntryPayment.js', /SELECT MAX\(course_expected\) AS expected FROM payments[\s\S]*?payment_type IS NULL OR payment_type IN \('COURSE','BUNDLE','OTHER'\)/],
    ['routes/installments.js', /SELECT MAX\(course_expected\) AS expected FROM payments[\s\S]*?payment_type IS NULL OR payment_type IN \('COURSE','BUNDLE','OTHER'\)/],
    ['lib/autoCertificate.js', /p\.payment_type IS NULL OR p\.payment_type IN \('COURSE','BUNDLE','OTHER'\)\)\s+AND p\.deleted_at IS NULL\) AS paid_egp/],
    ['lib/paymentCorrections.js', /ORDER BY date DESC, created_at DESC LIMIT 1/],
    ['lib/refunds.js', /p\.payment_type IS NULL OR p\.payment_type IN \('COURSE','BUNDLE','OTHER'\)/],
  ];
  for (const [file, pattern] of needs) assert.match(read(file), pattern, file);
  const corrections = read('lib', 'paymentCorrections.js');
  assert.match(corrections, /!isItemPaymentType\(pay\.payment_type\)\) return;/, 'recomputing access leaves a certificate alone');
  assert.match(corrections, /if \(wasPaid && isItemPaymentType\(pay\.payment_type\)\)/, 'voiding a certificate instalment does not run the course close-down');
  assert.match(corrections, /syncCertificateRequest\(conn, tenantId, pay\.certificate_request_id\)/, 'the certificate\'s own paid amount still follows its payments');
});
