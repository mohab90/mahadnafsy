'use strict';
/**
 * A branch's receipt numbers on a real MariaDB (14 Oct 2026): given in order inside the
 * recording transaction, none skipped when one rolls back, and never behind the numbers
 * already given — a counter left behind (a restored backup) catches up instead of making
 * every payment collide.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-receipts-it';
let pool; let nextReceiptNo; let findReceiptGaps;

const inTransaction = async work => {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const out = await work(conn); await conn.commit(); return out; }
  catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
};
const clean = async () => {
  for (const table of ['payments', 'receipt_counters', 'subscribers']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
};
const addPayment = (conn, id, receiptNo, deleted = false) => conn.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, date, payment_no, amount, currency, amount_egp, payment_type, payment_method, status, branch, receipt_no, deleted_at)
   VALUES (?, ?, 'sub-rc-1', NOW(), ?, 100, 'EGP', 100, 'COURSE', 'خزنة الدقي', 'paid', 'DAQQI', ?, ?)`,
  [id, TENANT, 880000 + Number(receiptNo), receiptNo, deleted ? new Date() : null]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ nextReceiptNo, findReceiptGaps } = require('../../lib/receiptNumbers'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('sub-rc-1', ?, 'عميل', '1019000001')", [TENANT]);
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

test('the numbers run 1, 2, 3 in order, and a rolled-back payment gives its number back', { skip }, async () => {
  assert.equal(await inTransaction(conn => nextReceiptNo(conn, { tenantId: TENANT, branch: 'DAQQI' })), 1);
  assert.equal(await inTransaction(conn => nextReceiptNo(conn, { tenantId: TENANT, branch: 'daqqi' })), 2);
  await assert.rejects(inTransaction(async conn => { assert.equal(await nextReceiptNo(conn, { tenantId: TENANT, branch: 'DAQQI' }), 3); throw new Error('payment failed'); }));
  assert.equal(await inTransaction(conn => nextReceiptNo(conn, { tenantId: TENANT, branch: 'DAQQI' })), 3, 'nothing was skipped');
  assert.equal(await inTransaction(conn => nextReceiptNo(conn, { tenantId: TENANT, branch: 'TAGAMOA' })), 1, "Tagamoa has its own run");
  assert.equal(await inTransaction(conn => nextReceiptNo(conn, { tenantId: TENANT, branch: 'ONLINE_EGYPT' })), null, 'online has none');
});

test('a counter left behind catches up with the numbers already given', { skip }, async () => {
  await pool.query("UPDATE receipt_counters SET last_no = 0 WHERE tenant_id=? AND branch='DAQQI'", [TENANT]);
  await inTransaction(async conn => { for (const no of [1, 2, 3, 4, 5, 7]) await addPayment(conn, `pay-rc-${no}`, no, no === 3); });
  assert.equal(await inTransaction(conn => nextReceiptNo(conn, { tenantId: TENANT, branch: 'DAQQI' })), 8, 'after the highest, not 1 again');
});

test('the managers see what is missing and what was removed', { skip }, async () => {
  const [entry] = await findReceiptGaps(pool, { tenantId: TENANT, branches: ['DAQQI'] });
  assert.equal(entry.highest, 7);
  assert.deepEqual(entry.missing, [6]);
  assert.deepEqual(entry.removed.map(row => row.receiptNo), [3]);
});
