'use strict';
/**
 * A double click on «حفظ» made two expenses with two expense numbers (and a journal entry each). The form sends one key per opened form; the server keeps it (migration 386)
 * and answers a repeat with the first result. On a real MariaDB, through the routes: an expense pressed twice, then pressed twice at the SAME INSTANT; two genuinely identical
 * expenses typed apart (two keys) both save; a request with no key (an old client) saves as it always did; a box withdrawal and a manual journal entry the same way.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-finance-idem-it';
let pool; let expenses; let boxes; let accounting;

const ACCOUNTANT = { id: 'st-id-acc', name: 'محاسب', role: 'accountant', permissions_json: '["view_financial","manage_financial"]' };

async function call(router, method, route, { body = {}, staff = ACCOUNTANT } = {}) {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; }, setHeader() {} };
  const req = { params: {}, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'acc-id@example.test', tenant_id: T }, staffRecord: staff, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

const BOX = 'خزنة الدقي - كاش';
const addExpense = body => call(expenses, 'post', '/api/admin/expenses', { body: { description: 'فاتورة كهرباء', amount: 300, currency: 'EGP', category: 'OTHER', date: '2026-10-05', branchType: 'DAQQI', boxMethod: BOX, ...body } });
const expenseRows = async () => (await pool.query('SELECT id, expense_no, idempotency_key FROM expenses WHERE tenant_id=? AND deleted_at IS NULL ORDER BY expense_no', [T]))[0];
const journalCount = async refType => (await pool.query('SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id=? AND ref_type=?', [T, refType]))[0][0].n;

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'financial_audit_log', 'box_withdrawals', 'box_balance_events', 'box_balances', 'receipt_counters', 'expenses', 'payments', 'tenant_chart_of_accounts', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  expenses = require('../../routes/admin-operations');
  boxes = require('../../routes/finance/budgets');
  accounting = require('../../routes/accounting-erp');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('st-id-acc', ?, 'محاسب', 'acc-id@example.test', '1019300001', 'ACCOUNTANT', 1, '2025-01-01')", [T]);
  await pool.query("INSERT INTO tenant_chart_of_accounts (tenant_id, code, name, type, is_active) VALUES (?, '1100', 'نقدية وبنوك', 'asset', 1), (?, '5100', 'مصروفات تشغيل', 'expense', 1), (?, '4100', 'إيراد', 'revenue', 1)", [T, T, T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES ('sub-id-1', ?, 'عميل', '1019300010', 'ONLINE_EGYPT', 'branch-online-egypt') ON DUPLICATE KEY UPDATE name=name", [T]).catch(() => {});
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, currency, status, payment_type, payment_method, date, branch_id, created_at)
     VALUES ('id-p-1', ?, 'sub-id-1', 5000, 5000, 'EGP', 'paid', 'OTHER', ?, NOW(), 'branch-online-egypt', NOW())`, [T, BOX]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.query('DELETE FROM subscribers WHERE tenant_id=?', [T]).catch(() => {});
  await pool.end();
});

test('an expense pressed twice with the same key is one expense with one number and one journal entry', { skip }, async () => {
  const first = await addExpense({ idempotencyKey: 'form-one-aaaaaaaa' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const second = await addExpense({ idempotencyKey: 'form-one-aaaaaaaa' });
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.id, first.body.id, 'the first one is answered again');
  assert.equal(second.body.expenseNo, first.body.expenseNo);
  assert.equal(second.body.repeated, true);
  assert.equal((await expenseRows()).length, 1);
  assert.equal(await journalCount('expense'), 1, 'and posted once');
});

test('two presses at the same instant are still one expense', { skip }, async () => {
  const [a, b] = await Promise.all([addExpense({ idempotencyKey: 'form-race-bbbbbbbb' }), addExpense({ idempotencyKey: 'form-race-bbbbbbbb' })]);
  assert.equal(a.statusCode, 200, JSON.stringify(a.body));
  assert.equal(b.statusCode, 200, JSON.stringify(b.body));
  assert.equal(a.body.id, b.body.id);
  assert.equal((await expenseRows()).filter(row => row.idempotency_key === 'form-race-bbbbbbbb').length, 1);
  assert.equal(await journalCount('expense'), 2, 'one entry for each of the two expenses so far');
});

test('two genuinely identical expenses typed apart both save, and so does a request with no key', { skip }, async () => {
  const before = (await expenseRows()).length;
  const one = await addExpense({ idempotencyKey: 'form-two-cccccccc' });
  const two = await addExpense({ idempotencyKey: 'form-three-dddddddd' });
  const old = await addExpense({});
  const older = await addExpense({});
  for (const res of [one, two, old, older]) assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(new Set([one.body.id, two.body.id, old.body.id, older.body.id]).size, 4);
  assert.equal((await expenseRows()).length, before + 4);
  const numbers = (await expenseRows()).map(row => row.expense_no);
  assert.equal(new Set(numbers).size, numbers.length, 'every one has its own number');
});

test('a malformed key is no key: the expense is saved, never refused', { skip }, async () => {
  const before = (await expenseRows()).length;
  const res = await addExpense({ idempotencyKey: 'x' });
  assert.equal(res.statusCode, 200);
  assert.equal((await expenseRows()).length, before + 1);
});

test('a box withdrawal pressed twice takes the money out once', { skip }, async () => {
  const withdraw = body => call(boxes, 'post', '/api/admin/finance/boxes/withdraw', { body: { method: BOX, currency: 'EGP', amount: 100, kind: 'partner', partner: 'mohab', ...body } });
  const first = await withdraw({ idempotencyKey: 'withdraw-one-eeeeeee' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const second = await withdraw({ idempotencyKey: 'withdraw-one-eeeeeee' });
  assert.equal(second.statusCode, 200, JSON.stringify(second.body));
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.repeated, true);
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM box_withdrawals WHERE tenant_id=?', [T]))[0][0].n, 1);
  assert.equal(await journalCount('box_withdrawal'), 1);
  assert.equal((await pool.query("SELECT COUNT(*) AS n FROM financial_audit_log WHERE tenant_id=? AND action='box_withdraw'", [T]))[0][0].n, 1, 'and audited once');
  const another = await withdraw({ idempotencyKey: 'withdraw-two-fffffff' });
  assert.equal(another.statusCode, 200);
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM box_withdrawals WHERE tenant_id=?', [T]))[0][0].n, 2, 'a second withdrawal typed apart is a second withdrawal');
});

test('a manual journal entry pressed twice is posted once', { skip }, async () => {
  const post = body => call(accounting, 'post', '/api/admin/accounting/journal-entries', {
    body: { date: '2026-10-06', description: 'تسوية يدوية', lines: [{ account_code: '5100', debit: 50, credit: 0 }, { account_code: '1100', debit: 0, credit: 50 }], ...body } });
  const first = await post({ idempotencyKey: 'journal-one-ggggggg' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const second = await post({ idempotencyKey: 'journal-one-ggggggg' });
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.entry.id, first.body.entry.id);
  assert.equal(await journalCount('manual'), 1);
  assert.equal((await post({ idempotencyKey: 'journal-two-hhhhhhh' })).statusCode, 200);
  assert.equal(await journalCount('manual'), 2);
});
