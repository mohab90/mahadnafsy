'use strict';
// Erasure has to make someone unmarketable permanently, not just blank their
// row. The two are different: blanking the record removes today's address, but
// the same address re-entered tomorrow — a staff import, a fresh enquiry — makes
// them marketable again unless a suppression exists.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const privacy = read('lib/privacyService.js');
const consent = read('lib/marketingConsent.js');

test('erasure writes a marketing suppression for every channel the subject had', () => {
  assert.match(privacy, /INSERT INTO marketing_suppressions/);
  for (const channel of ['email', 'whatsapp', 'sms']) {
    assert.ok(privacy.includes(`'${channel}'`), `${channel} must be suppressed on erasure`);
  }
});

test('the suppression is written before the contact details are wiped', () => {
  // It is keyed on a hash of the destination; after the UPDATE there is nothing
  // left to hash.
  const suppressAt = privacy.indexOf('INSERT INTO marketing_suppressions');
  const wipeAt = privacy.indexOf('UPDATE subscribers SET firebase_uid=NULL');
  assert.ok(suppressAt > 0 && wipeAt > 0);
  assert.ok(suppressAt < wipeAt, 'suppression must come first, or it hashes an already-blank value');
});






