'use strict';
/**
 * «تقسيم العميل بين الفروع … تحويل جزئي لكورس معين» (15 Oct 2026), on a real MariaDB: a course placed in another
 * branch makes the client belong to that branch too, and putting it back takes them out of it.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-placement-it';
let pool; let placeCourse; let loadPlacements; let ownOrPlaced;

const dokkiClients = async () => {
  const [rows] = await pool.query(`SELECT s.id FROM subscribers s WHERE s.tenant_id=? AND s.deleted_at IS NULL AND ${ownOrPlaced(['DAQQI'])} ORDER BY s.id`, [TENANT, 'DAQQI', 'DAQQI']);
  return rows.map(row => row.id);
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ placeCourse, loadPlacements, ownOrPlaced } = require('../../lib/coursePlacement'));
  await pool.query('DELETE FROM subscriber_course_branches WHERE tenant_id=?', [TENANT]);
  await pool.query('DELETE FROM subscribers WHERE tenant_id=?', [TENANT]);
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch) VALUES ('pl-online', ?, 'أونلاين', '1019000901', 'ONLINE_EGYPT'), ('pl-dokki', ?, 'دقي', '1019000902', 'DAQQI')", [TENANT, TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await pool.query('DELETE FROM subscriber_course_branches WHERE tenant_id=?', [TENANT]);
  await pool.query('DELETE FROM subscribers WHERE tenant_id=?', [TENANT]);
  await pool.end();
});

test('an online client with a course placed in Dokki is Dokki\'s too, and not before', { skip }, async () => {
  assert.deepEqual(await dokkiClients(), ['pl-dokki']);
  assert.deepEqual(await placeCourse(pool, { tenantId: TENANT, subscriberId: 'pl-online', item: 'course-9', branch: 'daqqi', actor: 'it' }), { item: 'course-9', branch: 'DAQQI' });
  assert.deepEqual(await dokkiClients(), ['pl-dokki', 'pl-online']);
  assert.deepEqual((await loadPlacements(pool, TENANT, ['pl-online'])).get('pl-online'), { 'course-9': 'DAQQI' });
});

test('putting it back, or naming a branch that does not exist', { skip }, async () => {
  await assert.rejects(placeCourse(pool, { tenantId: TENANT, subscriberId: 'pl-online', item: 'course-9', branch: 'MARS' }), /الفرع غير معروف/);
  assert.deepEqual(await placeCourse(pool, { tenantId: TENANT, subscriberId: 'pl-online', item: 'course-9', branch: '' }), { item: 'course-9', branch: null });
  assert.deepEqual(await dokkiClients(), ['pl-dokki']);
});
