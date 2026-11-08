'use strict';
/**
 * Separation of duties in HR, as it behaves on a real MariaDB (these were regular expressions over routes/hr/*.js, an error code next to a path):
 * whoever a bonus, a deduction, an appraisal or an advance is about — or whoever raised it — never approves it; an advance is approved by one
 * person and paid out by another; only a paid payroll run marks an advance deducted; nobody adds a bonus or a deduction to themselves.
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
const T = 'tenant-sod-it';
let pool; let compensation; let records;

const actor = (id, name) => ({ id, name, role: 'hr', permissions_json: '["manage_hr","view_hr","manage_financial"]' });
const ONE = actor('st-sod-1', 'أول'); const TWO = actor('st-sod-2', 'ثاني'); const EMP = actor('st-sod-emp', 'الموظفة');

async function call(router, method, path, { params = {}, body = {}, staff }) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'hr@example.test' }, staffRecord: staff, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['salary_structures', 'instructor_fees', 'employee_bonuses', 'performance_appraisals', 'salary_advances', 'audit_events', 'financial_audit_log', 'journal_entries', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  compensation = require('../../routes/hr/compensation');
  records = require('../../routes/hr/records');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       (?, ?, 'أول', 'one-sod@example.test', '1012340201', 'HR', 1, '2024-01-01'),
       (?, ?, 'ثاني', 'two-sod@example.test', '1012340202', 'HR', 1, '2024-01-01'),
       (?, ?, 'الموظفة', 'emp-sod@example.test', '1012340203', 'SALES', 1, '2024-01-01')`, [ONE.id, T, TWO.id, T, EMP.id, T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a bonus or a deduction is approved by neither the employee nor whoever raised it, and nobody adds one to themselves', { skip }, async () => {
  const self = await call(compensation, 'post', '/api/admin/hr/employees/:staffId/bonuses', { params: { staffId: ONE.id }, body: { amount: 100 }, staff: ONE });
  assert.equal(self.statusCode, 409);
  assert.equal(self.body.code, 'HR_SELF_MUTATION');

  const made = await call(compensation, 'post', '/api/admin/hr/employees/:staffId/bonuses', { params: { staffId: EMP.id }, body: { type: 'deduction', amount: 250, reason: 'تأخير' }, staff: ONE });
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  assert.equal(made.body.status, 'PENDING', 'a new adjustment waits for a second person');
  const review = (staff, status = 'APPROVED') => call(compensation, 'put', '/api/admin/hr/bonuses/:id/status', { params: { id: made.body.id }, body: { status }, staff });
  assert.equal((await review(ONE)).body.code, 'BONUS_SOD', 'the one who raised it');
  assert.equal((await review(EMP)).body.code, 'BONUS_SOD', 'the one it is about');
  assert.equal((await review(TWO)).statusCode, 200);
  assert.equal((await review(TWO)).statusCode, 409, 'and once reviewed it is not reviewed again');
  const [[row]] = await pool.query('SELECT status, approved_by FROM employee_bonuses WHERE id=?', [made.body.id]);
  assert.deepEqual([row.status, row.approved_by], ['APPROVED', TWO.id]);
});

test('an appraisal needs evidence before it is submitted, and is approved by neither the employee nor the reviewer', { skip }, async () => {
  await pool.query(
    `INSERT INTO performance_appraisals (id, tenant_id, staff_id, reviewer_id, period_month, period_year, status, evidence_json)
     VALUES ('ap-sod-1', ?, ?, ?, 10, 2026, 'draft', '[]'), ('ap-sod-2', ?, ?, ?, 10, 2026, 'draft', '[{"note":"أرقام الشهر"}]')`,
    [T, EMP.id, ONE.id, T, EMP.id, ONE.id]);
  const to = (id, status, staff) => call(compensation, 'put', '/api/admin/hr/appraisals/:id/status', { params: { id }, body: { status }, staff });
  const bare = await to('ap-sod-1', 'submitted', ONE);
  assert.equal(bare.statusCode, 409);
  assert.match(bare.body.error, /Evidence is required/);
  assert.equal((await to('ap-sod-2', 'submitted', TWO)).statusCode, 403, 'only the reviewer submits');
  const submitted = await to('ap-sod-2', 'submitted', ONE);
  assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));
  assert.equal((await to('ap-sod-2', 'approved', ONE)).body.code, 'APPRAISAL_SOD', 'the reviewer');
  assert.equal((await to('ap-sod-2', 'approved', EMP)).body.code, 'APPRAISAL_SOD', 'the employee');
  assert.equal((await to('ap-sod-2', 'approved', TWO)).statusCode, 200);
});

test('an advance is approved by someone else, paid out by someone other than the approver, and deducted only by a paid payroll run', { skip }, async () => {
  await pool.query(
    "INSERT INTO salary_advances (id, tenant_id, staff_id, amount, currency, requested_by, status, deduct_month, deduct_year) VALUES ('adv-sod-1', ?, ?, 500, 'EGP', ?, 'PENDING', 12, 2026)",
    [T, EMP.id, EMP.id]);
  const status = (staff, to) => call(records, 'put', '/api/admin/hr/advances/:advId/status', { params: { advId: 'adv-sod-1' }, body: { status: to }, staff });
  assert.equal((await status(EMP, 'APPROVED')).body.code, 'HR_SELF_APPROVAL', 'not their own advance');
  assert.equal((await status(ONE, 'DEDUCTED')).body.code, 'PAYROLL_SETTLEMENT_REQUIRED', 'deduction is a payroll run\'s doing');
  assert.equal((await status(ONE, 'APPROVED')).statusCode, 200);
  const payOut = staff => call(records, 'put', '/api/admin/hr/advances/:advId/disburse', { params: { advId: 'adv-sod-1' }, staff });
  const same = await payOut(ONE);
  assert.equal(same.statusCode, 409);
  assert.equal(same.body.code, 'ADVANCE_SOD');
  const [[still]] = await pool.query("SELECT status FROM salary_advances WHERE id='adv-sod-1'");
  assert.equal(still.status, 'APPROVED', 'nothing was paid');
  const other = await payOut(TWO);
  assert.equal(other.statusCode, 200, JSON.stringify(other.body));
  const [[paid]] = await pool.query("SELECT status, disbursed_by, journal_entry_id FROM salary_advances WHERE id='adv-sod-1'");
  assert.deepEqual([paid.status, paid.disbursed_by, !!paid.journal_entry_id], ['DISBURSED', TWO.id, true], 'paid out, with its journal entry');
});

test('a salary structure is approved by neither its owner nor its author; a new one waits and must follow the approved one', { skip }, async () => {
  const attendance = require('../../routes/hr/attendance');
  const next = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const made = await call(attendance, 'post', '/api/admin/hr/salary', { body: { staff_id: EMP.id, base_salary: 4000, effective_from: next }, staff: ONE });
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  assert.equal(made.body.status, 'PENDING');
  assert.equal((await call(attendance, 'post', '/api/admin/hr/salary', { body: { staff_id: ONE.id, base_salary: 1 }, staff: ONE })).body.code, 'HR_SELF_MUTATION', 'nobody sets their own structure');
  assert.equal((await call(attendance, 'post', '/api/admin/hr/salary', { body: { staff_id: EMP.id, base_salary: 4000, effective_from: '2020-01-01' }, staff: ONE })).statusCode, 400, 'not in the past');
  const review = (staff, status = 'APPROVED') => call(attendance, 'put', '/api/admin/hr/salary/:id/status', { params: { id: made.body.id }, body: { status }, staff });
  assert.equal((await review(ONE)).body.code, 'SALARY_SOD', 'the author');
  assert.equal((await review(EMP)).body.code, 'SALARY_SOD', 'the owner');
  assert.equal((await review(TWO)).statusCode, 200);
  assert.equal((await review(TWO)).statusCode, 409, 'a reviewed one is not reviewed again');
  const later = new Date(Date.now() + 80 * 86400000).toISOString().slice(0, 10);
  const tooEarly = await call(attendance, 'post', '/api/admin/hr/salary', { body: { staff_id: EMP.id, base_salary: 5000, effective_from: next }, staff: ONE });
  assert.equal(tooEarly.statusCode, 409, 'a structure must start after the approved one');
  assert.equal((await call(attendance, 'post', '/api/admin/hr/salary', { body: { staff_id: EMP.id, base_salary: 5000, effective_from: later }, staff: ONE })).statusCode, 200);
});

test('an instructor fee is approved by neither the instructor nor whoever raised it, and is paid only by a payroll run', { skip }, async () => {
  const made = await call(compensation, 'post', '/api/admin/hr/instructor-fees', { body: { staff_id: EMP.id, fee_type: 'fixed', fixed_amount: 300, period_month: 11, period_year: 2026 }, staff: ONE });
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  assert.equal(made.body.status, 'pending');
  assert.equal((await call(compensation, 'post', '/api/admin/hr/instructor-fees', { body: { staff_id: ONE.id, fixed_amount: 100 }, staff: ONE })).body.code, 'HR_SELF_MUTATION');
  assert.equal((await call(compensation, 'post', '/api/admin/hr/instructor-fees', { body: { staff_id: EMP.id }, staff: ONE })).statusCode, 400, 'a positive total is required');
  const patch = (staff, body) => call(compensation, 'patch', '/api/admin/hr/instructor-fees/:id', { params: { id: made.body.id }, body, staff });
  const paid = await patch(TWO, { status: 'paid' });
  assert.equal(paid.statusCode, 409);
  assert.equal(paid.body.code, 'PAYROLL_SETTLEMENT_REQUIRED');
  assert.equal((await patch(ONE, { status: 'approved' })).body.code, 'INSTRUCTOR_FEE_SOD', 'the one who raised it');
  assert.equal((await patch(EMP, { status: 'approved' })).body.code, 'INSTRUCTOR_FEE_SOD', 'the instructor');
  const approved = await patch(TWO, { status: 'approved' });
  assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, 'approved');
  assert.equal((await patch(TWO, { status: 'rejected' })).statusCode, 409, 'an approved fee does not become rejected');
});
