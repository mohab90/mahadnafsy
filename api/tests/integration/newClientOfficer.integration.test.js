'use strict';
/**
 * «في قسم الأونلاين اي عميل جديد لازم يروح لموظف اسمه تحصيل جديد» (15 Oct 2026), on a real MariaDB:
 * the employee set as the new-client officer takes every online client ahead of the rotation; a Dokki
 * client is still the branch's; with him removed or inactive the rotation is back.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-newcol-it';
let pool; let pickCollectionOfficer; let setTenantSetting;

const clean = async () => {
  for (const table of ['staff', 'tenant_settings']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ pickCollectionOfficer } = require('../../lib/collectionDistribution'));
  ({ setTenantSetting } = require('../../lib/tenantSettings'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('nc-new', ?, 'تحصيل جديد', 'nc-new@example.com', '0100000001', 'collection', 1, NOW()), ('nc-b', ?, 'أحمد', 'nc-b@example.com', '0100000002', 'collection', 1, NOW())", [TENANT, TENANT]);
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

test('every new online client goes to the new-client officer, whatever the rotation says', { skip }, async () => {
  await setTenantSetting('collection_distribution', { members: [{ staffId: 'nc-b', isAvailable: true, markets: ['local'], intakeLimit: null, intakePeriod: 'day' }], newClientOfficerId: 'nc-new' }, { tenantId: TENANT, actorId: 'it' });
  for (let i = 0; i < 3; i += 1) {
    const officer = await pickCollectionOfficer(pool, TENANT, { market: 'local', branch: 'ONLINE_EGYPT' });
    assert.equal(officer.id, 'nc-new');
  }
  assert.equal(await pickCollectionOfficer(pool, TENANT, { market: 'local', branch: 'DAQQI' }), null, 'a Dokki client is the branch desk\'s');
});

test('without him, or with him gone, the rotation is back', { skip }, async () => {
  await setTenantSetting('collection_distribution', { members: [{ staffId: 'nc-b', isAvailable: true, markets: [], intakeLimit: null, intakePeriod: 'day' }], newClientOfficerId: '' }, { tenantId: TENANT, actorId: 'it' });
  assert.equal((await pickCollectionOfficer(pool, TENANT, { market: 'local', branch: 'ONLINE_EGYPT' })).id, 'nc-b');
  await setTenantSetting('collection_distribution', { members: [{ staffId: 'nc-b', isAvailable: true, markets: [], intakeLimit: null, intakePeriod: 'day' }], newClientOfficerId: 'nc-new' }, { tenantId: TENANT, actorId: 'it' });
  await pool.query("UPDATE staff SET is_active=0 WHERE id='nc-new'");
  assert.equal((await pickCollectionOfficer(pool, TENANT, { market: 'local', branch: 'ONLINE_EGYPT' })).id, 'nc-b', 'an inactive officer is passed over');
});
