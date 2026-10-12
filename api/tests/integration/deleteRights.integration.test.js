'use strict';
/**
 * «شيل من صلاحيات اي شخص غير المدير وليد وحازم ومهاب الحذف اي ما كان سواء نشوى
 * او خلود حذف عميل او حذف موظف او حذف حتي شخص منضم» — the owner, 12 Oct 2026.
 *
 * Against a real MariaDB and the real routers, behind the guard exactly as
 * lib/httpApp.js mounts it: a manager who is not on the list is refused a
 * client, an employee and an applicant; Walid (found by name while nothing is
 * saved) is not; the owner never is; and once the owner saves a list, that list
 * is the only one that counts. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-delrights-it';
// The owner is ADMIN_EMAILS in the original institute; this file plays that
// institute so the owner can be exercised as production has him. Both are read
// when middleware/auth loads, so they are set before anything is required.
process.env.DEFAULT_TENANT_ID = T;
process.env.ADMIN_EMAILS = 'owner@delrights.test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
process.env.DISABLE_BACKGROUND_JOBS = 'true';

const OWNER = { uid: 'u-owner', email: 'owner@delrights.test' };
const STAFF = {
  walid: { id: 'dr-walid', name: 'وليد حسن', email: 'walid@delrights.test' },
  hazem: { id: 'dr-hazem', name: 'Hazem Ali', email: 'hazem@delrights.test' },
  nashwa: { id: 'dr-nashwa', name: 'نشوى مدير الدقي', email: 'nashwa@delrights.test' },
  kholoud: { id: 'dr-kholoud', name: 'خلود سمير', email: 'kholoud@delrights.test' },
};

let pool; let server; let base;

async function clean() {
  for (const table of ['subscribers', 'staff', 'join_us_applications', 'job_applicants', 'job_postings', 'tasks', 'tenant_settings', 'audit_logs', 'audit_chain_heads']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}

// Who is asking is set the way requireAuth leaves it, so what is under test is
// the guard and the routes, not the token.
let caller = null;
async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const as = who => {
  caller = who === OWNER ? OWNER : { uid: `u-${who.id}`, email: who.email };
  return { del: path => call('DELETE', path), put: (path, body) => call('PUT', path, body), get: path => call('GET', path) };
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  // tenant_settings hangs off tenants; the row is all the saved list needs.
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Delete rights IT', 'suspended')", [T, T]);
  const staffRows = Object.values(STAFF).concat([
    { id: 'dr-target-1', name: 'موظف هيتمسح 1', email: 'target1@delrights.test' },
    { id: 'dr-target-2', name: 'موظف هيتمسح 2', email: 'target2@delrights.test' },
  ]);
  for (const [index, row] of staffRows.entries()) {
    await pool.query(
      `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, '2025-01-01')`,
      [row.id, T, row.name, row.email, `10123400${String(index).padStart(2, '0')}`, row.id.startsWith('dr-target') ? 'SALES' : 'MANAGER']);
  }
  for (const id of ['dr-sub-1', 'dr-sub-2', 'dr-sub-3', 'dr-sub-4']) {
    await pool.query('INSERT INTO subscribers (id, tenant_id, name, is_active) VALUES (?, ?, ?, 1)', [id, T, `عميل ${id}`]);
  }
  for (const id of ['dr-join-1', 'dr-join-2']) {
    await pool.query(
      `INSERT INTO join_us_applications (id, tenant_id, name, email, phone, specialty, experience, type)
       VALUES (?, ?, 'شخص منضم', ?, '01000000000', 'نفسي', 'سنتين', 'INSTRUCTOR')`, [id, T, `${id}@delrights.test`]);
  }
  await pool.query("INSERT INTO job_postings (id, tenant_id, title) VALUES ('job-x', ?, 'محاضر')", [T]);
  for (const id of ['dr-app-1', 'dr-app-2']) {
    await pool.query("INSERT INTO job_applicants (id, tenant_id, job_id, name, source, stage) VALUES (?, ?, 'job-x', 'متقدم', 'manual', 'applied')", [id, T]);
  }
  await pool.query(
    `INSERT INTO tasks (id, tenant_id, title, assigned_to, created_by) VALUES
       ('dr-task-own', ?, 'مهمتي', 'dr-nashwa', 'dr-nashwa'),
       ('dr-task-given', ?, 'مهمة من المدير', 'dr-nashwa', 'dr-walid')`, [T, T]);

  const express = require('express');
  const { deleteRightsGuard, invalidateDeleteRights } = require('../../lib/deleteRights');
  invalidateDeleteRights();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    if (caller) req.user = { ...caller, tenant_id: T, is_staff: true, mfa_verified: true };
    next();
  });
  app.use('/api/admin', deleteRightsGuard);
  app.use('/api/staff', deleteRightsGuard);
  for (const mod of ['core', 'staff', 'admin-operations', 'hr', 'campaigns', 'misc']) app.use(require(`../../routes/${mod}`));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!ENABLED) return;
  if (server) await new Promise(resolve => server.close(resolve));
  await clean();
  await pool.end();
  // The routers schedule their jobs on require; nothing here needs them.
  setTimeout(() => process.exit(), 300).unref();
});

const subscriberGone = async id => {
  const [[row]] = await pool.query('SELECT deleted_at FROM subscribers WHERE id=? AND tenant_id=?', [id, T]);
  return row.deleted_at !== null;
};

test('a manager not on the list cannot delete a client, an employee or an applicant', { skip }, async () => {
  for (const path of ['/api/admin/subscribers/dr-sub-1', '/api/admin/staff/dr-target-1', '/api/admin/join-us/dr-join-1', '/api/admin/hr/applicants/dr-app-1']) {
    for (const who of [STAFF.nashwa, STAFF.kholoud]) {
      const res = await as(who).del(path);
      assert.equal(res.status, 403, `${who.name} ${path} → ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, 'DELETE_NOT_ALLOWED');
      assert.match(res.body.error, /^الحذف ل.*وليد.* بس$/);
    }
  }
  assert.equal(await subscriberGone('dr-sub-1'), false, 'the client is still there');
  const [[staff]] = await pool.query("SELECT deleted_at FROM staff WHERE id='dr-target-1'");
  assert.equal(staff.deleted_at, null, 'the employee is still there');
  const [[join]] = await pool.query("SELECT COUNT(*) AS n FROM join_us_applications WHERE id='dr-join-1'");
  assert.equal(Number(join.n), 1, 'the applicant is still there');
});

test('with nothing saved, Walid and Hazem are found by name and may delete', { skip }, async () => {
  assert.equal((await as(STAFF.walid).del('/api/admin/subscribers/dr-sub-1')).status, 200);
  assert.equal(await subscriberGone('dr-sub-1'), true);
  assert.equal((await as(STAFF.walid).del('/api/admin/staff/dr-target-1')).status, 200);
  assert.equal((await as(STAFF.hazem).del('/api/admin/join-us/dr-join-1')).status, 200);
  assert.equal((await as(STAFF.hazem).del('/api/admin/hr/applicants/dr-app-1')).status, 200);
  const [[join]] = await pool.query("SELECT COUNT(*) AS n FROM join_us_applications WHERE id='dr-join-1'");
  assert.equal(Number(join.n), 0);
});

test('the owner always may', { skip }, async () => {
  assert.equal((await as(OWNER).del('/api/admin/subscribers/dr-sub-2')).status, 200);
  assert.equal(await subscriberGone('dr-sub-2'), true);
});

test('your own task is yours to delete; one somebody gave you is not', { skip }, async () => {
  assert.equal((await as(STAFF.nashwa).del('/api/admin/tasks/dr-task-given')).status, 404);
  assert.equal((await as(STAFF.nashwa).del('/api/admin/tasks/dr-task-own')).status, 200);
  const [rows] = await pool.query('SELECT id FROM tasks WHERE tenant_id=?', [T]);
  assert.deepEqual(rows.map(row => row.id), ['dr-task-given']);
});

test('only the owner reads or saves the list, and the saved list replaces the names', { skip }, async () => {
  assert.equal((await as(STAFF.walid).get('/api/admin/delete-rights')).status, 403, 'a manager on the list still cannot change it');
  assert.equal((await as(STAFF.walid).put('/api/admin/delete-rights', { staffIds: ['dr-walid', 'dr-nashwa'] })).status, 403);

  const view = await as(OWNER).get('/api/admin/delete-rights');
  assert.equal(view.status, 200, JSON.stringify(view.body));
  assert.equal(view.body.saved, false);
  assert.deepEqual(view.body.staff.filter(row => row.allowed).map(row => row.id).sort(), ['dr-hazem', 'dr-walid']);

  assert.equal((await as(OWNER).put('/api/admin/delete-rights', { staffIds: ['nobody-here'] })).status, 400);
  const saved = await as(OWNER).put('/api/admin/delete-rights', { staffIds: ['dr-kholoud'] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.saved, true);
  assert.deepEqual(saved.body.staffIds, ['dr-kholoud']);
  const [[audit]] = await pool.query("SELECT COUNT(*) AS n FROM audit_logs WHERE tenant_id=? AND action='delete_rights_changed'", [T]);
  assert.equal(Number(audit.n), 1, 'the change is in the audit trail');

  const refused = await as(STAFF.walid).del('/api/admin/subscribers/dr-sub-3');
  assert.equal(refused.status, 403, 'Walid matched by name no longer counts once a list is saved');
  assert.equal(refused.body.error, 'الحذف لخلود بس');
  assert.equal((await as(STAFF.kholoud).del('/api/admin/subscribers/dr-sub-3')).status, 200);
  assert.equal((await as(STAFF.kholoud).del('/api/admin/staff/dr-target-2')).status, 200);
  assert.equal((await as(OWNER).del('/api/admin/subscribers/dr-sub-4')).status, 200, 'and the owner still may');
});
