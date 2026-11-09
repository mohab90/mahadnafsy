'use strict';
/**
 * Recruiting and onboarding as they behave, on a real MariaDB (these were regular expressions over routes/hr/recruiting.js, an error code next to a path):
 * an applicant moves one legal step at a time, «hired» only through the hire action, a hired or website applicant is never edited or deleted, a decision
 * records who and when, and an employee gets one active onboarding with at least one task. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-recruit-it';
let pool; let router;

const HR = { id: 'st-rc-hr', name: 'الموارد', role: 'hr', permissions_json: '["manage_hr","view_hr"]' };

async function call(method, path, { params = {}, body = {}, staff = HR } = {}) {
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
  for (const table of ['employee_onboarding_items', 'employee_onboarding', 'job_applicants', 'job_postings', 'audit_events', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

let JOB;
const applicant = async name => {
  const res = await call('post', '/api/admin/hr/jobs/:jobId/applicants', { params: { jobId: JOB }, body: { name } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.id;
};
const stage = (id, to, extra = {}) => call('put', '/api/admin/hr/applicants/:appId', { params: { appId: id }, body: { stage: to, ...extra } });
const stageOf = async id => (await pool.query('SELECT stage FROM job_applicants WHERE id=?', [id]))[0][0]?.stage;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/hr/recruiting');
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       (?, ?, 'الموارد', 'hr-rc@example.test', '1012340301', 'HR', 1, '2024-01-01'),
       ('st-rc-new', ?, 'موظف جديد', 'new-rc@example.test', '1012340302', 'SALES', 1, '2026-11-01')`, [HR.id, T, T]);
  const made = await call('post', '/api/admin/hr/jobs', { body: { title: 'مدرب', employment_type: 'full_time', status: 'open' } });
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  JOB = made.body.id;
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('an applicant moves one legal step at a time, and «hired» only through the hire action', { skip }, async () => {
  const id = await applicant('منى');
  assert.equal(await stageOf(id), 'applied');
  const jump = await stage(id, 'offer');
  assert.equal(jump.statusCode, 409);
  assert.equal(jump.body.code, 'INVALID_APPLICANT_TRANSITION');
  assert.equal(await stageOf(id), 'applied', 'nothing moved');
  assert.equal((await stage(id, 'screening')).statusCode, 200);
  assert.equal((await stage(id, 'interview')).statusCode, 200);
  const offer = await stage(id, 'offer');
  assert.equal(offer.statusCode, 200, JSON.stringify(offer.body));
  const [[decided]] = await pool.query('SELECT decided_by, decided_at FROM job_applicants WHERE id=?', [id]);
  assert.equal(decided.decided_by, HR.id, 'an offer is a decision: who made it...');
  assert.ok(decided.decided_at, '...and when');
  const hired = await stage(id, 'hired');
  assert.equal(hired.statusCode, 409);
  assert.equal(hired.body.code, 'HIRE_ACTION_REQUIRED');
  assert.equal(await stageOf(id), 'offer');
});

test('scheduling an interview walks a fresh applicant to the interview stage in one move', { skip }, async () => {
  const id = await applicant('سارة');
  const when = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) + ' 11:00:00';
  const res = await stage(id, 'interview', { interview_at: when });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(await stageOf(id), 'interview');
});

test('a hired applicant\'s history is never edited, and neither it nor a website applicant is deleted', { skip }, async () => {
  const hired = await applicant('أحمد');
  await pool.query("UPDATE job_applicants SET stage='hired', hired_staff_id='st-rc-new' WHERE id=?", [hired]);
  const edit = await call('put', '/api/admin/hr/applicants/:appId', { params: { appId: hired }, body: { notes: 'تعديل' } });
  assert.equal(edit.statusCode, 409);
  assert.equal(edit.body.code, 'HIRED_APPLICANT_IMMUTABLE');
  const remove = await call('delete', '/api/admin/hr/applicants/:appId', { params: { appId: hired } });
  assert.equal(remove.statusCode, 409);
  assert.equal(remove.body.code, 'APPLICANT_IMMUTABLE');

  const web = await applicant('من الموقع');
  await pool.query("UPDATE job_applicants SET source='website' WHERE id=?", [web]);
  assert.equal((await call('delete', '/api/admin/hr/applicants/:appId', { params: { appId: web } })).body.code, 'APPLICANT_IMMUTABLE');

  const plain = await applicant('عادي');
  assert.equal((await call('delete', '/api/admin/hr/applicants/:appId', { params: { appId: plain } })).statusCode, 200);
  assert.equal(await stageOf(plain), undefined);
  assert.equal((await call('delete', '/api/admin/hr/applicants/:appId', { params: { appId: plain } })).statusCode, 404);
});

test('an employee has one active onboarding, and it has at least one task', { skip }, async () => {
  const bare = await call('post', '/api/admin/hr/onboarding/start', { body: { staff_id: 'st-rc-new' } });
  assert.equal(bare.statusCode, 400);
  assert.equal(bare.body.code, 'ONBOARDING_TASK_REQUIRED');
  const started = await call('post', '/api/admin/hr/onboarding/start', { body: { staff_id: 'st-rc-new', tasks: [{ title: 'تسليم الأوراق', category: 'documents', due_days: 3 }] } });
  assert.equal(started.statusCode, 200, JSON.stringify(started.body));
  const again = await call('post', '/api/admin/hr/onboarding/start', { body: { staff_id: 'st-rc-new', tasks: [{ title: 'تدريب', category: 'training', due_days: 5 }] } });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.code, 'ACTIVE_ONBOARDING_EXISTS');
  const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM employee_onboarding WHERE tenant_id=? AND staff_id=?', [T, 'st-rc-new']);
  assert.equal(Number(count.n), 1);
});

test('changing a website application\'s status without a note keeps the note HR wrote; sending one replaces it', { skip }, async () => {
  const ops = require('../../routes/admin-operations');
  await pool.query(
    "INSERT INTO join_us_applications (id, tenant_id, name, email, phone, specialty, experience, type, status, admin_note) VALUES ('ju-rc-1', ?, 'متقدمة', 'ju@example.test', '1012340399', 'علاج', 'سنتين', 'EMPLOYEE', 'NEW', 'ملاحظة HR')", [T]);
  const patch = body => {
    const layer = ops.stack.find(item => item.route?.path === '/api/admin/join-us/:id' && item.route.methods.patch);
    return (async () => {
      const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
      const req = { params: { id: 'ju-rc-1' }, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'hr@example.test' }, staffRecord: HR, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined };
      for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
        let advanced = false;
        await handle(req, res, () => { advanced = true; });
        if (!advanced) break;
      }
      return res;
    })();
  };
  const noteOf = async () => (await pool.query("SELECT status, admin_note FROM join_us_applications WHERE id='ju-rc-1'"))[0][0];
  const bare = await patch({ status: 'REVIEWED' });
  assert.equal(bare.statusCode, 200, JSON.stringify(bare.body));
  assert.deepEqual(await noteOf(), { status: 'REVIEWED', admin_note: 'ملاحظة HR' }, 'the note survives a status change');
  assert.equal((await patch({ status: 'CONTACTED', notes: 'اتصلنا' })).statusCode, 200);
  assert.deepEqual(await noteOf(), { status: 'CONTACTED', admin_note: 'اتصلنا' });
  assert.equal((await patch({ status: 'maybe' })).statusCode, 400);
});
