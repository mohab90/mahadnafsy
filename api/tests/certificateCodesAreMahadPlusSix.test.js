'use strict';

// «كود الشهادة يكون صغير … MAHAD + 6 رموز، بعدد 11» (16 Oct 2026).
//
// Every new certificate gets MAHAD and six letters or digits. A collision is retried, older
// codes (MHAD-…, PSY-C-…) still verify, and every place that issues a code uses the one helper.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { newCertificateCode, withFreshCode, isCodeCollision, ALPHABET } = require('../lib/certificateCodes');
const { certificateCode } = require('../lib/certificateLifecycle');
const { cleanCode } = require('../lib/certificateVerification');

const read = rel => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');

test('a code is MAHAD and six letters or digits: eleven characters, nothing else', () => {
  for (let i = 0; i < 500; i += 1) {
    const code = newCertificateCode();
    assert.match(code, /^MAHAD[A-Z2-9]{6}$/);
    assert.equal(code.length, 11);
    assert.doesNotMatch(code.slice(5), /[ILO01]/, 'no symbol that reads as another');
  }
  assert.equal(ALPHABET.length, 31);
  assert.match(certificateCode(), /^MAHAD[A-Z2-9]{6}$/, 'the lifecycle helper issues the same shape');
});

test('codes are spread out: 5,000 draws repeat nothing worth worrying about', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) seen.add(newCertificateCode());
  assert.ok(seen.size >= 4995, `only ${seen.size} distinct`);
});

test('a code that is already taken is replaced by another, any other failure is not swallowed', async () => {
  const taken = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'MAHADAAAAAA' for key 'uq_certificate_requests_code'" });
  const tried = [];
  const result = await withFreshCode(async code => {
    tried.push(code);
    if (tried.length < 3) throw taken;
    return code;
  });
  assert.equal(tried.length, 3);
  assert.equal(result, tried[2]);

  const otherDuplicate = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'uq_certificate_requests_subscriber_course'" });
  assert.equal(isCodeCollision(otherDuplicate), false);
  await assert.rejects(withFreshCode(async () => { throw otherDuplicate; }), /dup/);
  await assert.rejects(withFreshCode(async () => { throw taken; }), /dup/, 'gives up after a few tries rather than looping');
});

test('new and old codes both pass the public check', () => {
  assert.equal(cleanCode(' mahad k7m2qx '), 'MAHADK7M2QX');
  for (const code of ['MAHADK7M2QX', 'MHAD-MG3K9A-9F2A1C04', 'PSY-C-AAAA111122', 'CERT-1']) {
    assert.match(cleanCode(code), /^[A-Z0-9_-]{6,}$/);
  }
});

test('every place that issues a code uses the helper, and nothing issues the long formats any more', () => {
  const completion = read('api/lib/courseCompletion.js');
  assert.match(completion, /code = certificateCode\(\)/);
  assert.match(completion, /could not allocate a certificate code/, 'a collision on completion is retried, not lost');
  assert.match(read('api/lib/certificateLifecycle.js'), /withFreshCode\(/, 'a reissue retries a collision too');
  for (const file of ['api/lib/certificatePayments.js', 'api/routes/certificates.js']) {
    const source = read(file);
    assert.match(source, /require\('\.\.?\/(?:lib\/)?certificateCodes'\)/, `${file} imports the helper`);
    assert.match(source, /INSERT INTO certificate_requests\s*\(id, certificate_code,/, `${file} sets the code itself`);
  }
  assert.doesNotMatch(read('api/lib/certificateLifecycle.js'), /MHAD-\$\{/);
  assert.match(read('api/migrations/291_v26_short_certificate_codes.sql'), /CONCAT\('MAHAD'/);
  assert.match(read('api/schema.sql'), /concat\('MAHAD'/);
  assert.match(read('client/components/Footer.tsx'), /placeholder="MAHAD…"/);
});
