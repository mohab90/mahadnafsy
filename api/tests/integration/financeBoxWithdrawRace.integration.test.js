'use strict';
/**
 * Two withdrawals of the same box that arrive together (a double click, two accountants): the balance is read, checked and then written, so
 * without something serialising them both see the full balance and both are taken — the box goes negative with no confirmation asked for.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-boxrace-it';
const BOX = 'خزنة الدقي - كاش';
let pool; let boxes;
const ACCOUNTS = { id: 'st-br-acc', name: 'st-br-acc', role: 'accountant', permissions_json: JSON.stringify(['view_financial', 'manage_financial']) };

async function call(method, path, body = {}) {
  const layer = boxes.stack.find(item => item.route?.path === path && item.route.methods[method]);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params: {}, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'acc-br@example.test', tenant_id: T }, staffRecord: ACCOUNTS, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'financial_audit_log', 'box_withdrawals', 'box_aliases', 'box_balance_events', 'box_balances', 'payments', 'subscribers', 'tenant_chart_of_accounts', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  boxes = require('../../routes/finance/budgets');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('st-br-acc', ?, 'المحاسب', 'acc-br@example.test', '1019700001', 'ACCOUNTANT', 1, '2025-01-01')", [T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES ('sub-br-1', ?, 'عميل', '1019700010', 'ONLINE_EGYPT', 'branch-online-egypt')", [T]);
  await pool.query("INSERT INTO tenant_chart_of_accounts (tenant_id, code, name, type, is_active) VALUES (?, '1100', 'نقدية وبنوك', 'asset', 1), (?, '5100', 'مصروفات تشغيل', 'expense', 1)", [T, T]);
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, currency, status, payment_type, payment_method, date, branch_id, created_at)
     VALUES ('br-p-1', ?, 'sub-br-1', 1000, 1000, 'EGP', 'paid', 'OTHER', ?, NOW(), 'branch-online-egypt', NOW())`, [T, BOX]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('two withdrawals of 800 from a box holding 1,000, sent together: exactly one is taken, the other is refused for the balance', { skip }, async () => {
  const send = () => call('post', '/api/admin/finance/boxes/withdraw', { method: BOX, currency: 'EGP', kind: 'expense', amount: 800, accountCode: '5100' });
  const results = await Promise.all([send(), send()]);
  const taken = results.filter(r => r.statusCode === 200);
  const refused = results.filter(r => r.statusCode !== 200);
  assert.equal(taken.length, 1, JSON.stringify(results.map(r => [r.statusCode, r.body])));
  assert.equal(refused[0].body.code, 'BOX_INSUFFICIENT');
  const [[sum]] = await pool.query("SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM box_withdrawals WHERE tenant_id=? AND voided_at IS NULL", [T]);
  assert.equal(Number(sum.total), 800);
  const [entries] = await pool.query("SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id=? AND ref_type='box_withdrawal'", [T]);
  assert.equal(Number(entries[0].n), 1, 'one entry for the one withdrawal');
});
