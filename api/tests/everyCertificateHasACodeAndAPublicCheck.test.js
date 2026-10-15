'use strict';
/**
 * «ايقونة البحث عن شهادة يكتب كود الشهادة تفتح توثيقها … ويشمل اي شهادة بتطلع من السيستم وكله ليه كود»
 * (15 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { verifyCertificate, cleanCode } = require('../lib/certificateVerification');
const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

const dbWith = ({ course = null, external = null } = {}) => ({
  seen: [],
  async query(sql, params) {
    this.seen.push({ sql: String(sql).replace(/\s+/g, ' '), params });
    if (/FROM course_completions/.test(sql)) return [[course]];
    if (/FROM certificate_requests/.test(sql)) return [[external]];
    return [[]];
  },
});

test('a code is cleaned and a malformed one never reaches the database', async () => {
  assert.equal(cleanCode(' psy-c-ab 12cd34 '), 'PSY-C-AB12CD34');
  const db = dbWith();
  assert.equal(await verifyCertificate(db, "x' OR 1=1 --"), null);
  assert.equal(await verifyCertificate(db, 'ab'), null);
  assert.equal(db.seen.length, 0);
});

test('the institute\'s own certificate: valid, with the English name, the hours and the date', async () => {
  const db = dbWith({ course: { certificate_code: 'CERT-1', completed_at: '2026-10-13T06:00:00Z', status: 'active', name_ar: 'أحمد', name_en: 'Ahmed', course_ar: 'دبلومة', course_en: 'Diploma', hours_count: '60.00' } });
  const found = await verifyCertificate(db, 'cert-1');
  assert.deepEqual([found.kind, found.state, found.hours, found.holderEn, found.subjectEn], ['course', 'valid', 60, 'Ahmed', 'Diploma']);
  const revoked = await verifyCertificate(dbWith({ course: { certificate_code: 'CERT-1', status: 'revoked', name_ar: 'أ', course_ar: 'د' } }), 'CERT-1');
  assert.equal(revoked.state, 'revoked');
});

test('a certificate arranged with another body: valid once issued, pending before, never an id number', async () => {
  const row = status => ({ certificate_code: 'PSY-C-AAAA111122', type: 'AIN_SHAMS', custom_name: null, status, issued_at: '2026-10-01T00:00:00Z', requested_at: '2026-09-01T00:00:00Z', name_ar: 'منى', name_en: null, course_ar: 'دورة', course_en: null, id_number: '29901010101010' });
  const issued = await verifyCertificate(dbWith({ external: row('DELIVERED') }), 'PSY-C-AAAA111122');
  assert.deepEqual([issued.kind, issued.state, issued.title], ['external', 'valid', 'شهادة جامعة عين شمس']);
  const waiting = await verifyCertificate(dbWith({ external: row('PAID') }), 'PSY-C-AAAA111122');
  assert.deepEqual([waiting.state, waiting.statusText, waiting.issuedAt], ['pending', 'قيد الإصدار', null]);
  assert.ok(!JSON.stringify(issued).includes('29901010101010'), 'the id number is never in the answer');
  const named = await verifyCertificate(dbWith({ external: { ...row('ISSUED'), custom_name: 'شهادة الأزهر' } }), 'PSY-C-AAAA111122');
  assert.equal(named.title, 'شهادة الأزهر');
});

test('every certificate request gets a code, and the site has the search and the page', () => {
  assert.match(read('api/migrations/286_v26_certificate_request_codes.sql'), /MODIFY certificate_code VARCHAR\(40\) NOT NULL DEFAULT \(CONCAT\('PSY-C-'/);
  assert.match(read('api/migrations/286_v26_certificate_request_codes.sql'), /CREATE UNIQUE INDEX IF NOT EXISTS uq_certificate_requests_code/);
  assert.match(read('api/routes/public.js'), /router\.get\('\/api\/certificates\/verify\/:code', publicLimiter/);
  const footer = read('client/components/Footer.tsx');
  assert.match(footer, /<CertificateCheck \/>/);
  assert.match(footer, /التحقق من شهادة/);
  const app = read('client/App.tsx');
  assert.match(app, /path="\/certificate" element/);
  assert.match(app, /path="\/certificate\/:code" element/);
});
