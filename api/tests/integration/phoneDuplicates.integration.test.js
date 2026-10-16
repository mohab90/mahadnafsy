'use strict';
/**
 * One number, one client (14 Oct 2026) on a real MariaDB: a number is the same number with or
 * without its leading 0 / 20 / +20, and it is held by a client as their first OR second number.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-phones-it';
let pool; let clientHoldingPhone;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ clientHoldingPhone } = require('../../lib/phoneDuplicates'));
  await pool.query('DELETE FROM subscribers WHERE tenant_id=?', [TENANT]);
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, phone2) VALUES ('ph-it-1', ?, 'أحمد', '1157575809', '1009441632')", [TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await pool.query('DELETE FROM subscribers WHERE tenant_id=?', [TENANT]);
  await pool.end();
});

test('the same ten digits are the same number, however they are typed', { skip }, async () => {
  for (const typed of ['1157575809', '01157575809', '+201157575809', '00201157575809', '0115 757 5809']) {
    const holder = await clientHoldingPhone(pool, { tenantId: TENANT, phones: [typed] });
    assert.equal(holder?.id, 'ph-it-1', typed);
  }
});

test('a client\'s second number holds the number too', { skip }, async () => {
  assert.equal((await clientHoldingPhone(pool, { tenantId: TENANT, phones: ['01009441632'] }))?.id, 'ph-it-1');
});

test('the client being edited does not collide with themselves, nor another tenant', { skip }, async () => {
  assert.equal(await clientHoldingPhone(pool, { tenantId: TENANT, phones: ['01157575809'], exceptId: 'ph-it-1' }), null);
  assert.equal(await clientHoldingPhone(pool, { tenantId: 'someone-else', phones: ['01157575809'] }), null);
  assert.equal(await clientHoldingPhone(pool, { tenantId: TENANT, phones: ['01200000000', ''] }), null);
});
