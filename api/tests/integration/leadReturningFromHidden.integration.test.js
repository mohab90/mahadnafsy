'use strict';
/**
 * Owner's decision of 11 Nov 2026: a person whose lead is hidden or archived who fills a form or signs up again is interested
 * again — the lead comes back (visible, status «new» when it had ended, due today), the form's words go on its timeline, and the
 * rep it belongs to is told; with no rep, or a rep who left, the normal assignment picks one. A merged copy is never revived.
 * Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-lead-return-it';
let pool;

async function clean() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for (const table of ['lead_timeline', 'notifications', 'subscribers', 'leads', 'staff', 'activity_logs']) {
      await conn.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
    }
  } finally { conn.release(); }
}
const staff = (id, active = 1) => pool.query(
  `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?,?,?,?,?, 'sales', ?, '2026-01-01')`,
  [id, TENANT, id, `${id}@lead-return.test`, `0109307${String(Math.floor(Math.random() * 9000) + 1000)}`, active]);
const lead = (id, fields = {}) => {
  const row = { name: id, phone: null, source: 'test', status: 'new', hidden: 0, ...fields };
  const columns = Object.keys(row);
  return pool.query(`INSERT INTO leads (id, tenant_id, ${columns.join(', ')}) VALUES (?, ?, ${columns.map(() => '?').join(', ')})`, [id, TENANT, ...columns.map(c => row[c])]);
};
const read = async id => (await pool.query(
  "SELECT status, hidden, assigned_sales_id, DATE_FORMAT(next_follow_up_date,'%Y-%m-%d') AS due FROM leads WHERE tenant_id=? AND id=?", [TENANT, id]))[0][0];
const form = phone => require('../../lib/publicLead').capturePublicLead({
  tenantId: TENANT, name: 'زائرة', phone, notes: 'عايزة أسأل تاني', source: 'site', branch: 'ONLINE_EGYPT' });
const noticesFor = async leadId => (await pool.query(
  "SELECT recipient_staff_id, type FROM notifications WHERE tenant_id=? AND data_json LIKE ?", [TENANT, `%${leadId}%`]))[0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await staff('lr-rep-1');
  await staff('lr-rep-2');
  await staff('lr-gone', 0);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); setTimeout(() => process.exit(), 300).unref(); } });

test('a form from a lead hidden as «مش مهتم» brings it back to its rep, due today, and tells the rep', { skip }, async () => {
  const { cairoToday } = require('../../lib/dates');
  await lead('lr-1', { phone: '1019993001', status: 'not_interested_hidden', hidden: 1, assigned_sales_id: 'lr-rep-1', assigned_sales_name: 'lr-rep-1' });
  const result = await form('01019993001');
  assert.deepEqual([result.id, result.existing], ['lr-1', true]);
  assert.deepEqual({ ...(await read('lr-1')) }, { status: 'new', hidden: 0, assigned_sales_id: 'lr-rep-1', due: cairoToday() });
  assert.deepEqual((await noticesFor('lr-1')).map(n => ({ ...n })), [{ recipient_staff_id: 'lr-rep-1', type: 'lead' }]);
  const [events] = await pool.query("SELECT event_type FROM lead_timeline WHERE tenant_id=? AND lead_id='lr-1'", [TENANT]);
  const types = events.map(e => e.event_type);
  assert.ok(types.includes('note_added') && types.includes('reopened') && types.includes('status_changed'), types.join(','));
});

test('a hidden lead with no rep, or whose rep left, goes through the normal assignment', { skip }, async () => {
  await lead('lr-2', { phone: '1019993002', hidden: 1, assigned_sales_id: null });
  await lead('lr-3', { phone: '1019993003', hidden: 1, assigned_sales_id: 'lr-gone', assigned_sales_name: 'lr-gone' });
  await form('01019993002');
  await form('01019993003');
  for (const id of ['lr-2', 'lr-3']) {
    const row = await read(id);
    assert.equal(row.hidden, 0, id);
    assert.ok(['lr-rep-1', 'lr-rep-2'].includes(row.assigned_sales_id), `${id} went to ${row.assigned_sales_id}`);
    assert.deepEqual((await noticesFor(id)).map(n => n.recipient_staff_id), [row.assigned_sales_id], `${id}: the new rep is told`);
  }
});

test('a visible open lead is only given a note: not reopened, nobody pinged', { skip }, async () => {
  await lead('lr-4', { phone: '1019993004', status: 'interested', assigned_sales_id: 'lr-rep-2', next_follow_up_date: '2027-01-01' });
  await form('01019993004');
  assert.deepEqual({ ...(await read('lr-4')) }, { status: 'interested', hidden: 0, assigned_sales_id: 'lr-rep-2', due: '2027-01-01' });
  assert.equal((await noticesFor('lr-4')).length, 0);
});

test('a lead that was a sale stays out of the pipeline, a merged copy is never revived — its surviving lead is', { skip }, async () => {
  await lead('lr-5', { phone: '1019993005', status: 'converted', hidden: 1, assigned_sales_id: 'lr-rep-1' });
  await form('01019993005');
  assert.deepEqual({ ...(await read('lr-5')) }, { status: 'converted', hidden: 1, assigned_sales_id: 'lr-rep-1', due: null });
  assert.equal((await noticesFor('lr-5')).length, 0);

  await lead('lr-survivor', { phone: '1019993006', hidden: 1, status: 'closed', assigned_sales_id: 'lr-rep-2' });
  await lead('lr-copy', { phone: null, email: 'copy@lead-return.test', hidden: 1, status: 'closed', merged_into_lead_id: 'lr-survivor' });
  await form('01019993006');
  assert.equal((await read('lr-survivor')).hidden, 0);
  assert.equal((await read('lr-copy')).hidden, 1, 'the merged copy stays where it is');
});

test('a signup, and «تحويل التسجيل», bring a hidden lead back and report it', { skip }, async () => {
  const { ensureLeadForUser } = require('../../lib/registrationLead');
  await lead('lr-7', { phone: '1019993007', hidden: 1, status: 'lost', assigned_sales_id: 'lr-rep-2' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const outcome = await ensureLeadForUser(conn, { tenantId: TENANT, user: { id: 'lr-u', name: 'مسجلة', phone: '01019993007' } });
    await conn.commit();
    assert.deepEqual([outcome.created, outcome.leadId, outcome.reopened], [false, 'lr-7', true]);
  } finally { conn.release(); }
  assert.deepEqual({ ...(await read('lr-7')) }, { status: 'new', hidden: 0, assigned_sales_id: 'lr-rep-2', due: require('../../lib/dates').cairoToday() });
  assert.deepEqual((await noticesFor('lr-7')).map(n => n.recipient_staff_id), ['lr-rep-2']);
});
