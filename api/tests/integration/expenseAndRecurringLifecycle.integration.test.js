'use strict';
/**
 * Expenses and recurring expenses through their routes, on a real MariaDB (these were regular expressions over routes/admin-operations.js and
 * routes/analytics/financial.js): an expense needs a box, a positive amount and a real category; it lands with its branch and number and a journal entry; editing it
 * reverses the old entry and posts the new one, moving it to another branch takes that branch's number; deleting it is soft and takes it out of the books again; only a
 * finance account may write and a read-only one is refused; and the cash-flow and VAT reports read the ledger and the expenses table as they now stand. A recurring
 * expense is validated, keeps its branch, is audited and is deleted softly. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-expense-life-it';
let pool; let expenses; let analytics;

const ACCOUNTANT = { id: 'st-el-acc', name: 'محاسب', role: 'accountant', permissions_json: '["view_financial","manage_financial"]' };
const VIEWER = { id: 'st-el-view', name: 'مشاهد', role: 'sales', permissions_json: '["view_financial"]' };

async function call(router, method, route, { params = {}, body = {}, query = {}, staff = ACCOUNTANT } = {}) {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; }, setHeader() {} };
  const req = { params, body, query, headers: {}, tenantId: T, user: { uid: 'u', email: 'acc-el@example.test' }, staffRecord: staff, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'financial_audit_log', 'recurring_expenses', 'expenses', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const BOX = 'خزنة الدقي - كاش';
const add = (body, staff) => call(expenses, 'post', '/api/admin/expenses', { body: { description: 'فاتورة', amount: 300, currency: 'EGP', category: 'OTHER', date: '2026-10-05', branchType: 'DAQQI', boxMethod: BOX, ...body }, staff });
const row = async id => (await pool.query('SELECT description, amount, branch_id, expense_no, category, deleted_at FROM expenses WHERE id=?', [id]))[0][0];
const netCash = async () => (await call(analytics, 'get', '/api/admin/financial/cash-flow', { query: { from: '2026-10-01', to: '2026-10-31' } })).body.operating.netOperatingCashFlow;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  expenses = require('../../routes/admin-operations');
  analytics = require('../../routes/analytics/financial');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-el-acc', ?, 'محاسب', 'acc-el@example.test', '1019200001', 'ACCOUNTANT', 1, '2025-01-01'),
       ('st-el-view', ?, 'مشاهد', 'view-el@example.test', '1019200002', 'ACCOUNTANT', 1, '2025-01-01')`, [T, T]);
  // 1,000 taken in cash in October
  await pool.query("INSERT INTO journal_entries (id, tenant_id, ref_type, entry_date, description, total_debit, total_credit, posted_by, branch_id) VALUES ('je-el-1', ?, 'payment', '2026-10-02', 'دفعة', 1000, 1000, 'x', 'branch-daqqi')", [T]);
  await pool.query("INSERT INTO journal_entry_lines (id, entry_id, account_code, account_name, debit, credit) VALUES (UUID(), 'je-el-1', '1100', 'النقدية', 1000, 0), (UUID(), 'je-el-1', '4100', 'إيراد', 0, 1000)");
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('an expense needs a box, a positive amount, a date and a known currency; a read-only account cannot write', { skip }, async () => {
  assert.equal((await add({ boxMethod: '' })).body.code, 'EXPENSE_BOX_REQUIRED');
  assert.equal((await add({ amount: 0 })).statusCode, 400);
  assert.equal((await add({ amount: -5 })).statusCode, 400);
  assert.equal((await add({ date: 'sometime' })).statusCode, 400);
  assert.equal((await add({ currency: 'XYZ' })).statusCode, 400);
  assert.equal((await add({}, VIEWER)).statusCode, 403, 'view_financial alone does not write');
  assert.equal((await call(expenses, 'get', '/api/admin/expenses', { staff: VIEWER })).statusCode, 200, 'but it reads');
  assert.equal((await pool.query('SELECT id FROM expenses WHERE tenant_id=?', [T]))[0].length, 0, 'none of them was written');
});

test('create, edit, move and delete leave the books where the expense now stands', { skip }, async () => {
  const made = await add({ amount: 300 });
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  let state = await row(made.body.id);
  assert.equal(state.branch_id, 'branch-daqqi');
  assert.ok(made.body.expenseNo && state.expense_no, 'the branch\'s next number');
  assert.equal(await netCash(), 700, '1,000 in, 300 out');

  const edited = await call(expenses, 'patch', '/api/admin/expenses/:id', { params: { id: made.body.id }, body: { description: 'فاتورة معدّلة', amount: 450, currency: 'EGP', category: 'OTHER', date: '2026-10-05', branchType: 'DAQQI', boxMethod: BOX } });
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.body));
  state = await row(made.body.id);
  assert.deepEqual([state.description, Number(state.amount)], ['فاتورة معدّلة', 450]);
  assert.equal(await netCash(), 550, 'the old entry is reversed and 450 posted, not 300 and 450 together');
  const vat = await call(analytics, 'get', '/api/admin/financial/vat-summary', { query: { from: '2026-10-01', to: '2026-10-31' } });
  assert.equal(vat.body.total_expenses, 450, 'the expenses report reads the table as it now is');
  const rate = vat.body.vat_rate_standard;
  assert.equal(vat.body.estimated_output_vat, Number((1000 - 1000 / (1 + rate / 100)).toFixed(2)), 'output VAT is estimated from the ledger\'s revenue, not from the expenses');

  const moved = await call(expenses, 'patch', '/api/admin/expenses/:id', { params: { id: made.body.id }, body: { description: 'فاتورة معدّلة', amount: 450, currency: 'EGP', category: 'OTHER', date: '2026-10-05', branchType: 'ONLINE_EGYPT', boxMethod: BOX } });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  state = await row(made.body.id);
  assert.equal(state.branch_id, 'branch-online-egypt');
  assert.notEqual(state.expense_no, made.body.expenseNo, 'it leaves the Daqqi number behind');

  assert.equal((await call(expenses, 'patch', '/api/admin/expenses/:id', { params: { id: 'nope' }, body: { amount: 5 } })).statusCode, 404);
  assert.equal((await call(expenses, 'patch', '/api/admin/expenses/:id', { params: { id: made.body.id }, body: { amount: -1 } })).statusCode, 400);

  assert.equal((await call(expenses, 'delete', '/api/admin/expenses/:id', { params: { id: made.body.id }, staff: VIEWER })).statusCode, 403);
  assert.equal((await call(expenses, 'delete', '/api/admin/expenses/:id', { params: { id: made.body.id } })).statusCode, 200);
  assert.ok((await row(made.body.id)).deleted_at, 'soft: the row stays, marked deleted');
  assert.equal(await netCash(), 1000, 'and the books are as if it never was');
  const vatAfter = await call(analytics, 'get', '/api/admin/financial/vat-summary', { query: { from: '2026-10-01', to: '2026-10-31' } });
  assert.equal(vatAfter.body.total_expenses, 0);
  const list = await call(expenses, 'get', '/api/admin/expenses');
  assert.ok(!list.body.some(item => item.id === made.body.id), 'off the list');
  assert.equal((await call(expenses, 'delete', '/api/admin/expenses/:id', { params: { id: made.body.id } })).statusCode, 404, 'a deleted expense is not found again');
});

test('a recurring expense is validated, keeps its branch, is audited, and is deleted softly', { skip }, async () => {
  const create = body => call(analytics, 'post', '/api/admin/recurring-expenses', { body: { title: 'إيجار', amount_egp: 5000, category: 'RENT', frequency: 'monthly', day_of_month: 1, branch: 'DAQQI', ...body } });
  for (const bad of [{ title: ' ' }, { amount_egp: 0 }, { amount_egp: 'lots' }, { frequency: 'daily' }, { day_of_month: 31 }, { day_of_month: 0 }, { category: 'NOT_A_CATEGORY' }]) {
    assert.equal((await create(bad)).statusCode, 400, JSON.stringify(bad));
  }
  assert.equal((await create({})).statusCode, 200, 'sanity: the accountant writes');
  const read = await call(analytics, 'post', '/api/admin/recurring-expenses', { body: { title: 'x', amount_egp: 1 }, staff: VIEWER });
  assert.equal(read.statusCode, 403);
  const [[saved]] = await pool.query("SELECT id, branch_id, frequency, day_of_month FROM recurring_expenses WHERE tenant_id=? AND title='إيجار'", [T]);
  assert.equal(saved.branch_id, 'branch-daqqi');
  const [audit] = await pool.query("SELECT action FROM financial_audit_log WHERE tenant_id=? AND entity_type='recurring_expense' AND entity_id=?", [T, saved.id]);
  assert.deepEqual(audit.map(item => item.action), ['create']);
  assert.equal((await call(analytics, 'get', '/api/admin/recurring-expenses')).body.length, 1);
  assert.equal((await call(analytics, 'delete', '/api/admin/recurring-expenses/:id', { params: { id: saved.id } })).statusCode, 200);
  assert.ok((await pool.query('SELECT deleted_at FROM recurring_expenses WHERE id=?', [saved.id]))[0][0].deleted_at, 'soft');
  assert.equal((await call(analytics, 'get', '/api/admin/recurring-expenses')).body.length, 0);
  assert.equal((await call(analytics, 'delete', '/api/admin/recurring-expenses/:id', { params: { id: saved.id } })).statusCode, 404);
  assert.deepEqual((await pool.query("SELECT action FROM financial_audit_log WHERE tenant_id=? AND entity_id=? ORDER BY action", [T, saved.id]))[0].map(item => item.action), ['create', 'delete']);
});
