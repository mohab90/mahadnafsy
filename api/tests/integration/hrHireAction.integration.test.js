'use strict';
/**
 * Hiring an applicant, on a real MariaDB (these were regular expressions over routes/hr/talent.js — `OFFER_STAGE_REQUIRED`, `Already hired`, `STAFF_EMAIL_EXISTS`,
 * `OWNER_REQUIRED_FOR_PRIVILEGED_ROLE`, `LOGIN_BELONGS_TO_ANOTHER_ACCOUNT`; the stages up to it are in hrRecruitingWorkflow): only someone who reached the interview or offer
 * stage is hired, once; the login email must be a real address not already a staff member's; a manager or administrator can be made only by the owner; a password sets a login
 * and activates the new employee, none leaves the activation for later; and a password is never set on a login that belongs to somebody else. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-hire-it';
let pool; let talent;

const HR = { id: 'st-hi-hr', name: 'الموارد', role: 'hr', permissions_json: '["manage_hr","view_hr"]' };

async function hire(id, body = {}, { owner = false } = {}) {
  const layer = talent.router.stack.find(item => item.route?.path === '/api/admin/hr/applicants/:appId/hire' && item.route.methods.post);
  assert.ok(layer);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params: { appId: id }, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'hr-hi@example.test', tenant_id: T }, staffRecord: owner ? null : HR, isSuperAdmin: owner, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff', 'tenantQuotaGuard'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
let seq = 0;
const applicant = async (stage, extra = {}) => {
  const id = `ap-hi-${++seq}`;
  await pool.query(
    `INSERT INTO job_applicants (id, tenant_id, job_id, name, email, phone, stage, applicant_type) VALUES (?, ?, 'job-hi-1', ?, ?, ?, ?, 'TEACHER')`,
    [id, T, extra.name || 'مرشحة', extra.email === undefined ? `cand${seq}@example.test` : extra.email, `10198000${seq}`.slice(0, 10), stage]);
  return id;
};
const staffOf = async email => (await pool.query('SELECT id, is_active, role FROM staff WHERE tenant_id=? AND email=?', [T, email]))[0][0];

async function clean() {
  for (const table of ['audit_logs', 'notifications', 'job_applicants', 'job_postings', 'users', 'branches', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  talent = require('../../routes/hr/talent');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query("INSERT INTO branches (id, tenant_id, branch_key, slug, label, is_active) VALUES ('br-hi-1', ?, 'online', 'online-hi', 'أونلاين', 1)", [T]);
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('st-hi-hr', ?, 'الموارد', 'hr-hi@example.test', '1019700001', 'HR', 1, '2024-01-01'), ('st-hi-old', ?, 'قديم', 'old-hi@example.test', '1019700002', 'SALES', 1, '2024-01-01')", [T, T]);
  await pool.query("INSERT INTO job_postings (id, tenant_id, title, employment_type, status) VALUES ('job-hi-1', ?, 'مدرب', 'full_time', 'open')", [T]).catch(async () => {
    await pool.query("INSERT INTO job_postings (id, tenant_id, title) VALUES ('job-hi-1', ?, 'مدرب')", [T]);
  });
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('only someone at the interview or offer stage is hired, once, and with a real login address', { skip }, async () => {
  const early = await applicant('screening');
  const refused = await hire(early, { email: 'early-hi@example.test' });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'OFFER_STAGE_REQUIRED');
  assert.equal((await hire('ap-hi-nobody', { email: 'x-hi@example.test' })).statusCode, 404);
  assert.equal((await pool.query('SELECT stage FROM job_applicants WHERE id=?', [early]))[0][0].stage, 'screening', 'nothing moved');

  const ready = await applicant('interview', { email: null });
  assert.equal((await hire(ready, {})).statusCode, 400, 'no address, no login');
  assert.equal((await hire(ready, { email: 'not-an-email' })).statusCode, 400);
  assert.equal((await hire(ready, { email: 'new-hi@example.test', password: 'short' })).statusCode, 400, 'a password of at least 8');
  assert.equal((await hire(ready, { email: 'old-hi@example.test' })).body.code, 'STAFF_EMAIL_EXISTS', 'not an address a staff member already uses');
  assert.equal((await hire(ready, { email: 'new-hi@example.test', role: 'astronaut' })).body.code, 'INVALID_STAFF_ROLE');
  assert.equal(await staffOf('new-hi@example.test'), undefined, 'the refusals made nobody');
});

test('a password makes a login and activates the employee, none leaves activation for later, and a second hire is refused', { skip }, async () => {
  const withPassword = await applicant('offer', { name: 'سارة المدربة', email: 'sara-hi@example.test' });
  const done = await hire(withPassword, { password: 'Str0ngPass!', role: 'support', position: 'مدربة' });
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.deepEqual([done.body.activated, done.body.activation_required], [true, false]);
  const staff = await staffOf('sara-hi@example.test');
  assert.deepEqual([Number(staff.is_active), staff.role], [1, 'SUPPORT']);
  const [[login]] = await pool.query("SELECT is_active, password_hash FROM users WHERE tenant_id=? AND email='sara-hi@example.test'", [T]);
  assert.equal(Number(login.is_active), 1);
  assert.notEqual(login.password_hash, 'Str0ngPass!', 'stored hashed');
  assert.deepEqual((await pool.query('SELECT stage, hired_staff_id FROM job_applicants WHERE id=?', [withPassword]))[0][0], { stage: 'hired', hired_staff_id: staff.id });
  const again = await hire(withPassword, { email: 'other-hi@example.test' });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.error, 'Already hired');
  assert.equal((await pool.query("SELECT id FROM audit_logs WHERE tenant_id=? AND action='hr.applicant.hired'", [T]))[0].length, 1, 'the hire is audited');

  const noPassword = await applicant('interview', { name: 'منى', email: 'mona-hi@example.test' });
  const later = await hire(noPassword, { role: 'support' });
  assert.equal(later.statusCode, 200, JSON.stringify(later.body));
  assert.deepEqual([later.body.activated, later.body.activation_required], [false, true]);
  assert.equal(Number((await staffOf('mona-hi@example.test')).is_active), 0, 'activation is a separate step');
  assert.equal((await pool.query("SELECT id FROM users WHERE tenant_id=? AND email='mona-hi@example.test'", [T]))[0].length, 0, 'and there is no login yet');
});

test('a manager or administrator is made only by the owner, and a password is never set on a login that is somebody else\'s', { skip }, async () => {
  const candidate = await applicant('interview', { name: 'مدير محتمل', email: 'mgr-hi@example.test' });
  const hr = await hire(candidate, { role: 'manager' });
  assert.equal(hr.statusCode, 403);
  assert.equal(hr.body.code, 'OWNER_REQUIRED_FOR_PRIVILEGED_ROLE');
  assert.equal(await staffOf('mgr-hi@example.test'), undefined);

  await pool.query("INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active) VALUES ('us-hi-other', ?, 'someone-hi@example.test', NULL, 'theirhash', 'شخص آخر', 'user', 1)", [T]);
  const typed = await applicant('interview', { name: 'مرشح', email: 'cand-own-hi@example.test' });
  const stolen = await hire(typed, { email: 'someone-hi@example.test', password: 'Str0ngPass!', role: 'support' });
  assert.equal(stolen.statusCode, 403);
  assert.equal(stolen.body.code, 'LOGIN_BELONGS_TO_ANOTHER_ACCOUNT');
  assert.equal((await pool.query("SELECT password_hash FROM users WHERE id='us-hi-other'"))[0][0].password_hash, 'theirhash', 'their password is untouched');
});
