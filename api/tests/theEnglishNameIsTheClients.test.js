'use strict';
/**
 * 3 Nov 2026, «لما ادخل اسم العميل بالانجليزي مرة لازم يسمع في كل الشهادات وفي الحساب»: the English name is one thing, the client's (subscribers.name_en);
 * every certificate of theirs follows it when it is set for the client. A spelling the desk typed on ONE institute certificate still prints on that one
 * (routes/instituteCertificates.js «تعديل … الشهادة دي بس»), until a name is set for the whole client.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setClientEnglishName } = require('../lib/clientEnglishName');
const { effectiveCertificate } = require('../lib/certificateEnglish');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('setting the name writes the client, every certificate request of theirs, and clears a stray copy on an issued certificate', async () => {
  const seen = [];
  const db = { async query(sql, params) { seen.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return [{ affectedRows: 1 }]; } };
  assert.equal(await setClientEnglishName(db, { tenantId: 't', subscriberId: 's1', nameEn: '  Mona   Ali  ' }), true);
  assert.deepEqual(seen.map(entry => entry.sql.split(' SET ')[0]), ['UPDATE subscribers', 'UPDATE certificate_requests', 'UPDATE course_completions']);
  assert.deepEqual(seen[0].params, ['Mona Ali', 's1', 't']);
  assert.deepEqual(seen[1].params, ['Mona Ali', 't', 's1']);
  assert.match(seen[2].sql, /cert_name_en=NULL/);
  assert.equal(await setClientEnglishName(db, { tenantId: 't', subscriberId: 's1', nameEn: '   ' }), false, 'a blank never erases');
  assert.equal(seen.length, 3);
});

test('a spelling typed on one certificate prints on that one; otherwise the client\'s name', () => {
  assert.equal(effectiveCertificate({ name_en: 'Mona Ali', cert_name_en: 'Mona Aly', request_name_en: 'Muna Ali' }).name, 'MONA ALY');
  assert.equal(effectiveCertificate({ name_en: 'Mona Ali', cert_name_en: '', request_name_en: 'Muna Ali' }).name, 'MONA ALI');
  assert.equal(effectiveCertificate({ name_en: '', cert_name_en: '', request_name_en: 'Muna Ali' }).name, 'MUNA ALI');
  const verification = read('lib', 'certificateVerification.js');
  assert.match(verification, /COALESCE\(NULLIF\(s\.name_en, ''\), NULLIF\(cr\.name_en, ''\)\) AS name_en/);
});

test('every place that sets the client\'s name does it through the one function', () => {
  for (const file of [['routes', 'certificates.js'], ['routes', 'misc', 'clientCertificateData.js'], ['lib', 'bookingIdentity.js']]) {
    assert.match(read(...file), /setClientEnglishName\(/, file.join('/'));
  }
  assert.match(read('routes', 'certificates.js'), /nameEn: row\.client_name_en \|\| row\.name_en \|\| null,/);
});
