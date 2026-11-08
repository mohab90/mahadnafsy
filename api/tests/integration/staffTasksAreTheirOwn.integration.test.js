'use strict';
/**
 * «مهامي» as it behaves, on a real MariaDB (these were regular expressions over routes/campaigns.js, `mineOnly` and `taskManager(req)` in SQL strings):
 * an employee with no permission at all still has their own to-do list — they see only tasks assigned to them, whatever they ask for; a task they make is
 * assigned to them; they cannot change or remove anyone else's; a manager sees every task, and `my=true` narrows even a manager to their own. Runs only
 * with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
// The owner's delete right is the point of the delete case, so the list is the one this institute's rule names: nobody here, so deleting is the author's own task only.
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-tasks-it';
let pool; let router;

const EMP = { id: 'st-tk-emp', name: 'موظفة', role: 'sales', permissions_json: '[]' };
const EMP2 = { id: 'st-tk-emp2', name: 'زميلة', role: 'sales', permissions_json: '[]' };
const MGR = { id: 'st-tk-mgr', name: 'مدير', role: 'manager', permissions_json: '[]' };

async function call(method, path, { staff, params = {}, body = {}, query = {} } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query, headers: {}, tenantId: T, user: { uid: `u-${staff.id}`, email: `${staff.id}@example.test` }, staffRecord: staff, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['tasks', 'staff', 'tenant_settings']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}
const titles = res => res.body.map(task => task.title).sort();
const make = (staff, title, extra = {}) => call('post', '/api/admin/tasks', { staff, body: { title, ...extra } });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/campaigns');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  let n = 0;
  for (const staff of [EMP, EMP2, MGR]) {
    n += 1;
    await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?, ?, ?, ?, ?, ?, 1, '2024-01-01')", [staff.id, T, staff.name, `${staff.id}@example.test`, `101234060${n}`, staff.role.toUpperCase()]);
  }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('an employee with no permission makes tasks for themselves and sees only their own', { skip }, async () => {
  assert.equal((await make(EMP, 'مهمتي')).statusCode, 200);
  assert.equal((await make(EMP2, 'مهمة زميلتي')).statusCode, 200);
  const forOther = await make(EMP, 'حاولت أسندها', { assigned_to: EMP2.id });
  assert.equal(forOther.statusCode, 200);
  const mine = await call('get', '/api/admin/tasks', { staff: EMP });
  assert.deepEqual(titles(mine), ['حاولت أسندها', 'مهمتي'], 'both of hers: the second was assigned to her whatever she asked');
  const askedForAll = await call('get', '/api/admin/tasks', { staff: EMP, query: { mine: '0' } });
  assert.deepEqual(titles(askedForAll), ['حاولت أسندها', 'مهمتي'], 'asking for everything changes nothing');
});

test('they cannot change or remove anyone else\'s task', { skip }, async () => {
  const [[theirs]] = await pool.query("SELECT id FROM tasks WHERE tenant_id=? AND title='مهمة زميلتي'", [T]);
  const edit = await call('put', '/api/admin/tasks/:id', { staff: EMP, params: { id: theirs.id }, body: { title: 'سرقتها', status: 'done' } });
  assert.equal(edit.statusCode, 404);
  const remove = await call('delete', '/api/admin/tasks/:id', { staff: EMP, params: { id: theirs.id } });
  assert.equal(remove.statusCode, 404);
  assert.equal((await pool.query('SELECT title FROM tasks WHERE id=?', [theirs.id]))[0][0].title, 'مهمة زميلتي');
});

test('a manager sees every task, and «my» narrows even a manager to their own', { skip }, async () => {
  await make(MGR, 'مهمة المدير', { assigned_to: MGR.id });
  const all = await call('get', '/api/admin/tasks', { staff: MGR });
  assert.equal(all.body.length, 4);
  assert.deepEqual(titles(await call('get', '/api/admin/tasks', { staff: MGR, query: { my: 'true' } })), ['مهمة المدير']);
  assert.equal((await make(EMP, 'x', { priority: 'whenever' })).statusCode, 400, 'a priority that is not one is refused');
});
