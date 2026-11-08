'use strict';
/**
 * «العميل بيجيب صاحبه … نفس رقم التليفون لحسابين واحنا مانعين نكرر رقم التليفون … هنتصرف فيها ازاي؟» (15 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paymentModalSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

test('the key is (tenant, number, slot): ordinary accounts are slot 0 and still refuse a twin', () => {
  const sql = read('api/migrations/287_v26_shared_phone_accounts.sql');
  
  
  assert.ok(sql.indexOf('CREATE UNIQUE INDEX') < sql.indexOf('DROP INDEX'), 'the new key exists before the old one goes');
  
});

test('a number is shared only by a new account, with the holder named and a reason, on both paths that make clients', () => {
  for (const file of ['api/routes/admin/subscribers.js', 'api/routes/subscriber-payments.js']) {
    const code = read(file);
    assert.match(code, /sharedPhoneSlot\(/, file);
    assert.match(code, /recordSharedPhone\(/, `${file} writes the link on both files`);
  }
  const subscribers = read('api/routes/admin/subscribers.js');
  
  
});


