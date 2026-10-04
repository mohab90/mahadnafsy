'use strict';
/**
 * A month's payroll run end to end against a real MariaDB — what
 * payrollIntegrity.test.js and hrWorkflowIntegrity.test.js could only read off
 * the source as text:
 *   - only APPROVED bonuses, the month's commissions and the advances due count;
 *     an advance bigger than the salary is recovered only up to the salary
 *   - recalculating rebuilds the same run with the same figures, and does not
 *     take a commission twice
 *   - the person who calculated cannot approve, the approver cannot pay, and a
 *     run is never paid before it is approved
 *   - paying posts one balanced entry (salary cost = cash + advances recovered
 *     + statutory withheld), marks the commissions PAID and closes only the
 *     advances the salary covered
 *   - cancelling a run hands its commissions back to the next one
 *   - a branch run cannot overlap a whole-institute run for the same month
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
const T = 'tenant-payroll-run-it';
// A closed month, so nothing depends on today's date.
const MONTH = 8;
const YEAR = 2026;
let pool, router;

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'financial_audit_log', 'payroll_items', 'payroll_runs', 'payroll_period_locks',
    'crm_commissions', 'salary_advances', 'employee_bonuses', 'salary_structures', 'attendance_logs', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}

const handler = (method, path) => router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle;
async function call(method, path, { actor, params = {}, body = {} }) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await handler(method, path)({
    params, query: {}, body, headers: {}, tenantId: T, user: { uid: actor, email: `${actor}@example.test` },
    staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined,
  }, res);
  return res;
}
const calculate = (actor, body = {}) => call('post', '/api/admin/hr/payroll/calculate', { actor, body: { month: MONTH, year: YEAR, ...body } });
const setStatus = (actor, runId, status) => call('put', '/api/admin/hr/payroll/:runId/status', { actor, params: { runId }, body: { status } });
const item = (res, staffId) => res.body.items.find(i => i.staff_id === staffId);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/hr/payroll');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Payroll IT', 'suspended')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary, branch_id) VALUES
       ('pr-sara', ?, 'سارة', 'pr1@x.t', '1017000001', 'SALES', 1, '2025-01-01', NULL, 'branch-daqqi'),
       ('pr-omar', ?, 'عمر', 'pr2@x.t', '1017000002', 'SALES', 1, '2025-01-01', 2600, 'branch-daqqi')`, [T, T]);
  // Sara: an approved structure — 6,500 basic, 500 housing, 300 insurance withheld.
  await pool.query(
    `INSERT INTO salary_structures (id, tenant_id, staff_id, base_salary, housing_allowance, transport_allowance, food_allowance,
       other_fixed, deduction_social_insurance, deduction_tax, currency, status, effective_from)
     VALUES ('ss-sara', ?, 'pr-sara', 6500, 500, 0, 0, 0, 300, 0, 'EGP', 'APPROVED', '2026-01-01')`, [T]);
  // Bonuses: one approved, one still pending (must not count).
  await pool.query(
    `INSERT INTO employee_bonuses (id, tenant_id, staff_id, amount, type, status, currency, for_month, for_year) VALUES
       ('bn-1', ?, 'pr-sara', 400, 'bonus', 'APPROVED', 'EGP', ?, ?),
       ('bn-2', ?, 'pr-sara', 9999, 'bonus', 'PENDING', 'EGP', ?, ?)`, [T, MONTH, YEAR, T, MONTH, YEAR]);
  // Commissions this month (two) and last month (must not count).
  await pool.query(
    `INSERT INTO crm_commissions (id, tenant_id, staff_id, payment_id, payment_amount, commission_amount, month, year, status) VALUES
       ('cm-1', ?, 'pr-sara', 'pay-1', 5000, 250, ?, ?, 'PENDING'),
       ('cm-2', ?, 'pr-sara', 'pay-2', 3000, 150, ?, ?, 'PENDING'),
       ('cm-old', ?, 'pr-sara', 'pay-0', 2000, 100, ?, ?, 'PENDING')`,
    [T, MONTH, YEAR, T, MONTH, YEAR, T, MONTH - 1, YEAR]);
  // Advances due this month: Sara 1,000 (covered); Omar 5,000, more than his 2,600 salary.
  await pool.query(
    `INSERT INTO salary_advances (id, tenant_id, staff_id, amount, currency, status, deduct_month, deduct_year) VALUES
       ('adv-sara', ?, 'pr-sara', 1000, 'EGP', 'DISBURSED', ?, ?),
       ('adv-omar', ?, 'pr-omar', 5000, 'EGP', 'DISBURSED', ?, ?)`, [T, MONTH, YEAR, T, MONTH, YEAR]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

let runId;
let first;

test('a month\'s run counts the approved bonus, the month\'s commissions and what the salary can recover', { skip }, async () => {
  first = await calculate('hr-calc');
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  runId = first.body.run.id;
  const sara = item(first, 'pr-sara');
  assert.equal(sara.base_salary, 6500);
  assert.equal(sara.bonus, 400, 'the pending bonus is not paid');
  assert.equal(sara.commission, 400, '250 + 150; last month\'s 100 belongs to last month');
  assert.equal(sara.advance_deductions, 1000);
  assert.equal(sara.other_deductions, 300, 'insurance withheld');
  // 6500 + 500 housing + 400 bonus + 400 commission − 300 insurance − 1000 advance
  assert.equal(sara.net_salary, 6500);
  const omar = item(first, 'pr-omar');
  assert.equal(omar.base_salary, 2600, 'no structure: the staff file\'s basic salary');
  assert.equal(omar.advance_deductions, 2600, 'an advance is recovered only up to what the salary carries');
  assert.equal(omar.net_salary, 0);

  const [commissions] = await pool.query('SELECT id, status, payroll_run_id FROM crm_commissions WHERE tenant_id=? ORDER BY id', [T]);
  assert.deepEqual(commissions.map(c => [c.id, c.status]),
    [['cm-1', 'INCLUDED_IN_PAYROLL'], ['cm-2', 'INCLUDED_IN_PAYROLL'], ['cm-old', 'PENDING']]);
});

test('recalculating rebuilds the same run with the same figures', { skip }, async () => {
  const again = await calculate('hr-calc');
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.run.id, runId);
  assert.equal(again.body.items.length, 2);
  assert.equal(item(again, 'pr-sara').commission, 400, 'reserved commissions are released and taken once');
  assert.equal(again.body.run.total_amount, first.body.run.total_amount);
});

test('a branch run cannot overlap the whole-institute run of the same month', { skip }, async () => {
  const branch = await calculate('hr-calc', { branch_id: 'branch-daqqi' });
  assert.equal(branch.statusCode, 409);
  assert.equal(branch.body.code, 'PAYROLL_SCOPE_OVERLAP');
});

test('no paying before approval, and no one person calculating and approving, or approving and paying', { skip }, async () => {
  assert.equal((await setStatus('fin-pay', runId, 'PAID')).statusCode, 409, 'not approved yet');
  const selfApprove = await setStatus('hr-calc', runId, 'APPROVED');
  assert.equal(selfApprove.statusCode, 409);
  assert.equal(selfApprove.body.code, 'PAYROLL_SOD');
  assert.equal((await setStatus('fin-approve', runId, 'APPROVED')).statusCode, 200);
  const selfPay = await setStatus('fin-approve', runId, 'PAID');
  assert.equal(selfPay.body.code, 'PAYROLL_SOD');
  assert.equal((await calculate('hr-calc')).statusCode, 409, 'an approved run is not recalculated');
});

test('paying posts one balanced entry and settles commissions and the covered advances only', { skip }, async () => {
  const paid = await setStatus('fin-pay', runId, 'PAID');
  assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
  const [lines] = await pool.query(
    `SELECT l.account_code, l.debit, l.credit FROM journal_entry_lines l
       JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.tenant_id=? AND e.ref_type='payroll' AND e.ref_id=? ORDER BY l.account_code`, [T, runId]);
  const by = Object.fromEntries(lines.map(l => [l.account_code, { debit: Number(l.debit), credit: Number(l.credit) }]));
  // Net 6500 + 0 cash, 1000 + 2600 advances recovered, 300 insurance withheld.
  assert.equal(by['1100'].credit, 6500);
  assert.equal(by['1300'].credit, 3600);
  assert.equal(by['2200'].credit, 300);
  assert.equal(by['5100'].debit, 10400);
  const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
  assert.equal(debit.toFixed(2), credit.toFixed(2), 'the entry balances');

  const [commissions] = await pool.query("SELECT id, status FROM crm_commissions WHERE tenant_id=? ORDER BY id", [T]);
  assert.deepEqual(commissions.map(c => c.status), ['PAID', 'PAID', 'PENDING']);
  const [advances] = await pool.query('SELECT id, status FROM salary_advances WHERE tenant_id=? ORDER BY id', [T]);
  assert.deepEqual(advances.map(a => [a.id, a.status]), [['adv-omar', 'DISBURSED'], ['adv-sara', 'DEDUCTED']],
    'Omar still owes what his salary could not cover');
  assert.equal((await setStatus('fin-other', runId, 'PAID')).statusCode, 409, 'paid once');
});

test('cancelling a run hands its commissions back to the next one', { skip }, async () => {
  // A fresh month for this: September.
  const sept = await call('post', '/api/admin/hr/payroll/calculate', { actor: 'hr-calc', body: { month: MONTH + 1, year: YEAR } });
  assert.equal(sept.statusCode, 200, JSON.stringify(sept.body));
  await pool.query(
    "INSERT INTO crm_commissions (id, tenant_id, staff_id, payment_id, payment_amount, commission_amount, month, year, status) VALUES ('cm-sep', ?, 'pr-sara', 'pay-9', 1000, 50, ?, ?, 'PENDING')",
    [T, MONTH + 1, YEAR]);
  const withIt = await call('post', '/api/admin/hr/payroll/calculate', { actor: 'hr-calc', body: { month: MONTH + 1, year: YEAR } });
  assert.equal(item(withIt, 'pr-sara').commission, 50);
  assert.equal((await setStatus('hr-calc', withIt.body.run.id, 'CANCELLED')).statusCode, 200);
  const [[cm]] = await pool.query("SELECT status, payroll_run_id FROM crm_commissions WHERE tenant_id=? AND id='cm-sep'", [T]);
  assert.equal(cm.status, 'PENDING');
  assert.equal(cm.payroll_run_id, null);
});
