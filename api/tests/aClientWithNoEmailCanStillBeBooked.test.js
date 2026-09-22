'use strict';

// «الدفعة دي متسجلة بالفعل» on a booking that had never been recorded.
//
// subscribers carries UNIQUE (tenant_id, email). The booking route wrote the
// empty string for somebody with no email address, so the first such client
// took the slot — «مهاب», 12 September — and every booking afterwards for
// anyone without an email was refused. Four attempts in a row at the desk, and
// the server log said exactly why the whole time:
//
//   Duplicate entry 'tenant-default-' for key 'uq_subs_tenant_email'
//
// "No email" is NULL, which a unique index allows any number of. The phone
// column has carried that rule since subscriberProvisioningPhone.test.js; the
// email column is held to it here, on every path that writes a subscriber.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the booking route stores no email as NULL, on both paths it writes one', () => {
  const source = read('api/routes/subscriber-payments.js');
  const emailAssignments = source.split('\n')
    .filter(line => /email:?\s*=?\s*sanitize\(/.test(line) && line.includes('email'))
    .map(line => line.trim());
  assert.ok(emailAssignments.length >= 2, `expected the paths that build an email, found ${emailAssignments.length}`);
  for (const line of emailAssignments) {
    // safeEmail is compared against existing rows before anything is written;
    // it is the values that reach an INSERT that must fall back to null.
    if (line.includes('safeEmail')) continue;
    assert.ok(/\|\|\s*null/.test(line), `an empty address reaches the insert: ${line}`);
  }
});

test('the subscriber row built from a draft carries null rather than an empty address', () => {
  const source = read('api/routes/subscriber-payments.js');
  const draftRow = source.slice(source.indexOf('createFromDraft = true;'), source.indexOf('createFromDraft = true;') + 700);
  assert.match(draftRow, /email:\s*safeEmail \|\| null/,
    'the draft path must store null when the desk left the address blank');
});

test('a unique index still guards a real address', () => {
  // The repair is NULL for absent, not dropping the constraint: two clients
  // must not share one address.
  const schema = read('api/schema.sql');
  assert.match(schema, /UNIQUE KEY `uq_subs_tenant_email` \(`tenant_id`,`email`\(191\)\)/,
    'the uniqueness that protects a real address must stay');
});
