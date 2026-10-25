'use strict';

// 25 Oct 2026 — «العملاء القدام بتظهر عليهم شهادة المعهد صدرت بس بتفشل لما نفتحها ومش في السجل … لما نكتب كود الشهادة
// تظهر بالتصميم الأصلي وجنبها زرين: طباعة كاملة وطباعة المعهد».
//
// Root cause: an institute certificate issued by the old system was imported as a certificate_request, and everything
// that opens a certificate (the design, the QR, the history) reads course_completions — where it had no row.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-old-certificates-secret-0123456789-abcdefghijklmn';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
const { recordIssuedInstituteCertificate } = require('../lib/instituteCertificates');

function fakeDb() {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), params }); return [{ affectedRows: 1 }]; } };
}

const request = {
  type: 'INSTITUTE', status: 'ISSUED', subscriber_id: 's1', course_id: 'c1', certificate_code: 'MHAD-OLD-00042',
  tenant_id: 't1', name_en: ' Mona Ali ', issued_at: '2025-03-01 00:00:00',
};

test('an issued institute request is recorded as a completion under the SAME code, once per client and course', async () => {
  const db = fakeDb();
  assert.equal(await recordIssuedInstituteCertificate(db, request), true);
  const { sql, params } = db.calls[0];
  assert.match(sql, /^INSERT IGNORE INTO course_completions/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM course_completions WHERE tenant_id=\? AND subscriber_id=\? AND course_id=\?\)/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM course_completions WHERE certificate_code=\?\)/);
  assert.ok(params.includes('MHAD-OLD-00042'), 'the old code is kept, so the QR on the paper resolves');
  assert.ok(params.includes('Mona Ali'), 'the English name written on the request is what prints');
  assert.ok(params.includes('READY'));
});

test('only an institute request that names a client and a course is recorded; delivery follows the request', async () => {
  const db = fakeDb();
  assert.equal(await recordIssuedInstituteCertificate(db, { ...request, type: 'AIN_SHAMS' }), false);
  assert.equal(await recordIssuedInstituteCertificate(db, { ...request, course_id: null }), false);
  assert.equal(await recordIssuedInstituteCertificate(db, { ...request, certificate_code: '' }), false);
  assert.equal(db.calls.length, 0);
  await recordIssuedInstituteCertificate(db, { ...request, status: 'AT_BRANCH' });
  assert.ok(db.calls[0].params.includes('AT_BRANCH'));
});

test('issuing by hand writes it, the migration backfills the ones already there, and the old codes are kept', () => {
  assert.match(read('api/routes/certificates.js'), /recordIssuedInstituteCertificate\(conn, \{ \.\.\.request, status: normalizedStatus/);
  const migration = read('api/migrations/302_v26_old_institute_certificates_get_completions.sql');
  assert.match(migration, /INSERT IGNORE INTO course_completions/);
  assert.match(migration, /cr\.type = 'INSTITUTE'/);
  assert.match(migration, /cr\.status IN \('ISSUED', 'SHIPPED', 'AT_BRANCH', 'DELIVERED'\)/);
  assert.match(migration, /SELECT UUID\(\), cr\.subscriber_id, cr\.course_id, cr\.certificate_code/);
});

test('the verification page shows the design with «طباعة كاملة» and «طباعة المعهد», and the design can be embedded', () => {
  const page = read('client/pages/CertificateVerify.tsx');
  assert.match(page, /<CertificateDesign code=\{cert\.code\} \/>/);
  assert.match(page, /\?embed=1/);
  assert.match(page, /طباعة كاملة/);
  assert.match(page, /طباعة المعهد/);
  assert.match(page, /open\('mode=form&print=1'\)/);
  const route = read('api/routes/public.js');
  assert.match(route, /const embedded = String\(req\.query\.embed \|\| ''\) === '1'/);
  assert.match(route, /frame-ancestors 'self' \$\{clientBase\}/);
  assert.match(route, /!formMode && !embedded && String\(req\.query\.staff/);
});
