'use strict';
/**
 * «بدل رصيد الإجازات» (11 Nov 2026, the owner: the leave balance does not carry over — at the year's end the days left are paid at the salary). On a real MariaDB: the list
 * (entitlement, used, remaining, day's pay, amount), the pending bonus written per employee, a second run updating the pending ones and leaving the approved alone, a
 * month HR chooses, nobody writing their own, the audit trail, the payslip's own line and the payroll run taking the approved amount.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAILS = 'owner-enc@example.test';
for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-encash-it';
let pool; let encashment; let payroll; let payslipBreakdown; let leaveBalanceOf;

const HR = { id: 'st-en-hr', name: 'الموارد', role: 'hr', permissions_json: '["manage_hr","view_hr"]' };

async function call(router, method, path, { body = {}, query = {}, staff = HR, owner = false } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = {
    params: {}, body, query, headers: {}, tenantId: T, user: { uid: owner ? 'u-owner' : 'u-hr', email: owner ? 'owner-enc@example.test' : 'hr-en@example.test', tenant_id: owner ? 'tenant-default' : T },
    staffRecord: staff, isSuperAdmin: true, ip: '1', get: () => undefined,
  };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const get = year => call(encashment, 'get', '/api/admin/hr/leave-encashment', { query: { year: String(year) } });
const post = (body, options = {}) => call(encashment, 'post', '/api/admin/hr/leave-encashment', { body, ...options });
const rows = async () => (await pool.query("SELECT staff_id, amount, status, for_month, for_year, created_by, source, type FROM employee_bonuses WHERE tenant_id=? AND source='LEAVE_ENCASHMENT' ORDER BY staff_id", [T]))[0]
  .map(row => ({ staff: row.staff_id, amount: Number(row.amount), status: row.status, month: row.for_month, year: row.for_year, source: row.source, type: row.type, by: row.created_by }));

async function clean() {
  await pool.query('DELETE FROM payroll_items WHERE tenant_id=?', [T]).catch(() => {});
  for (const table of ['payroll_runs', 'payroll_period_locks', 'employee_bonuses', 'attendance_logs', 'leaves', 'audit_logs', 'audit_chain_heads', 'hr_policy_versions', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  encashment = require('../../routes/hr/leave-encashment');
  payroll = require('../../routes/hr/payroll');
  ({ payslipBreakdown } = require('../../lib/payslipBreakdown'));
  ({ leaveBalanceOf } = require('../../lib/leaveBalance'));
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary) VALUES
       (?, ?, 'الموارد', 'hr-en@example.test', '1012340951', 'HR', 1, '2024-01-01', 9000),
       ('st-en-a', ?, 'أ', 'a-en@example.test', '1012340952', 'SALES', 1, '2024-01-01', 3000),
       ('st-en-b', ?, 'ب', 'b-en@example.test', '1012340953', 'SALES', 1, '2024-01-01', 6000),
       ('st-en-c', ?, 'ج', 'c-en@example.test', '1012340954', 'SALES', 1, '2024-01-01', NULL)`, [HR.id, T, T, T, T]);
  // A: 5 annual days and 2 free days in 2027 → 14 of 21 left. B: nothing taken.
  await pool.query("INSERT INTO leaves (id, tenant_id, staff_id, type, start_date, end_date, total_days, status) VALUES ('lv-en-a', ?, 'st-en-a', 'ANNUAL', '2027-03-01', '2027-03-05', 5, 'APPROVED')", [T]);
  await pool.query(
    `INSERT INTO attendance_logs (id, tenant_id, staff_id, date, status, permit_used, source) VALUES
       (UUID(), ?, 'st-en-a', '2027-04-07', 'HOLIDAY', 'free_day', 'MANUAL_ENTRY'), (UUID(), ?, 'st-en-a', '2027-05-05', 'HOLIDAY', 'free_day', 'MANUAL_ENTRY')`, [T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the list: every active employee with entitlement, used, remaining, the day\'s pay (a thirtieth of the salary) and the amount', { skip }, async () => {
  const list = await get(2027);
  assert.equal(list.statusCode, 200, JSON.stringify(list.body));
  const byId = Object.fromEntries(list.body.rows.map(row => [row.staffId, row]));
  assert.deepEqual([byId['st-en-a'].entitlement, byId['st-en-a'].used, byId['st-en-a'].remaining, byId['st-en-a'].dayRate, byId['st-en-a'].amount], [21, 7, 14, 100, 1400]);
  assert.deepEqual([byId['st-en-b'].used, byId['st-en-b'].remaining, byId['st-en-b'].dayRate, byId['st-en-b'].amount], [0, 21, 200, 4200]);
  assert.deepEqual([byId['st-en-c'].noSalary, byId['st-en-c'].amount], [true, 0], 'no basic salary: listed, nothing to pay');
  assert.equal(byId[HR.id].amount, 21 * 300);
  assert.equal(list.body.total, 1400 + 4200 + 6300);
  assert.equal((await rows()).length, 0, 'reading writes nothing');
});

test('confirming writes one pending bonus per employee — never the signed-in person\'s own — for the month HR chose (December by default), and audits it', { skip }, async () => {
  const saved = await post({ year: 2027 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.written.map(row => [row.staffId, row.amount]).sort(), [['st-en-a', 1400], ['st-en-b', 4200]]);
  assert.deepEqual(saved.body.skipped.map(row => row.staffId), [HR.id], 'HR does not write his own bonus: someone else runs it for him');
  assert.deepEqual(await rows(), [
    { staff: 'st-en-a', amount: 1400, status: 'PENDING', month: 12, year: 2027, source: 'LEAVE_ENCASHMENT', type: 'bonus', by: HR.id },
    { staff: 'st-en-b', amount: 4200, status: 'PENDING', month: 12, year: 2027, source: 'LEAVE_ENCASHMENT', type: 'bonus', by: HR.id },
  ]);
  const [[audit]] = await pool.query("SELECT COUNT(*) n FROM audit_logs WHERE tenant_id=? AND action='hr.leave_encashment.saved'", [T]);
  assert.equal(Number(audit.n), 1);
});

test('running it again updates the pending rows and never duplicates; an approved row is left alone and said', { skip }, async () => {
  const again = await post({ year: 2027 });
  assert.equal(again.body.written.length, 0, 'nothing new');
  assert.equal(again.body.updated.length, 2);
  assert.equal((await rows()).length, 2, 'still one per employee');
  // A takes three more annual days: his pending amount follows.
  await pool.query("INSERT INTO leaves (id, tenant_id, staff_id, type, start_date, end_date, total_days, status) VALUES ('lv-en-a2', ?, 'st-en-a', 'ANNUAL', '2027-06-06', '2027-06-08', 3, 'APPROVED')", [T]);
  assert.equal((await post({ year: 2027 })).statusCode, 200);
  assert.equal((await rows()).find(row => row.staff === 'st-en-a').amount, 1100, '11 days left');
  // A's is approved by a second person; then more days are taken. Running again leaves it as it is.
  await pool.query("UPDATE employee_bonuses SET status='APPROVED', approved_by='st-other' WHERE tenant_id=? AND staff_id='st-en-a' AND source='LEAVE_ENCASHMENT'", [T]);
  await pool.query("INSERT INTO leaves (id, tenant_id, staff_id, type, start_date, end_date, total_days, status) VALUES ('lv-en-a3', ?, 'st-en-a', 'ANNUAL', '2027-07-04', '2027-07-04', 1, 'APPROVED')", [T]);
  const third = await post({ year: 2027, month: 11 });
  assert.deepEqual(third.body.kept.map(row => [row.staffId, row.status, row.amount, row.now]), [['st-en-a', 'APPROVED', 1100, 1000]]);
  const after = await rows();
  assert.deepEqual(after.find(row => row.staff === 'st-en-a'), { staff: 'st-en-a', amount: 1100, status: 'APPROVED', month: 12, year: 2027, source: 'LEAVE_ENCASHMENT', type: 'bonus', by: HR.id });
  assert.equal(after.find(row => row.staff === 'st-en-b').month, 11, 'the pending one moves to the month chosen');
  assert.equal(after.length, 2);
});

test('the owner may write his own row; the payslip names the line; the payroll run pays the approved amount; the new year starts at the full entitlement', { skip }, async () => {
  const owner = await post({ year: 2027 }, { owner: true, staff: { id: 'st-en-b', name: 'ب', role: 'admin', permissions_json: '[]' } });
  assert.equal(owner.statusCode, 200, JSON.stringify(owner.body));
  assert.ok(!owner.body.skipped.some(row => row.staffId === 'st-en-b'), 'the owner is not held back from his own record');
  await pool.query("UPDATE employee_bonuses SET status='APPROVED', approved_by='st-other', approved_at=NOW(), for_month=12 WHERE tenant_id=? AND staff_id='st-en-b' AND source='LEAVE_ENCASHMENT'", [T]);
  const [encashed] = (await pool.query("SELECT id, type, amount, currency, reason, source, calc_json FROM employee_bonuses WHERE tenant_id=? AND staff_id='st-en-b' AND source='LEAVE_ENCASHMENT'", [T]))[0];
  const slip = payslipBreakdown({ bonus: 4200, calculation_details: '{}' }, [encashed], 'APPROVED');
  assert.deepEqual(slip.bonusLines.map(line => [line.kind, line.label, line.amount]), [['leave_encashment', 'بدل رصيد الإجازات', 4200]]);
  const run = await call(payroll, 'post', '/api/admin/hr/payroll/calculate', { body: { month: 12, year: 2027, skip_missing_salary: true } });
  assert.equal(run.statusCode, 200, JSON.stringify(run.body));
  const itemB = run.body.items.find(item => item.staff_id === 'st-en-b');
  assert.equal(itemB.bonus, 4200, 'an approved encashment is paid like any bonus');
  assert.equal(itemB.net_salary, 6000 + 4200);
  const next = await leaveBalanceOf(pool, { tenantId: T, staffId: 'st-en-a', year: 2028, entitlement: 21 });
  assert.deepEqual([next.used, next.remaining], [0, 21], 'nothing carries over, whatever was paid');
});

test('a bad year or month is refused', { skip }, async () => {
  assert.equal((await post({ year: 1999 })).statusCode, 400);
  assert.equal((await post({ year: 2027, month: 13 })).statusCode, 400);
  assert.equal((await get('x')).statusCode, 400);
});
