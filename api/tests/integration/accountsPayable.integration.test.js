'use strict';
/**
 * Accounts payable as it behaves, on a real MariaDB (these were regular expressions over routes/finance-operations.js: `AP_APPROVAL_SOD`, `AP_PAYMENT_SOD`,
 * «Only a draft payable can be voided», `paymentAmount > remaining`): a vendor invoice is a draft that its author cannot approve; approving posts the accrual
 * journal; only a draft is voided, with a reason; a payment needs an approved payable and a third person (neither author nor approver), cannot exceed the
 * balance, posts its own journal, and the payable goes partially paid, then paid. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-ap-it';
let pool; let router;

async function call(path, { email, body = {}, params = {} }) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods.post);
  assert.ok(layer, path);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: `u-${email}`, email }, staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

const AUTHOR = 'author-ap@example.test'; const APPROVER = 'approver-ap@example.test'; const PAYER = 'payer-ap@example.test';
let vendor; let n = 0;

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'accounts_payable_payments', 'accounts_payable_invoices', 'finance_vendors', 'financial_audit_log', 'tenant_chart_of_accounts', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const invoice = async (total = 1000) => {
  n += 1;
  const res = await call('/api/admin/finance/payables', { email: AUTHOR, body: { vendor_id: vendor, branch: 'ONLINE_EGYPT', invoice_number: `INV-${n}`, invoice_date: '2026-11-02', due_date: '2026-12-02', subtotal: total, expense_account_code: '5900' } });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.id;
};
const status = async id => (await pool.query('SELECT status FROM accounts_payable_invoices WHERE id=?', [id]))[0][0].status;
const pay = (id, email, amount, reference) => call('/api/admin/finance/payables/:id/payments', { email, params: { id }, body: { payment_date: '2026-11-05', amount, reference } });
const approve = (id, email) => call('/api/admin/finance/payables/:id/approve', { email, params: { id }, body: { branch: 'ONLINE_EGYPT' } });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/finance-operations');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO tenant_chart_of_accounts (tenant_id, code, name, type, is_active) VALUES
       (?, '1100', 'النقدية', 'asset', 1), (?, '2200', 'الدائنون', 'liability', 1), (?, '5900', 'مصروفات', 'expense', 1)`, [T, T, T]);
  const made = await call('/api/admin/finance/vendors', { email: AUTHOR, body: { name: 'مورد' } });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  vendor = made.body.id;
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('an invoice is a draft; its author cannot approve it; another person approving it posts the accrual', { skip }, async () => {
  const id = await invoice(1000);
  assert.equal(await status(id), 'draft');
  const own = await approve(id, AUTHOR);
  assert.equal(own.statusCode, 409);
  assert.equal(own.body.code, 'AP_APPROVAL_SOD');
  assert.equal(await status(id), 'draft');
  const done = await approve(id, APPROVER);
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.equal(await status(id), 'approved');
  const [lines] = await pool.query('SELECT account_code, debit, credit FROM journal_entry_lines WHERE entry_id=? ORDER BY account_code', [done.body.journal_entry_id]);
  assert.deepEqual(lines.map(line => [line.account_code, Number(line.debit), Number(line.credit)]), [['2200', 0, 1000], ['5900', 1000, 0]], 'expense against the payable');
  assert.equal((await approve(id, PAYER)).statusCode, 409, 'only a draft is approved');
});

test('only a draft is voided, and with a reason; a duplicate vendor invoice and bad dates are refused', { skip }, async () => {
  const id = await invoice(300);
  const bare = await call('/api/admin/finance/payables/:id/void', { email: AUTHOR, params: { id }, body: {} });
  assert.equal(bare.statusCode, 400);
  assert.equal((await call('/api/admin/finance/payables/:id/void', { email: AUTHOR, params: { id }, body: { reason: 'فاتورة غلط' } })).statusCode, 200);
  assert.equal(await status(id), 'void');
  const other = await invoice(300);
  await approve(other, APPROVER);
  const late = await call('/api/admin/finance/payables/:id/void', { email: AUTHOR, params: { id: other }, body: { reason: 'متأخر' } });
  assert.equal(late.statusCode, 409, 'an approved payable is not voided');
  const dup = await call('/api/admin/finance/payables', { email: AUTHOR, body: { vendor_id: vendor, branch: 'ONLINE_EGYPT', invoice_number: 'INV-1', invoice_date: '2026-11-02', due_date: '2026-12-02', subtotal: 5 } });
  assert.equal(dup.statusCode, 409, 'the vendor\'s invoice number is unique');
  const backwards = await call('/api/admin/finance/payables', { email: AUTHOR, body: { vendor_id: vendor, branch: 'ONLINE_EGYPT', invoice_number: 'INV-X', invoice_date: '2026-11-02', due_date: '2026-10-01', subtotal: 5 } });
  assert.equal(backwards.statusCode, 400, 'due before invoiced');
});

test('a payment needs an approved payable and a third person, cannot exceed the balance, and walks the payable to paid', { skip }, async () => {
  const id = await invoice(1000);
  assert.equal((await pay(id, PAYER, 100, 'R-early')).statusCode, 409, 'a draft is not paid');
  await approve(id, APPROVER);
  for (const [email, label] of [[AUTHOR, 'the author'], [APPROVER, 'the approver']]) {
    const same = await pay(id, email, 100, `R-${label}`);
    assert.equal(same.statusCode, 409, label);
    assert.equal(same.body.code, 'AP_PAYMENT_SOD', label);
  }
  const first = await pay(id, PAYER, 400, 'R-1');
  assert.equal(first.statusCode, 201, JSON.stringify(first.body));
  assert.deepEqual([first.body.status, first.body.remaining], ['partially_paid', 600]);
  const over = await pay(id, PAYER, 700, 'R-2');
  assert.equal(over.statusCode, 409);
  assert.equal(over.body.remaining, 600);
  assert.equal((await pay(id, PAYER, 400, 'R-1')).statusCode, 409, 'a payment reference is used once');
  const last = await pay(id, PAYER, 600, 'R-3');
  assert.equal(last.statusCode, 201, JSON.stringify(last.body));
  assert.equal(await status(id), 'paid');
  const [[sum]] = await pool.query('SELECT COALESCE(SUM(amount),0) AS paid, COUNT(*) AS n FROM accounts_payable_payments WHERE payable_id=?', [id]);
  assert.deepEqual([Number(sum.paid), Number(sum.n)], [1000, 2]);
  const [[bank]] = await pool.query("SELECT COALESCE(SUM(jel.credit - jel.debit),0) AS taken FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id=je.id WHERE je.tenant_id=? AND je.ref_type='accounts_payable_payment' AND jel.account_code='1100'", [T]);
  assert.equal(Number(bank.taken), 1000, 'each payment came out of the bank in the books');
});
