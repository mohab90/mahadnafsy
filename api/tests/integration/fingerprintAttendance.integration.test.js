'use strict';
/**
 * The fingerprint sheet, end to end against a real MariaDB: a month's device
 * export is matched on each employee's device number, judged under the
 * company policy (Friday off, 11:00–18:30, the monthly morning permission,
 * lateness >10 min ¼ day, >30 ½, >120 a day), written to attendance, and
 * payroll deducts exactly those days at the basic salary HR typed on the
 * employee. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-fingerprint-it';
let pool, payrollRouter, staffFileRouter;

async function clean() {
  for (const table of ['payroll_items', 'payroll_runs', 'payroll_period_locks', 'attendance_logs', 'attendance_import_batches', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}
const handler = (router, method, path) => router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle;
async function call(router, method, path, body = {}) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await handler(router, method, path)({ params: {}, query: {}, body, headers: {}, tenantId: T, user: { uid: 'hr' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  return res;
}

// September 2026: Fridays are the 4th, 11th, 18th and 25th — 26 working days.
function sheet() {
  const lines = ['AC-No.,Name,Time,State'];
  const fridays = new Set([4, 11, 18, 25]);
  for (let d = 1; d <= 30; d++) {
    if (fridays.has(d)) continue;
    const day = `2026/09/${String(d).padStart(2, '0')}`;
    // Mona (device 7): late 15 on the 1st (¼), 45 on the 2nd (½ — the month's
    // permission takes it), 100 on the 5th (½), absent on the 3rd.
    const monaIn = { 1: '11:15', 2: '11:45', 5: '12:40' }[d] || '10:55';
    if (d !== 3) lines.push(`7,Mona,${day} ${monaIn}:00,C/In`, `7,Mona,${day} 18:35:00,C/Out`);
    // Ali (device 9): always on time.
    lines.push(`9,Ali,${day} 10:50:00,C/In`, `9,Ali,${day} 18:31:00,C/Out`);
  }
  lines.push('99,Visitor,2026/09/01 11:00:00,C/In'); // nobody's number
  return Buffer.from(lines.join('\n')).toString('base64');
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  payrollRouter = require('../../routes/hr/payroll');
  staffFileRouter = require('../../routes/hr/staff-file');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Fingerprint IT', 'suspended')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('fp-mona', ?, 'منى', 'fp1@x.t', '1016000001', 'SALES', 1, '2025-01-01'),
       ('fp-ali', ?, 'علي', 'fp2@x.t', '1016000002', 'SALES', 1, '2025-01-01'),
       ('fp-remote', ?, 'أونلاين', 'fp3@x.t', '1016000003', 'SALES', 1, '2025-01-01')`, [T, T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('HR enters salary, device number and target for everyone on one screen', { skip }, async () => {
  const saved = await call(staffFileRouter, 'put', '/api/admin/hr/staff-basics', { rows: [
    { id: 'fp-mona', baseSalary: 6500, biometricNo: '7', targetType: 'bookings', targetValue: 12 },
    { id: 'fp-ali', baseSalary: 5200, biometricNo: '9', targetType: 'clients', targetValue: 20 },
    { id: 'fp-remote', baseSalary: 5000 },
  ] });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  const dup = await call(staffFileRouter, 'put', '/api/admin/hr/staff-basics', { rows: [{ id: 'fp-ali', biometricNo: '7' }] });
  assert.equal(dup.statusCode, 409, 'one device number, one employee');
  const list = (await call(staffFileRouter, 'get', '/api/admin/hr/staff-basics')).body;
  const mona = list.find(r => r.id === 'fp-mona');
  assert.deepEqual([mona.baseSalary, mona.biometricNo, mona.targetType, mona.targetValue], [6500, '7', 'bookings', 12]);
});

test('the preview judges the month and writes nothing; the upload writes it', { skip }, async () => {
  const preview = await call(payrollRouter, 'post', '/api/admin/hr/attendance/import-sheet', { fileBase64: sheet(), filename: 'att.csv', month: '2026-09', dryRun: true });
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  const mona = preview.body.employees.find(e => e.staffId === 'fp-mona');
  assert.equal(mona.workDays, 26);
  assert.equal(mona.absent, 1);
  assert.equal(mona.deductionDays, 0.75, '¼ on the 1st + ½ on the 5th; the 2nd is covered by the permission');
  assert.equal(mona.morningPermitsUsed, 1);
  assert.equal(preview.body.employees.find(e => e.staffId === 'fp-ali').deductionDays, 0);
  assert.ok(!preview.body.employees.some(e => e.staffId === 'fp-remote'), 'no device number and not in the sheet: left alone');
  assert.deepEqual(preview.body.unmatched.map(u => u.bioNo), ['99']);
  const [[none]] = await pool.query('SELECT COUNT(*) n FROM attendance_logs WHERE tenant_id=?', [T]);
  assert.equal(Number(none.n), 0);

  const applied = await call(payrollRouter, 'post', '/api/admin/hr/attendance/import-sheet', { fileBase64: sheet(), filename: 'att.csv', month: '2026-09' });
  assert.equal(applied.statusCode, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.daysWritten, 52);
  const [[day2]] = await pool.query("SELECT status, check_in, deduction_days, permit_used FROM attendance_logs WHERE tenant_id=? AND staff_id='fp-mona' AND date='2026-09-02'", [T]);
  assert.deepEqual([day2.status, String(day2.check_in).slice(0, 5), Number(day2.deduction_days), day2.permit_used], ['PRESENT', '11:45', 0, 'morning']);
});

test('a day HR fixed by hand survives a re-upload, and the re-upload adds nothing', { skip }, async () => {
  await pool.query("UPDATE attendance_logs SET status='PRESENT', deduction_days=0, source='MANUAL_ENTRY' WHERE tenant_id=? AND staff_id='fp-mona' AND date='2026-09-03'", [T]);
  const again = await call(payrollRouter, 'post', '/api/admin/hr/attendance/import-sheet', { fileBase64: sheet(), filename: 'att.csv', month: '2026-09' });
  assert.equal(again.statusCode, 200);
  const [[count]] = await pool.query('SELECT COUNT(*) n FROM attendance_logs WHERE tenant_id=?', [T]);
  assert.equal(Number(count.n), 52);
  const [[fixed]] = await pool.query("SELECT status, source FROM attendance_logs WHERE tenant_id=? AND staff_id='fp-mona' AND date='2026-09-03'", [T]);
  assert.deepEqual([fixed.status, fixed.source], ['PRESENT', 'MANUAL_ENTRY']);
  // Put the absence back for the payroll test below.
  await pool.query("UPDATE attendance_logs SET status='ABSENT', source='FINGERPRINT_IMPORT' WHERE tenant_id=? AND staff_id='fp-mona' AND date='2026-09-03'", [T]);
});

test('payroll deducts the judged days at the basic salary typed on the employee', { skip }, async () => {
  const res = await call(payrollRouter, 'post', '/api/admin/hr/payroll/calculate', { month: 9, year: 2026 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const [items] = await pool.query('SELECT staff_id, base_salary, late_deductions, absence_deductions, calculation_details FROM payroll_items WHERE tenant_id=?', [T]);
  const mona = items.find(i => i.staff_id === 'fp-mona');
  const daily = 6500 / 26; // 250
  assert.equal(Number(mona.base_salary), 6500);
  assert.equal(Number(mona.late_deductions), daily * 0.75, 'three quarters of a day');
  assert.equal(Number(mona.absence_deductions), daily * 1, 'one absent day');
  const details = typeof mona.calculation_details === 'string' ? JSON.parse(mona.calculation_details) : mona.calculation_details;
  assert.equal(details.salarySource, 'staff_file');
  assert.equal(details.lateDeductionDays, 0.75);
  const ali = items.find(i => i.staff_id === 'fp-ali');
  assert.equal(Number(ali.late_deductions), 0);
});
