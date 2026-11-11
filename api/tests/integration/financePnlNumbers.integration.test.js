'use strict';
/**
 * GET /api/admin/financial/pnl answered expensesByCategory[].total as a DECIMAL string ("1250.00"): a screen that adds the categories up concatenated them. On a real MariaDB the
 * route answers numbers, and the numbers are the categories' sums in pounds.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-finance-pnl-it';
let pool; let analytics;
const ACCOUNTANT = { id: 'st-pn-acc', name: 'محاسب', role: 'accountant', permissions_json: '["view_financial"]' };

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  analytics = require('../../routes/analytics/financial');
  await pool.query('DELETE FROM expenses WHERE tenant_id=?', [T]);
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  const add = (id, amount, egp, category) => pool.query(
    "INSERT INTO expenses (id, tenant_id, description, amount, currency, amount_egp, category, date) VALUES (?, ?, 'x', ?, 'EGP', ?, ?, '2026-10-05 10:00:00')", [id, T, amount, egp, category]);
  await add('pn-e-1', 1000.5, 1000.5, 'RENT');
  await add('pn-e-2', 249.5, 249.5, 'RENT');
  await add('pn-e-3', 80, 80, 'OTHER');
});
after(async () => {
  if (!ENABLED) return;
  await pool.query('DELETE FROM expenses WHERE tenant_id=?', [T]);
  await pool.end();
});

test('the expenses by category are numbers', { skip }, async () => {
  const layer = analytics.stack.find(item => item.route?.path === '/api/admin/financial/pnl' && item.route.methods.get);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  const req = { params: {}, body: {}, query: { from: '2026-10-01', to: '2026-10-31' }, headers: {}, tenantId: T, user: { uid: 'u', email: 'a@example.test', tenant_id: T }, staffRecord: ACCOUNTANT, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const rows = res.body.expensesByCategory;
  assert.deepEqual(rows.map(row => [row.category, row.total, row.count]), [['RENT', 1250, 2], ['OTHER', 80, 1]]);
  for (const row of rows) assert.equal(typeof row.total, 'number');
  assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 1330, 'adding them up adds numbers');
});
