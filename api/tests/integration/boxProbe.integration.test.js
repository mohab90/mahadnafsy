'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const T = 'tenant-boxprobe';
let pool; let boxes;
const ACC = { id: 'st-p', name: 'p', role: 'accountant', permissions_json: JSON.stringify(['view_financial', 'manage_financial']) };
async function call(method, path, { body = {}, query = {} } = {}) {
  const layer = boxes.stack.find(item => item.route?.path === path && item.route.methods[method]);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, set() { return this; } };
  const req = { params: {}, body, query, headers: {}, tenantId: T, user: { uid: 'u', email: 'a@example.test', tenant_id: T }, staffRecord: ACC, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(e => e.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let adv = false; await handle(req, res, () => { adv = true; }); if (!adv) break;
  }
  return res;
}
let seq = 0;
const pay = (m, a, cur) => pool.query(`INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, currency, status, payment_type, payment_method, date, branch_id, created_at) VALUES (?,?,?,?,?,?, 'paid','OTHER',?,NOW(),'branch-online-egypt',NOW())`, [`pp-${++seq}`, T, 'sub-p', a, a, cur, m]);
before(async () => {
  ({ pool } = require('../../lib/db'));
  boxes = require('../../routes/finance/budgets');
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES ('sub-p', ?, 'c', '1019600099', 'ONLINE_EGYPT', 'branch-online-egypt')", [T]);
  await setTenantSetting('content', { 'finance.payment_methods': ['خزنة الدقي - كاش','فودافون كاش 4645','فودافون كاش السعودية','تحويل لأحمد السعودية','ويسترن يونيون','انستا باي 7720','بنك الراجحي','محفظة جديدة 9090'].join('||') }, { tenantId: T });
  await pay('فودافون كاش 4645', 1000, 'EGP'); await pay('فودافون كاش 4645', 200, 'SAR');
  await pay('فودافون كاش السعودية', 300, 'SAR'); await pay('بنك الراجحي', 500, 'SAR'); await pay('ويسترن يونيون', 100, 'USD');
  await pay('انستا باي 7720', 10, 'USD'); await pay('بنك قديم', 77, 'EGP');
});
after(async () => { await pool.end(); });
test('probe', async () => {
  const r = await call('get', '/api/admin/finance/boxes');
  console.log(JSON.stringify(r.body.boxes.map(b => [b.method, b.currency, b.balance, b.totals[30]])));
  const o = await call('get', '/api/admin/finance/box-options');
  console.log(JSON.stringify(o.body.map(b => [b.method, b.currency, b.balance])));
});
