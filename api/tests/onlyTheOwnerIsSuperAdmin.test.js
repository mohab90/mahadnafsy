'use strict';
/**
 * «خليني انا سوبر ادمن وخليهم هما ادمن» (1 Nov 2026). The accounts with the ADMIN or MANAGER role run the institute with full
 * permissions, but only the owner (ADMIN_EMAILS) makes, changes or removes another administrator's account. On the lab a manager
 * could create ADMIN accounts (audit BUG-04).
 */
process.env.ADMIN_EMAILS = 'owner@example.test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-only-owner-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isOwnerRequest } = require('../middleware/auth');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the owner is the owner, a manager and an admin are not', () => {
  assert.equal(isOwnerRequest({ user: { email: 'owner@example.test', tenant_id: 'tenant-default' } }), true);
  assert.equal(isOwnerRequest({ user: { email: 'Owner@Example.test', tenant_id: 'tenant-default' } }), true, 'the address is read case-blind');
  assert.equal(isOwnerRequest({ user: { email: 'manager@example.test', tenant_id: 'tenant-default' } }), false);
  assert.equal(isOwnerRequest({ user: { email: 'owner@example.test', tenant_id: 'another-tenant' } }), false, 'not another institute\'s');
  assert.equal(isOwnerRequest({}), false);
  assert.equal(isOwnerRequest(undefined), false);
});

test('every place that guards an administrator\'s account asks for the owner, not only for full access', () => {
  for (const [rel, count] of [['routes/staff.js', 2], ['routes/auth/staffAccounts.js', 2], ['routes/hr/talent.js', 1]]) {
    const hits = read(rel).match(/!isOwnerRequest\(req\)/g) || [];
    assert.equal(hits.length, count, rel);
  }
});

test('customer service reads the payments register as before (1 Nov 2026: the search-only limit was taken back)', () => {
  const src = read('routes/finance-payments-register.js');
  assert.ok(!src.includes('searchRequired'));
  assert.ok(!src.includes('readsEverything'));
});

test('an employee who forgot the password gets the code by email, at the address on their staff record, never on WhatsApp', () => {
  const src = read('routes/auth/passwordReset.js');
  assert.match(src, /FROM staff WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)=\? AND is_active=1 AND deleted_at IS NULL/);
  assert.match(src, /const dialable = !isStaffAccount && user\.phone \? toDialable\(user\.phone\) : '';/);
  // and the mail goes to the account's own address, not to anything the request carried
  assert.match(src, /sendEmail\(user\.email, 'رمز إعادة تعيين كلمة المرور'/);
});
