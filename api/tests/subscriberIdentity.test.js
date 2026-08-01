'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { phoneVariants } = require('../lib/subscriberIdentity');

// The resolver itself needs a live pool, so these cover the pure part plus the
// invariants the SQL depends on. The behaviour under test is the one that broke
// real clients: a WhatsApp-only account has no email, and matching on an empty
// email must never widen into "any subscriber with a blank email".

test('phoneVariants covers the spellings an Egyptian number is stored in', () => {
  const v = phoneVariants('1012345678');
  for (const expected of ['1012345678', '01012345678', '201012345678', '+201012345678', '00201012345678']) {
    assert.ok(v.includes(expected), `missing variant ${expected}`);
  }
});

test('phoneVariants returns no candidates for anything that is not a number', () => {
  // An empty candidate list is what stops the phone branch from running at all.
  // If junk produced a variant, `s.phone IN ('')` could match rows stored blank.
  for (const junk of ['', null, undefined, 'abc', '12345', '0'.repeat(20), '+', '   ']) {
    assert.deepEqual(phoneVariants(junk), [], `junk produced variants: ${junk}`);
  }
});

test('every variant is a distinct non-empty string', () => {
  const v = phoneVariants('1012345678');
  assert.equal(new Set(v).size, v.length, 'duplicate variants would repeat SQL params');
  assert.ok(v.every(x => typeof x === 'string' && x.length > 0));
});

test('variants stay within the phone column width', () => {
  // subscribers.phone is varchar(50); a candidate longer than the column can
  // never match, and silently narrows the lookup instead of erroring.
  for (const n of ['1012345678', '123456789', '123456789012345']) {
    for (const v of phoneVariants(n)) assert.ok(v.length <= 50, `${v} exceeds column width`);
  }
});

test('a number at each end of the plausible range still resolves to variants', () => {
  assert.ok(phoneVariants('1'.repeat(9)).length > 0, '9 digits is the minimum plausible number');
  assert.ok(phoneVariants('1'.repeat(15)).length > 0, '15 digits is the maximum plausible number');
  assert.deepEqual(phoneVariants('1'.repeat(8)), [], '8 digits is below the plausible range');
  assert.deepEqual(phoneVariants('1'.repeat(16)), [], '16 digits is above the plausible range');
});
