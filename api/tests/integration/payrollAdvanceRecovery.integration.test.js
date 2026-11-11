'use strict';
/**
 * Salary advances across months (migration 385, 11 Nov 2026, «موافق لعمود السلف») against a real MariaDB:
 *   - an advance the salary could not absorb comes round in the next runs until it is recovered, oldest first, and only as far as the salary carries it
 *   - CALCULATE writes nothing to an advance: a recalculation and a cancelled run leave recovered_amount as it was
 *   - PAID adds exactly what the payslip took; the advance becomes DEDUCTED when fully recovered
 *   - an advance is never recovered twice: a payslip that took from an advance another paid run has since recovered refuses to be paid until the run is calculated again
 *   - the payslip says which advances were taken from and what is still owed
 *   - the migration credits recovered_amount for past months only where the paid payslip's figure is exact
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-advance-recovery-it';
const YEAR = 2026;
let pool, router;

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'financial_audit_log', 'payroll_items', 'payroll_runs', 'payroll_period_locks', 'salary_advances', 'attendance_logs', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}

const handler = (method, route) => router.stack.find(l => l.route?.path === route && l.route.methods[method]).route.stack.at(-1).handle;
async function call(method, route, { actor, params = {}, body = {} }) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await handler(method, route)({
    params, query: {}, body, headers: {}, tenantId: T, user: { uid: actor, email: `${actor}@example.test` },
    staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined,
  }, res);
  return res;
}
const calculate = month => call('post', '/api/admin/hr/payroll/calculate', { actor: 'hr-calc', body: { month, year: YEAR } });
const setStatus = (actor, runId, status) => call('put', '/api/admin/hr/payroll/:runId/status', { actor, params: { runId }, body: { status } });
const item = (res, staffId) => res.body.items.find(i => i.staff_id === staffId);
const details = row => (typeof row.calculation_details === 'string' ? JSON.parse(row.calculation_details) : row.calculation_details);
const advance = async id => { const [[row]] = await pool.query('SELECT status, amount, recovered_amount, deducted_payroll_run_id FROM salary_advances WHERE tenant_id=? AND id=?', [T, id]); return { status: row.status, recovered: Number(row.recovered_amount), run: row.deducted_payroll_run_id }; };
const pay = async runId => {
  assert.equal((await setStatus('fin-approve', runId, 'APPROVED')).statusCode, 200);
  return setStatus('fin-pay', runId, 'PAID');
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/hr/payroll');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Advance IT', 'suspended')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary, branch_id) VALUES
       ('ad-a', ?, 'أ', 'ad1@x.t', '1018000001', 'SALES', 1, '2025-01-01', 3000, 'branch-daqqi'),
       ('ad-b', ?, 'ب', 'ad2@x.t', '1018000002', 'SALES', 1, '2025-01-01', 3000, 'branch-daqqi'),
       -- Nobody owes anything: the run always has some cash to pay out, so the payroll entry has a cash line (a run that nets zero in total posts none).
       ('ad-z', ?, 'ز', 'ad0@x.t', '1018000000', 'SALES', 1, '2025-01-01', 5000, 'branch-daqqi')`, [T, T, T]);
  // A owes 7,000 and B 4,000, both due in March; a salary is 3,000.
  await pool.query(
    `INSERT INTO salary_advances (id, tenant_id, staff_id, amount, currency, status, deduct_month, deduct_year, disbursed_at) VALUES
       ('adv-a', ?, 'ad-a', 7000, 'EGP', 'DISBURSED', 3, ?, '2026-02-20 10:00:00'),
       ('adv-b', ?, 'ad-b', 4000, 'EGP', 'DISBURSED', 3, ?, '2026-02-20 10:00:00')`, [T, YEAR, T, YEAR]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

let march;
let april;

test('a run takes only what the salary carries, writes nothing to the advance, and says on the payslip what is still owed', { skip }, async () => {
  march = await calculate(3);
  assert.equal(march.statusCode, 200, JSON.stringify(march.body));
  assert.equal(item(march, 'ad-a').advance_deductions, 3000);
  assert.equal(item(march, 'ad-a').net_salary, 0);
  const slip = details(item(march, 'ad-a'));
  assert.equal(slip.advanceOwedBefore, 7000);
  assert.equal(slip.advanceOwedAfter, 4000);
  assert.deepEqual(slip.advances.map(a => [a.id, a.applied, a.owedAfter, a.dueMonth]), [['adv-a', 3000, 4000, 3]]);
  assert.deepEqual(await advance('adv-a'), { status: 'DISBURSED', recovered: 0, run: null }, 'calculating changes nothing on the advance');
});

test('a recalculation, and a cancelled run, leave the advances exactly as they were', { skip }, async () => {
  const again = await calculate(3);
  assert.equal(item(again, 'ad-a').advance_deductions, 3000);
  assert.equal(details(item(again, 'ad-a')).advanceOwedAfter, 4000, 'taken once, not twice');
  assert.equal((await setStatus('hr-calc', again.body.run.id, 'CANCELLED')).statusCode, 200);
  assert.deepEqual(await advance('adv-a'), { status: 'DISBURSED', recovered: 0, run: null });
  march = await calculate(3);
  assert.equal(march.statusCode, 200, 'a cancelled month is calculated again');
  assert.equal(item(march, 'ad-a').advance_deductions, 3000);
  assert.deepEqual(await advance('adv-b'), { status: 'DISBURSED', recovered: 0, run: null });
});

test('the next month\'s run carries what March could not, before March is paid it still sees the whole debt', { skip }, async () => {
  april = await calculate(4);
  assert.equal(april.statusCode, 200, JSON.stringify(april.body));
  assert.equal(item(april, 'ad-a').advance_deductions, 3000, 'April was calculated while March is unpaid: it sees the full 7,000');
  assert.equal(details(item(april, 'ad-a')).advanceOwedBefore, 7000);
});

test('paying March recovers 3,000 on each advance; an advance is closed only when it is fully recovered', { skip }, async () => {
  const paid = await pay(march.body.run.id);
  assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
  assert.deepEqual(await advance('adv-a'), { status: 'DISBURSED', recovered: 3000, run: null });
  assert.deepEqual(await advance('adv-b'), { status: 'DISBURSED', recovered: 3000, run: null });
  const [lines] = await pool.query(
    `SELECT l.account_code, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.tenant_id=? AND e.ref_type='payroll' AND e.ref_id=?`, [T, march.body.run.id]);
  assert.equal(Number(lines.find(l => l.account_code === '1300').credit), 6000, 'the entry credits the advances receivable with what was recovered');
});

test('a payslip that took from an advance another paid run has since recovered is not paid: nothing is taken twice', { skip }, async () => {
  // April's payslip for B took 3,000 of a 4,000 advance of which March has now recovered 3,000.
  assert.equal((await setStatus('fin-approve', april.body.run.id, 'APPROVED')).statusCode, 200);
  const refused = await setStatus('fin-pay', april.body.run.id, 'PAID');
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'PAYROLL_ADVANCES_CHANGED');
  assert.deepEqual(await advance('adv-a'), { status: 'DISBURSED', recovered: 3000, run: null }, 'the whole payment rolled back, A included');
  assert.equal((await setStatus('fin-approve', april.body.run.id, 'CANCELLED')).statusCode, 200);
  april = await calculate(4);
  assert.equal(item(april, 'ad-a').advance_deductions, 3000);
  assert.equal(item(april, 'ad-b').advance_deductions, 1000, 'B owes only the 1,000 that is left');
  assert.equal(item(april, 'ad-b').net_salary, 2000);
});

test('partial recovery over three months: 3,000 + 3,000 + 1,000 closes the 7,000 advance, and the closing run is recorded on it', { skip }, async () => {
  assert.equal((await pay(april.body.run.id)).statusCode, 200);
  assert.deepEqual(await advance('adv-a'), { status: 'DISBURSED', recovered: 6000, run: null });
  assert.deepEqual(await advance('adv-b'), { status: 'DEDUCTED', recovered: 4000, run: april.body.run.id });
  const may = await calculate(5);
  assert.equal(item(may, 'ad-a').advance_deductions, 1000, 'only what is left');
  assert.equal(item(may, 'ad-a').net_salary, 2000);
  assert.equal(item(may, 'ad-b').advance_deductions, 0, 'a recovered advance is not taken again');
  assert.equal((await pay(may.body.run.id)).statusCode, 200);
  assert.deepEqual(await advance('adv-a'), { status: 'DEDUCTED', recovered: 7000, run: may.body.run.id });
  const june = await calculate(6);
  assert.equal(item(june, 'ad-a').advance_deductions, 0);
  assert.equal(details(item(june, 'ad-a')).advances.length, 0);
});

test('an advance due in a later month is not touched by an earlier run', { skip }, async () => {
  await pool.query("INSERT INTO salary_advances (id, tenant_id, staff_id, amount, currency, status, deduct_month, deduct_year) VALUES ('adv-later', ?, 'ad-a', 500, 'EGP', 'DISBURSED', 9, ?)", [T, YEAR]);
  const july = await calculate(7);
  assert.equal(item(july, 'ad-a').advance_deductions, 0);
  const september = await calculate(9);
  assert.equal(item(september, 'ad-a').advance_deductions, 500);
});

test('migration 385 credits past advances only where the paid payslip\'s figure is exact', { skip }, async () => {
  // C: one advance for February, a paid run deducted 1,200 of it. D: two advances for the same month, the split is unknowable. E: a disbursement after the run was paid.
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary, branch_id) VALUES
       ('ad-c', ?, 'ج', 'ad3@x.t', '1018000003', 'SALES', 1, '2025-01-01', 3000, 'branch-daqqi'),
       ('ad-d', ?, 'د', 'ad4@x.t', '1018000004', 'SALES', 1, '2025-01-01', 3000, 'branch-daqqi'),
       ('ad-e', ?, 'هـ', 'ad5@x.t', '1018000005', 'SALES', 1, '2025-01-01', 3000, 'branch-daqqi')`, [T, T, T]);
  await pool.query("INSERT INTO payroll_runs (id, tenant_id, branch_id, month, year, status, paid_at) VALUES ('run-feb', ?, 'branch-all', 2, ?, 'PAID', '2026-03-01 10:00:00')", [T, YEAR]);
  for (const [id, staff] of [['pi-c', 'ad-c'], ['pi-d', 'ad-d'], ['pi-e', 'ad-e']]) {
    await pool.query("INSERT INTO payroll_items (id, payroll_run_id, staff_id, tenant_id, branch_id, base_salary, advance_deductions, net_salary) VALUES (?, 'run-feb', ?, ?, 'branch-all', 3000, 1200, 1800)", [id, staff, T]);
  }
  await pool.query(
    `INSERT INTO salary_advances (id, tenant_id, staff_id, amount, currency, status, deduct_month, deduct_year, disbursed_at) VALUES
       ('adv-c', ?, 'ad-c', 5000, 'EGP', 'DISBURSED', 2, ?, '2026-01-20 10:00:00'),
       ('adv-d1', ?, 'ad-d', 800, 'EGP', 'DISBURSED', 2, ?, '2026-01-20 10:00:00'),
       ('adv-d2', ?, 'ad-d', 900, 'EGP', 'DISBURSED', 2, ?, '2026-01-21 10:00:00'),
       ('adv-e', ?, 'ad-e', 5000, 'EGP', 'DISBURSED', 2, ?, '2026-03-05 10:00:00')`, [T, YEAR, T, YEAR, T, YEAR, T, YEAR]);
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '385_v26_advance_recovery.sql'), 'utf8').replace(/^--.*$/gm, '');
  const backfill = sql.split(';').map(part => part.trim()).find(part => /^UPDATE salary_advances/.test(part));
  assert.ok(backfill, 'the migration carries the backfill');
  await pool.query(backfill);
  assert.equal((await advance('adv-c')).recovered, 1200, 'the one advance of the month takes the paid figure');
  assert.equal((await advance('adv-d1')).recovered, 0, 'two advances that month: left for the owner');
  assert.equal((await advance('adv-d2')).recovered, 0);
  assert.equal((await advance('adv-e')).recovered, 0, 'disbursed after the run was paid: it was not in that payslip');
  await pool.query(backfill);
  assert.equal((await advance('adv-c')).recovered, 1200, 'running it again changes nothing');
});
