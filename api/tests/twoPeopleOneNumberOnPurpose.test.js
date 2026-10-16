'use strict';
/**
 * «العميل بيجيب صاحبه … نفس رقم التليفون لحسابين واحنا مانعين نكرر رقم التليفون … هنتصرف فيها ازاي؟» (15 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

test('the key is (tenant, number, slot): ordinary accounts are slot 0 and still refuse a twin', () => {
  const sql = read('api/migrations/287_v26_shared_phone_accounts.sql');
  assert.match(sql, /phone_slot TINYINT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_subs_tenant_phone_slot ON subscribers \(tenant_id, phone, phone_slot\)/);
  assert.ok(sql.indexOf('CREATE UNIQUE INDEX') < sql.indexOf('DROP INDEX'), 'the new key exists before the old one goes');
  assert.match(read('api/schema.sql'), /UNIQUE KEY `uq_subs_tenant_phone_slot` \(`tenant_id`,`phone`,`phone_slot`\)/);
});

test('a number is shared only by a new account, with the holder named and a reason, on both paths that make clients', () => {
  for (const file of ['api/routes/admin/subscribers.js', 'api/routes/subscriber-payments.js']) {
    const code = read(file);
    assert.match(code, /sharedPhoneSlot\(/, file);
    assert.match(code, /recordSharedPhone\(/, `${file} writes the link on both files`);
  }
  const subscribers = read('api/routes/admin/subscribers.js');
  assert.match(subscribers, /if \(!already\)/, 'an existing client can never be moved onto a shared number');
  assert.match(read('api/routes/subscriber-payments.js'), /\(phone=\? AND phone_slot=\?\)/, 'the race check knows slots');
});

test('the booking form says whose number it is, offers the file, and the linked account is told in search', () => {
  assert.match(read('admin/components/PaymentModal.tsx'), /<SharedPhonePanel /);
  assert.match(read('admin/components/SharedPhonePanel.tsx'), /ده شخص تاني بيستخدم نفس الرقم/);
  assert.match(read('admin/lib/createClientWithPayment.ts'), /sharedPhone: draft\.sharedPhone/);
  assert.match(read('api/routes/misc/clientDbSearch.js'), /sharedPhone: Number\(s\.phone_slot\) > 0/);
  assert.match(read('api/routes/misc/duplicatePhones.js'), /phone_slot = 0/, 'a linked pair is not reported as a duplicate');
});
