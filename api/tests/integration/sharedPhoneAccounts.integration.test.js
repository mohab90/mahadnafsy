'use strict';
/**
 * Two people, one number — on purpose (15 Oct 2026), on a real MariaDB: a number belongs to one client, a
 * second person may take it only when staff names the holder and says why, each account takes its own slot,
 * and the ordinary refusal is untouched.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-sharedphone-it';
let pool; let sharedPhoneSlot; let clientHoldingPhone;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ sharedPhoneSlot, clientHoldingPhone } = require('../../lib/phoneDuplicates'));
  await pool.query('DELETE FROM subscribers WHERE tenant_id=?', [TENANT]);
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('sp-1', ?, 'صاحب الرقم', '1157575001')", [TENANT]);
});
after(async () => { if (!ENABLED) return; await pool.query('DELETE FROM subscribers WHERE tenant_id=?', [TENANT]); await pool.end(); });

test('a second person takes the next slot, only with the holder named and a reason', { skip }, async () => {
  const base = { tenantId: TENANT, phone: '01157575001', sharedWithId: 'sp-1', relation: 'friend' };
  assert.equal((await sharedPhoneSlot(pool, { ...base, reason: '' })).body.code, 'SHARED_PHONE_REASON');
  assert.equal((await sharedPhoneSlot(pool, { ...base, reason: 'صاحبه', relation: 'nobody' })).body.code, 'SHARED_PHONE_RELATION');
  assert.equal((await sharedPhoneSlot(pool, { ...base, reason: 'صاحبه', sharedWithId: 'nobody' })).body.code, 'SHARED_PHONE_HOLDER');
  const first = await sharedPhoneSlot(pool, { ...base, reason: 'صاحبه بيستخدم نفس الرقم' });
  assert.deepEqual([first.ok, first.slot, first.primaryId], [true, 1, 'sp-1']);

  // The account is made on that slot; a third person's slot follows it, and links to the first.
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, phone_slot, phone_shared_with) VALUES ('sp-2', ?, 'صاحبه', '1157575001', 1, 'sp-1')", [TENANT]);
  const second = await sharedPhoneSlot(pool, { ...base, sharedWithId: 'sp-2', reason: 'قريبه' });
  assert.deepEqual([second.ok, second.slot, second.primaryId], [true, 2, 'sp-1']);
});

test('the key still refuses two ordinary accounts on one number, and the number still has a holder', { skip }, async () => {
  await assert.rejects(pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('sp-3', ?, 'مكرر', '1157575001')", [TENANT]), /uq_subs_tenant_phone/);
  assert.equal((await clientHoldingPhone(pool, { tenantId: TENANT, phones: ['01157575001'] })).id.startsWith('sp-'), true);
});
