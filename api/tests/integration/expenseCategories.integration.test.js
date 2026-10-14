'use strict';
/**
 * «بنود المصروفات في الاعدادات مش مسمعه» and «خلي في المصروف يظهر الفرع والقائم
 * بالعملية»: an expense takes a category from الإعدادات › فئات المصاريف — one added
 * there too — and comes back with its branch and the name of whoever entered it.
 * Real MariaDB.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-expcat-it';
let pool; let router;

const ACCOUNTANT = { id: 'st-ec-acc', name: 'محاسب المعهد', role: 'accountant', permissions: '["view_financial","manage_financial"]' };

async function call(method, route, { params = {}, body = {}, query = {}, staff = ACCOUNTANT } = {}) {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route}`);
  const res = {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; },
    set() { return this; }, setHeader(k, v) { this.headers[k] = v; },
  };
  const req = {
    params, body, query, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'acc@example.test' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  };
  const handlers = layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name));
  for (const handle of handlers) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [TENANT]).catch(() => {});
  for (const table of ['journal_entries', 'expenses', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('st-ec-acc', ?, 'محاسب المعهد', 'acc-ec@example.test', '1019100001', 'ACCOUNTANT', 1, '2025-01-01')`, [TENANT]);
  await require('../../lib/tenantSettings').setTenantSetting('sys_expense_categories', [
    { key: 'rent', label: 'إيجار', is_active: true },
    { key: 'electricity', label: 'كهرباء ومياه', is_active: true },
    { key: 'old_item', label: 'بند قديم', is_active: false },
  ], { tenantId: TENANT });
  router = require('../../routes/admin-operations');
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('the categories are the settings\' active ones', { skip }, async () => {
  const res = await call('get', '/api/admin/expense-categories');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.map(item => item.label), ['إيجار', 'كهرباء ومياه', 'أخرى']);
});

test('a category added in settings is kept, with the branch and who entered it', { skip }, async () => {
  const saved = await call('post', '/api/admin/expenses', {
    body: { description: 'فاتورة أكتوبر', amount: 850, currency: 'EGP', category: 'كهرباء ومياه', date: '2026-10-05', branchType: 'DAQQI' },
  });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.category, 'كهرباء ومياه');
  assert.equal(saved.body.staffName, 'محاسب المعهد');
  const [[row]] = await pool.query('SELECT category, staff_id, branch_id FROM expenses WHERE id=?', [saved.body.id]);
  assert.equal(row.category, 'ELECTRICITY', 'not «أخرى»');
  assert.equal(row.staff_id, 'st-ec-acc');
  assert.equal(row.branch_id, 'branch-daqqi');

  const list = await call('get', '/api/admin/expenses');
  const mine = list.body.find(item => item.id === saved.body.id);
  assert.equal(mine.category, 'كهرباء ومياه');
  assert.equal(mine.staffName, 'محاسب المعهد');
  assert.equal(mine.branchType, 'DAQQI');
});

test('the owner, with no staff row, is named too', { skip }, async () => {
  const saved = await call('post', '/api/admin/expenses', {
    body: { description: 'إيجار', amount: 5000, currency: 'EGP', category: 'إيجار', date: '2026-10-05' }, staff: null,
  });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  const list = await call('get', '/api/admin/expenses', { staff: null });
  const mine = list.body.find(item => item.id === saved.body.id);
  assert.equal(mine.category, 'إيجار');
  assert.ok(mine.staffName, 'someone is named');
});
