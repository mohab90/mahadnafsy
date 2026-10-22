'use strict';
/**
 * Who may create, change and remove staff and accounts — over HTTP on the real
 * app, signed in as each kind of member of staff, against a real MariaDB.
 *
 * HR (manage_staff, no owner role) can add an employee but cannot mint an
 * admin, grant a permission it does not hold, rewrite a manager, raise its own
 * pay, give a login an owner's role, or delete anyone. An administrator
 * deletes and restores; a deleted employee leaves the list, nobody deletes
 * themselves, and a create that fails says why. No route that puts a password
 * on an address will do it for a member of staff's address — sign-up,
 * «إنشاء حساب», or a client's credentials pointed at it. Replaces the
 * source-text checks on routes/staff.js, routes/auth/*.js and lib/permissionGrant.js.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, ensureTenant } = require('./support/http');

const T = 'tenant-staff-it';
let pool; let app; let admin; let hr; let onlineManager;

const one = async (sql, params) => (await pool.query(sql, params))[0][0];
const createStaff = (session, body) => app.call('POST', '/api/admin/staff', { session, body });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await ensureTenant(pool, T);
  app = await startApp(pool);
  admin = await signInStaff(pool, app, { tenantId: T, id: 'st-sa-admin', role: 'ADMIN', name: 'المديرة' });
  hr = await signInStaff(pool, app, {
    tenantId: T, id: 'st-sa-hr', role: 'HR', name: 'الموارد البشرية',
    permissions: ['view_dashboard', 'view_staff', 'manage_staff', 'view_hr'],
  });
  onlineManager = await signInStaff(pool, app, { tenantId: T, id: 'st-sa-online', role: 'ONLINE_MANAGER', name: 'أونلاين' });
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('HR adds an employee, but cannot mint an admin or a manager', { skip }, async () => {
  const sales = await createStaff(hr, { id: 'st-sa-new-sales', name: 'مندوبة', email: 'new.sales@example.test', role: 'SALES' });
  assert.equal(sales.status, 200, sales.text);
  assert.equal((await one("SELECT role FROM staff WHERE id='st-sa-new-sales'")).role, 'SALES');
  for (const role of ['ADMIN', 'MANAGER']) {
    const res = await createStaff(hr, { name: 'مدير مزيف', email: `fake.${role}@example.test`, role });
    assert.equal(res.status, 403, `${role}: ${res.text}`);
  }
  const [rows] = await pool.query("SELECT id FROM staff WHERE tenant_id=? AND email LIKE 'fake.%'", [T]);
  assert.equal(rows.length, 0);
});

test('HR cannot hand out a permission it does not hold, in either spelling', { skip }, async () => {
  for (const body of [
    { permissions: ['view_leads', 'manage_financial'] },
    { permissions_json: JSON.stringify(['view_leads', 'manage_financial']) },
  ]) {
    const res = await createStaff(hr, { name: 'موظف', email: `grant.${Object.keys(body)[0]}@example.test`, role: 'SALES', ...body });
    assert.equal(res.status, 403, res.text);
    assert.match(res.body.error, /manage_financial/);
  }
});

test('HR cannot rewrite a manager\'s row, or raise its own pay', { skip }, async () => {
  const rewrite = await createStaff(hr, { id: 'st-sa-admin', name: 'المديرة', email: admin.email, role: 'SALES' });
  assert.equal(rewrite.status, 403, rewrite.text);
  assert.equal(rewrite.body.code, 'OWNER_REQUIRED_FOR_PRIVILEGED_ACCOUNT');
  assert.equal((await one("SELECT role FROM staff WHERE id='st-sa-admin'")).role, 'ADMIN');
  const raise = await createStaff(hr, { id: 'st-sa-hr', name: 'الموارد البشرية', email: hr.email, role: 'HR', commission_rate: 50 });
  assert.equal(raise.status, 403, raise.text);
  assert.equal(raise.body.code, 'OWN_PAY_REFUSED');
});

test('a login with an owner\'s role needs the owner, and HR deletes nobody', { skip }, async () => {
  const login = await app.call('POST', '/api/admin/staff-account', {
    session: hr, body: { email: 'login.admin@example.test', password: 'a-long-password', name: 'مدير', role: 'ADMIN' },
  });
  assert.equal(login.status, 403, login.text);
  assert.equal(login.body.code, 'OWNER_REQUIRED_FOR_PRIVILEGED_ROLE');
  assert.equal(await one("SELECT id FROM users WHERE email='login.admin@example.test'"), undefined);
  const remove = await app.call('DELETE', '/api/admin/staff/st-sa-new-sales', { session: hr });
  assert.equal(remove.status, 403, remove.text);
  const asOnlineManager = await app.call('DELETE', '/api/admin/staff/st-sa-new-sales', { session: onlineManager });
  assert.equal(asOnlineManager.status, 403, 'an online manager is not an owner either');
});

test('a create that fails says why', { skip }, async () => {
  const noName = await createStaff(admin, { email: 'noname@example.test', role: 'SALES' });
  assert.equal(noName.body.code, 'NAME_REQUIRED');
  const noEmail = await createStaff(admin, { name: 'بدون بريد', role: 'SALES' });
  assert.equal(noEmail.body.code, 'EMAIL_REQUIRED');
  const taken = await createStaff(admin, { name: 'نسخة', email: 'NEW.SALES@example.test ', role: 'SALES' });
  assert.equal(taken.status, 409, taken.text);
  assert.equal(taken.body.code, 'EMAIL_TAKEN');
});

test('deleting an employee takes them off the list; restoring brings them back', { skip }, async () => {
  const listed = async () => {
    const res = await app.call('GET', '/api/admin/staff', { session: admin });
    assert.equal(res.status, 200, res.text);
    const rows = Array.isArray(res.body) ? res.body : (res.body.staff || res.body.rows || []);
    return rows.map(row => row.id);
  };
  assert.ok((await listed()).includes('st-sa-new-sales'));
  const removed = await app.call('DELETE', '/api/admin/staff/st-sa-new-sales', { session: admin });
  assert.equal(removed.status, 200, removed.text);
  assert.ok(!(await listed()).includes('st-sa-new-sales'), 'gone from the screen, not just marked inactive');
  const again = await createStaff(admin, { name: 'نسخة', email: 'new.sales@example.test', role: 'SALES' });
  assert.equal(again.body.code, 'EMAIL_BELONGS_TO_DELETED_STAFF', 'the address points at the person removed');
  const restored = await app.call('PUT', '/api/admin/staff/st-sa-new-sales/restore', { session: admin });
  assert.equal(restored.status, 200, restored.text);
  assert.ok((await listed()).includes('st-sa-new-sales'));
});

test('nobody deletes their own account', { skip }, async () => {
  const res = await app.call('DELETE', '/api/admin/staff/st-sa-admin', { session: admin });
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.code, 'CANNOT_DELETE_SELF');
});

test('no route puts a password on a member of staff\'s address', { skip }, async () => {
  for (const path of ['/api/auth/register', '/api/user/signup']) {
    const res = await app.call('POST', path, {
      tenantId: T, body: { email: hr.email, password: 'a-long-password', name: 'منتحل', phone: '01055566677' },
    });
    assert.equal(res.status, 403, `${path}: ${res.text}`);
    assert.equal(res.body.code, 'STAFF_INVITATION_REQUIRED');
  }
  const created = await app.call('POST', '/api/admin/create-account', {
    session: onlineManager, body: { email: hr.email, name: 'منتحل', password: 'a-long-password', phone: '01055566677' },
  });
  assert.equal(created.status, 403, created.text);
  assert.equal(created.body.code, 'STAFF_INVITATION_REQUIRED');
  const hrUser = await one('SELECT password_hash FROM users WHERE id=?', [hr.userId]);

  // A client's login, pointed at the HR address with a password of the caller's choosing.
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, email, phone, is_active, created_at)
     VALUES ('sub-sa-1', ?, 'عميلة', 'client.sa@example.test', '01055566688', 1, UTC_TIMESTAMP())`, [T]);
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active)
     VALUES ('sub-sa-1', ?, 'client.sa@example.test', 'x', 'عميلة', 'user', 1)`, [T]);
  const pointed = await app.call('PUT', '/api/admin/subscribers/sub-sa-1/credentials', {
    session: onlineManager, body: { newEmail: hr.email, newPassword: 'chosen-by-caller' },
  });
  assert.equal(pointed.status, 403, pointed.text);
  assert.equal(pointed.body.code, 'STAFF_INVITATION_REQUIRED');
  assert.equal((await one("SELECT email FROM users WHERE id='sub-sa-1'")).email, 'client.sa@example.test');
  assert.equal((await one('SELECT password_hash FROM users WHERE id=?', [hr.userId])).password_hash, hrUser.password_hash);
  const [twins] = await pool.query('SELECT id FROM users WHERE tenant_id=? AND LOWER(email)=?', [T, hr.email]);
  assert.equal(twins.length, 1, 'still one login on the HR address: the employee\'s own');
});
