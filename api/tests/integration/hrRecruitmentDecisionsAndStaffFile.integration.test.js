'use strict';
/**
 * The recruitment decisions and the employee file as they behave, on a real MariaDB (these were regular expressions over routes/hr/recruitment-workflow.js,
 * routes/hr/staff-file.js and lib/hrPolicy.js): a call never drags an applicant backwards; accepting walks them onto the interview stage; a grade is one of
 * eight and each round keeps its own grader; every action leaves an attributed note and the trail only grows; the document checklist lists what is missing and
 * ticking twice updates; pay is the accounts' to set and refuses a rate that would overpay; a late permit costs no leave days. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-recdec-it';
let pool; let workflow; let staffFile;

const HR = { id: 'st-rd-hr', name: 'الموارد', role: 'hr', permissions_json: '["manage_hr","view_hr"]' };

async function call(router, method, path, { params = {}, body = {}, superAdmin = true, staff = HR } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'hr-rd@example.test' }, staffRecord: staff, isSuperAdmin: superAdmin, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['recruitment_notes', 'staff_documents', 'job_applicants', 'job_postings', 'join_us_applications', 'leaves', 'audit_events', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const application = (id, status) => pool.query(
  "INSERT INTO join_us_applications (id, tenant_id, name, email, phone, specialty, experience, type, status) VALUES (?, ?, ?, ?, '1012340801', 'علاج', 'سنتين', 'EMPLOYEE', ?)", [id, T, id, `${id}@example.test`, status]);
const notes = async (refId) => (await pool.query('SELECT kind, author_name FROM recruitment_notes WHERE tenant_id=? AND ref_id=? ORDER BY created_at, id', [T, refId]))[0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  workflow = require('../../routes/hr/recruitment-workflow');
  staffFile = require('../../routes/hr/staff-file');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, base_salary) VALUES
       (?, ?, 'الموارد', 'hr-rd@example.test', '1012340802', 'HR', 1, '2024-01-01', 0),
       ('st-rd-emp', ?, 'موظفة', 'emp-rd@example.test', '1012340803', 'SALES', 1, '2024-01-01', 3000)`, [HR.id, T, T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a call advances a new application and never drags a decided one backwards; every call leaves an attributed note', { skip }, async () => {
  await application('ju-rd-new', 'NEW'); await application('ju-rd-done', 'ACCEPTED');
  const fresh = await call(workflow, 'post', '/api/admin/join-us/:id/contact', { params: { id: 'ju-rd-new' }, body: { body: 'ردّت' } });
  assert.deepEqual([fresh.body.status, fresh.statusCode], ['CONTACTED', 200]);
  const decided = await call(workflow, 'post', '/api/admin/join-us/:id/contact', { params: { id: 'ju-rd-done' }, body: {} });
  assert.equal(decided.body.status, 'ACCEPTED', 'ringing someone already accepted keeps the decision');
  assert.equal((await pool.query("SELECT status FROM join_us_applications WHERE id='ju-rd-done'"))[0][0].status, 'ACCEPTED');
  assert.deepEqual((await notes('ju-rd-new')).map(note => [note.kind, note.author_name]), [['contact', HR.name]]);
  await call(workflow, 'post', '/api/admin/join-us/:id/contact', { params: { id: 'ju-rd-new' }, body: { body: 'مرة تانية' } });
  assert.equal((await notes('ju-rd-new')).length, 2, 'the trail grows, nothing is overwritten');
});

test('accepting an application walks the applicant onto the interview stage; the decision is accept or reject', { skip }, async () => {
  await application('ju-rd-eval', 'CONTACTED');
  assert.equal((await call(workflow, 'post', '/api/admin/join-us/:id/evaluate', { params: { id: 'ju-rd-eval' }, body: { decision: 'MAYBE' } })).statusCode, 400);
  const accepted = await call(workflow, 'post', '/api/admin/join-us/:id/evaluate', { params: { id: 'ju-rd-eval' }, body: { decision: 'ACCEPTED', body: 'ممتازة' } });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  const [[row]] = await pool.query("SELECT status, converted_applicant_id FROM join_us_applications WHERE id='ju-rd-eval'");
  assert.equal(row.status, 'ACCEPTED');
  assert.ok(row.converted_applicant_id, 'an applicant was made');
  assert.equal((await pool.query('SELECT stage FROM job_applicants WHERE id=?', [row.converted_applicant_id]))[0][0].stage, 'interview', 'and sits on the interviews screen');
  assert.deepEqual((await notes('ju-rd-eval')).map(note => note.kind), ['evaluation']);
  await application('ju-rd-no', 'NEW');
  assert.equal((await call(workflow, 'post', '/api/admin/join-us/:id/evaluate', { params: { id: 'ju-rd-no' }, body: { decision: 'REJECTED' } })).body.status, 'REJECTED');
});

test('a grade is one of the eight the desk uses, and each interview round keeps its own grader', { skip }, async () => {
  const [[row]] = await pool.query("SELECT converted_applicant_id AS id FROM join_us_applications WHERE id='ju-rd-eval'");
  const grade = body => call(workflow, 'post', '/api/admin/hr/applicants/:id/grade', { params: { id: row.id }, body });
  assert.equal((await grade({ grade: 'Z' })).statusCode, 400);
  assert.equal((await grade({ grade: 'a+' })).statusCode, 200, 'upper-cased');
  const second = await call(workflow, 'post', '/api/admin/hr/applicants/:id/grade', { params: { id: row.id }, body: { grade: 'B', round: 2 }, staff: { ...HR, id: 'st-rd-emp', name: 'موظفة' } });
  assert.equal(second.statusCode, 200, JSON.stringify(second.body));
  const [[graded]] = await pool.query('SELECT interview_grade, interviewed_by, second_interview_grade, second_interviewed_by FROM job_applicants WHERE id=?', [row.id]);
  assert.deepEqual({ ...graded }, { interview_grade: 'A+', interviewed_by: HR.id, second_interview_grade: 'B', second_interviewed_by: 'st-rd-emp' });
  assert.ok((await notes(row.id)).length >= 2, 'each grade left a note');
});

test('the document checklist lists what is missing, not only what is on file, and ticking twice updates one row', { skip }, async () => {
  const list = await call(staffFile, 'get', '/api/admin/hr/staff/:staffId/documents', { params: { staffId: 'st-rd-emp' } });
  assert.equal(list.statusCode, 200, JSON.stringify(list.body));
  const docs = list.body.documents || list.body;
  const national = docs.find(doc => (doc.docType || doc.doc_type || doc.type) === 'NATIONAL_ID');
  assert.deepEqual([national.received, national.recorded], [false, false], 'never asked is told apart from asked and not delivered');
  assert.ok(docs.length >= 7, 'the whole checklist is there');
  const put = received => call(staffFile, 'put', '/api/admin/hr/staff/:staffId/documents/:docType', { params: { staffId: 'st-rd-emp', docType: 'national_id' }, body: { received } });
  assert.equal((await put(true)).statusCode, 200);
  assert.equal((await put(false)).statusCode, 200);
  const [rows] = await pool.query("SELECT received FROM staff_documents WHERE tenant_id=? AND staff_id='st-rd-emp' AND doc_type='NATIONAL_ID'", [T]);
  assert.deepEqual(rows.map(row => Number(row.received)), [0], 'one row, updated');
  assert.equal((await call(staffFile, 'put', '/api/admin/hr/staff/:staffId/documents/:docType', { params: { staffId: 'st-rd-emp', docType: 'PASSPORTS' }, body: {} })).statusCode, 400);
});

test('pay is the accounts\' to set and refuses a rate that would overpay or a target-less target', { skip }, async () => {
  const pay = body => call(staffFile, 'put', '/api/admin/hr/staff/:staffId/pay', { params: { staffId: 'st-rd-emp' }, body });
  assert.equal((await pay({ commissionType: 'PERCENT', commissionRate: 150 })).statusCode, 400, 'over 100 percent');
  assert.equal((await pay({ commissionType: 'PERCENT' })).statusCode, 400, 'a percent with no rate');
  assert.equal((await pay({ commissionType: 'TARGET' })).statusCode, 400, 'a target with no number');
  assert.equal((await pay({ commissionType: 'WHATEVER' })).statusCode, 400);
  assert.equal((await pay({ baseSalary: -1 })).statusCode, 400);
  assert.equal((await pay({ baseSalary: 4000, commissionType: 'PERCENT', commissionRate: 5 })).statusCode, 200);
  const [[saved]] = await pool.query("SELECT base_salary, commission_type, commission_rate FROM staff WHERE id='st-rd-emp'");
  assert.deepEqual([Number(saved.base_salary), saved.commission_type, Number(saved.commission_rate)], [4000, 'PERCENT', 5]);
});

test('a late permit or an early leave costs no leave days; a day off does', { skip }, async () => {
  const { calculateLeaveDays } = require('../../lib/hrPolicy');
  const policy = { weekend_days_json: [5, 6] };
  assert.equal(calculateLeaveDays('2026-11-09', '2026-11-09', 'LATE_PERMIT', policy), 0);
  assert.equal(calculateLeaveDays('2026-11-09', '2026-11-09', 'EARLY_LEAVE', policy), 0);
  assert.equal(calculateLeaveDays('2026-11-09', '2026-11-10', 'ANNUAL', policy), 2);
});
