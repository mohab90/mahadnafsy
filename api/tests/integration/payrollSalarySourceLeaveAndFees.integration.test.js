'use strict';
/**
 * What goes into a payroll line, on a real MariaDB (these were regular expressions over routes/hr/payroll.js and migration 128/129; the run itself — bonus, commissions,
 * advances, approval, paying — is in payrollRun.integration): an employee with no approved salary stops the month by name (PAYROLL_SALARY_MISSING) unless the desk asks to skip
 * them, and is then reported as skipped; only an APPROVED structure that covers the month is used (a pending one is not, the latest approved one wins, an expired one is not
 * a salary); unpaid leave costs the day's pay (salary / 30) and annual leave costs nothing; and a teaching fee reaches payroll only when approved, is held by the run, is
 * handed back when the run is cancelled, and becomes «paid» only when the run is paid. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-payroll-source-it';
const MONTH = 9; const YEAR = 2026;
let pool; let router; let compensation;

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'financial_audit_log', 'payroll_items', 'payroll_runs', 'payroll_period_locks', 'instructor_fees', 'attendance_logs', 'leaves',
    'salary_structures', 'instructor_rate_change_requests', 'instructor_rates', 'audit_logs', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const handler = (method, path, from = router) => from.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle;
async function call(method, path, { actor, params = {}, body = {}, from = router, staff = null }) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await handler(method, path, from)({ params, query: {}, body, headers: {}, tenantId: T, user: { uid: actor, email: `${actor}@example.test` }, staffRecord: staff, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  return res;
}
const calculate = (body = {}) => call('post', '/api/admin/hr/payroll/calculate', { actor: 'hr-calc', body: { month: MONTH, year: YEAR, ...body } });
const setStatus = (actor, runId, status) => call('put', '/api/admin/hr/payroll/:runId/status', { actor, params: { runId }, body: { status } });
const line = (res, id) => res.body.items.find(entry => entry.staff_id === id);
const fee = async () => (await pool.query("SELECT status, payroll_run_id FROM instructor_fees WHERE id='if-1'"))[0][0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/hr/payroll');
  compensation = require('../../routes/hr/compensation');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary) VALUES
       ('ps-a', ?, 'أ', 'ps-a@x.t', '1018000001', 'SALES', 1, '2025-01-01', NULL),
       ('ps-b', ?, 'ب', 'ps-b@x.t', '1018000002', 'SALES', 1, '2025-01-01', NULL),
       ('ps-c', ?, 'ج', 'ps-c@x.t', '1018000003', 'SALES', 1, '2025-01-01', NULL),
       ('ps-d', ?, 'د', 'ps-d@x.t', '1018000004', 'SALES', 1, '2025-01-01', NULL)`, [T, T, T, T]);
  const structure = (id, staff, base, status, from, to = null) => pool.query(
    `INSERT INTO salary_structures (id, tenant_id, staff_id, base_salary, housing_allowance, transport_allowance, food_allowance, other_fixed,
       deduction_social_insurance, deduction_tax, currency, status, effective_from, effective_to) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 'EGP', ?, ?, ?)`,
    [id, T, staff, base, status, from, to]);
  await structure('ss-a1', 'ps-a', 3000, 'APPROVED', '2026-01-01');
  await structure('ss-a2', 'ps-a', 9000, 'PENDING', '2026-06-01');
  await structure('ss-b1', 'ps-b', 3000, 'APPROVED', '2026-01-01');
  await structure('ss-b2', 'ps-b', 3600, 'APPROVED', '2026-09-01');
  await structure('ss-c1', 'ps-c', 3000, 'APPROVED', '2026-01-01', '2026-08-31');
  await structure('ss-d1', 'ps-d', 3000, 'APPROVED', '2026-01-01');
  // D: three days of approved unpaid leave and two of annual leave
  await pool.query(
    `INSERT INTO leaves (id, tenant_id, staff_id, type, start_date, end_date, total_days, status) VALUES
       ('lv-ps-u', ?, 'ps-d', 'UNPAID', '2026-09-07', '2026-09-09', 3, 'APPROVED'),
       ('lv-ps-a', ?, 'ps-d', 'ANNUAL', '2026-09-14', '2026-09-15', 2, 'APPROVED')`, [T, T]);
  for (const [day, leave] of [['2026-09-07', 'lv-ps-u'], ['2026-09-08', 'lv-ps-u'], ['2026-09-09', 'lv-ps-u'], ['2026-09-14', 'lv-ps-a'], ['2026-09-15', 'lv-ps-a']]) {
    await pool.query("INSERT INTO attendance_logs (id, tenant_id, staff_id, date, status, source, leave_id) VALUES (UUID(), ?, 'ps-d', ?, 'LEAVE', 'MANUAL_ENTRY', ?)", [T, day, leave]);
  }
  // A's teaching fees: one approved, one still pending
  await pool.query(
    `INSERT INTO instructor_fees (id, tenant_id, staff_id, fee_type, total_amount, currency, period_month, period_year, status) VALUES
       ('if-1', ?, 'ps-a', 'lecture', 500, 'EGP', ?, ?, 'approved'),
       ('if-2', ?, 'ps-a', 'lecture', 7000, 'EGP', ?, ?, 'pending')`, [T, MONTH, YEAR, T, MONTH, YEAR]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('an employee with no approved salary stops the month by name, unless the desk asks to skip them', { skip }, async () => {
  const stopped = await calculate();
  assert.equal(stopped.statusCode, 409);
  assert.equal(stopped.body.code, 'PAYROLL_SALARY_MISSING');
  assert.deepEqual(stopped.body.staff.map(entry => entry.id), ['ps-c'], 'an expired structure is not a salary');
  assert.equal((await pool.query('SELECT id FROM payroll_runs WHERE tenant_id=?', [T]))[0].length, 0, 'nothing was calculated');
  const skipped = await calculate({ skip_missing_salary: true });
  assert.equal(skipped.statusCode, 200, JSON.stringify(skipped.body));
  assert.deepEqual(skipped.body.skippedNoSalary.map(entry => entry.id), ['ps-c']);
  assert.deepEqual(skipped.body.items.map(entry => entry.staff_id).sort(), ['ps-a', 'ps-b', 'ps-d']);
});

test('only an approved structure that covers the month is used, and the latest one wins', { skip }, async () => {
  const run = await calculate({ skip_missing_salary: true });
  assert.equal(line(run, 'ps-a').base_salary, 3000, 'the pending 9,000 is not a salary');
  assert.equal(line(run, 'ps-b').base_salary, 3600, 'the structure that began in September replaces the January one');
});

test('unpaid leave costs the day\'s pay, annual leave costs nothing', { skip }, async () => {
  const run = await calculate({ skip_missing_salary: true });
  const d = line(run, 'ps-d');
  assert.equal(d.absence_deductions, 300, 'three unpaid days at 3,000 / 30');
  assert.equal(d.net_salary, 2700);
  assert.equal(line(run, 'ps-b').absence_deductions, 0);
});

test('a teaching fee reaches payroll only when approved, is held by the run, handed back on cancelling, and paid only with the run', { skip }, async () => {
  let run = await calculate({ skip_missing_salary: true });
  assert.equal(line(run, 'ps-a').net_salary, 3500, '3,000 + the approved 500; the pending 7,000 waits');
  assert.deepEqual(await fee(), { status: 'included_in_payroll', payroll_run_id: run.body.run.id });
  assert.equal((await pool.query("SELECT status FROM instructor_fees WHERE id='if-2'"))[0][0].status, 'pending');
  run = await calculate({ skip_missing_salary: true });
  assert.equal(line(run, 'ps-a').net_salary, 3500, 'recalculating takes it once, not twice');

  assert.equal((await setStatus('hr-calc', run.body.run.id, 'CANCELLED')).statusCode, 200);
  assert.deepEqual(await fee(), { status: 'approved', payroll_run_id: null }, 'handed back to the next run');

  run = await calculate({ skip_missing_salary: true });
  assert.equal((await setStatus('fin-approve', run.body.run.id, 'APPROVED')).statusCode, 200);
  assert.equal((await fee()).status, 'included_in_payroll', 'approving the run does not pay the fee');
  const paid = await setStatus('fin-pay', run.body.run.id, 'PAID');
  assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
  assert.equal((await fee()).status, 'paid');
});

test('an instructor rate change is proposed once, never by the instructor, reviewed by someone else, and applied only on approval', { skip }, async () => {
  const propose = (actor, staff = null, body = {}) => call('put', '/api/admin/hr/instructors/:staffId/rates', { from: compensation, actor, staff, params: { staffId: 'ps-a' }, body: { lecture_rate_per_hour: 150, currency: 'EGP', ...body } });
  assert.equal((await propose('hr-1', { id: 'ps-a' })).body.code, 'HR_SELF_MUTATION', 'nobody sets their own teaching rate');
  assert.equal((await propose('hr-1', null, { lecture_rate_per_hour: -1 })).statusCode, 400);
  assert.equal((await propose('hr-1', null, { currency: 'XYZ' })).statusCode, 400);
  const asked = await propose('hr-1', { id: 'hr-1' });
  assert.equal(asked.statusCode, 200, JSON.stringify(asked.body));
  assert.equal(asked.body.status, 'PENDING');
  assert.equal((await propose('hr-1', { id: 'hr-1' })).body.code, 'RATE_CHANGE_PENDING', 'one proposal at a time');
  assert.equal((await pool.query("SELECT id FROM instructor_rates WHERE tenant_id=? AND staff_id='ps-a'", [T]))[0].length, 0, 'nothing applies before approval');
  const review = (actor, status = 'APPROVED') => call('put', '/api/admin/hr/instructor-rate-proposals/:id/status', { from: compensation, actor, staff: { id: actor }, params: { id: asked.body.id }, body: { status } });
  assert.equal((await review('hr-1')).body.code, 'RATE_SOD', 'the proposer does not review');
  assert.equal((await review('hr-2', 'MAYBE')).statusCode, 400);
  assert.equal((await review('hr-2')).statusCode, 200);
  const [[rate]] = await pool.query("SELECT lecture_rate_per_hour FROM instructor_rates WHERE tenant_id=? AND staff_id='ps-a'", [T]);
  assert.equal(Number(rate.lecture_rate_per_hour), 150, 'applied on approval');
  assert.equal((await review('hr-3')).statusCode, 409, 'a reviewed proposal is closed');
  const [events] = await pool.query("SELECT action FROM audit_logs WHERE tenant_id=? AND action LIKE 'hr.instructor_rate.%' ORDER BY action", [T]);
  assert.deepEqual(events.map(item => item.action), ['hr.instructor_rate.approved', 'hr.instructor_rate.requested']);
});

test('a teaching fee is never marked paid by hand, never approved by whoever made it, and only a pending one can be deleted', { skip }, async () => {
  await pool.query(
    "INSERT INTO instructor_fees (id, tenant_id, staff_id, fee_type, total_amount, currency, period_month, period_year, status, created_by) VALUES ('if-3', ?, 'ps-b', 'lecture', 200, 'EGP', 10, 2026, 'pending', 'creator-1'), ('if-4', ?, 'ps-b', 'lecture', 300, 'EGP', 10, 2026, 'approved', 'creator-1')", [T, T]);
  const patch = (id, actor, body) => call('patch', '/api/admin/hr/instructor-fees/:id', { from: compensation, actor, params: { id }, body });
  assert.equal((await patch('if-3', 'hr-1', { status: 'paid' })).body.code, 'PAYROLL_SETTLEMENT_REQUIRED', 'paid is a payroll run doing');
  assert.equal((await patch('if-3', 'creator-1', { status: 'approved' })).body.code, 'INSTRUCTOR_FEE_SOD');
  assert.equal((await patch('if-4', 'hr-1', { status: 'pending' })).statusCode, 409, 'an approved fee does not go back');
  assert.equal((await patch('if-3', 'hr-1', { status: 'approved' })).statusCode, 200);
  const del = id => call('delete', '/api/admin/hr/instructor-fees/:id', { from: compensation, actor: 'hr-1', params: { id } });
  assert.equal((await del('if-3')).body.code, 'INSTRUCTOR_FEE_IMMUTABLE', 'reviewed records are not deleted');
  assert.equal((await del('if-4')).statusCode, 409);
  await pool.query("INSERT INTO instructor_fees (id, tenant_id, staff_id, fee_type, total_amount, currency, period_month, period_year, status) VALUES ('if-5', ?, 'ps-b', 'lecture', 50, 'EGP', 10, 2026, 'pending')", [T]);
  assert.equal((await del('if-5')).statusCode, 200, 'a pending one can be');
  assert.equal((await pool.query("SELECT id FROM instructor_fees WHERE id='if-5'"))[0].length, 0);
});
