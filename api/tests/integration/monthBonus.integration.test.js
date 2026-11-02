'use strict';
/**
 * 2 Nov 2026, «أضيف مكافأة لكل موظف على كل شهر وأكتب تحقيق المطلوب كام والمكافأة كام»: the month sheet writes one bonus row per employee and month
 * with what was required, what was reached and what is paid; saving again updates that row; money waits for a second person's approval; an
 * approved month is final; nobody gives themselves one. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-month-bonus-it';
let pool, router;

async function clean() {
  for (const table of ['employee_bonuses', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}
const handler = (method, path) => router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle;
async function call(method, path, { body = {}, query = {}, params = {}, actor = 'mb-hr' } = {}) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await handler(method, path)({ params, query, body, headers: {}, tenantId: T, user: { uid: actor }, staffRecord: { id: actor }, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/hr/compensation');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Month bonus IT', 'suspended')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, monthly_target, monthly_target_type, monthly_bonus) VALUES
       ('mb-hr', ?, 'مسؤول', 'mb0@x.t', '1017000000', 'MANAGER', 1, '2025-01-01', NULL, NULL, NULL),
       ('mb-sara', ?, 'سارة', 'mb1@x.t', '1017000001', 'SALES', 1, '2025-01-01', 20, 'clients', 500),
       ('mb-omar', ?, 'عمر', 'mb2@x.t', '1017000002', 'SALES', 1, '2025-01-01', NULL, NULL, NULL)`, [T, T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

const period = { month: 10, year: 2026 };
const read = async () => (await call('get', '/api/admin/hr/month-bonuses', { query: period })).body;
const entryOf = (list, id) => list.find(r => r.staffId === id);

test('the sheet lists every active employee with the standing target as a hint and no entry yet', { skip }, async () => {
  const list = await read();
  assert.equal(list.length, 3);
  const sara = entryOf(list, 'mb-sara');
  assert.deepEqual(sara.standing, { type: 'clients', target: 20, bonus: 500 });
  assert.equal(sara.entry, null);
});

test('required, reached and bonus are saved together, pending until a second person approves, and saving again updates the same row', { skip }, async () => {
  const saved = await call('put', '/api/admin/hr/month-bonuses', { body: { ...period, rows: [{ staffId: 'mb-sara', targetValue: 20, achievedValue: 23, amount: 500, targetUnit: 'clients', note: 'حققت التارجت' }] } });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  let entry = entryOf(await read(), 'mb-sara').entry;
  assert.deepEqual([entry.targetValue, entry.achievedValue, entry.amount, entry.status, entry.targetUnit, entry.note], [20, 23, 500, 'PENDING', 'clients', 'حققت التارجت']);
  await call('put', '/api/admin/hr/month-bonuses', { body: { ...period, rows: [{ staffId: 'mb-sara', targetValue: 20, achievedValue: 25, amount: 700, targetUnit: 'clients' }] } });
  const [[count]] = await pool.query("SELECT COUNT(*) n FROM employee_bonuses WHERE tenant_id=? AND staff_id='mb-sara' AND for_month=10 AND for_year=2026", [T]);
  assert.equal(count.n, 1, 'one row per employee and month');
  entry = entryOf(await read(), 'mb-sara').entry;
  assert.deepEqual([entry.achievedValue, entry.amount], [25, 700]);
  // payroll counts the month's approved bonuses only (routes/hr/payroll.js): not yet.
  const [[pending]] = await pool.query("SELECT COUNT(*) n FROM employee_bonuses WHERE tenant_id=? AND for_month=10 AND for_year=2026 AND status='APPROVED'", [T]);
  assert.equal(pending.n, 0);
});

test('a second person approves it, and then the month is final', { skip }, async () => {
  const entry = entryOf(await read(), 'mb-sara').entry;
  const own = await call('put', '/api/admin/hr/bonuses/:id/status', { params: { id: entry.id }, body: { status: 'APPROVED' }, actor: 'mb-hr' });
  assert.equal(own.statusCode, 409, 'its creator cannot approve it');
  const approved = await call('put', '/api/admin/hr/bonuses/:id/status', { params: { id: entry.id }, body: { status: 'APPROVED' }, actor: 'mb-omar' });
  assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  const [[row]] = await pool.query("SELECT COUNT(*) n, SUM(amount) amount FROM employee_bonuses WHERE tenant_id=? AND for_month=10 AND for_year=2026 AND status='APPROVED' AND type='bonus'", [T]);
  assert.deepEqual([row.n, Number(row.amount)], [1, 700]);
  const again = await call('put', '/api/admin/hr/month-bonuses', { body: { ...period, rows: [{ staffId: 'mb-sara', amount: 9999 }] } });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.code, 'BONUS_LOCKED');
  assert.equal(entryOf(await read(), 'mb-sara').entry.locked, true);
});

test('the target and what was reached can be recorded with no money, and clearing the row removes it', { skip }, async () => {
  const saved = await call('put', '/api/admin/hr/month-bonuses', { body: { ...period, rows: [{ staffId: 'mb-omar', targetValue: 15000, achievedValue: 9000, targetUnit: 'egp' }] } });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  const entry = entryOf(await read(), 'mb-omar').entry;
  assert.deepEqual([entry.targetValue, entry.achievedValue, entry.amount, entry.status, entry.locked], [15000, 9000, 0, 'APPROVED', false]);
  await call('put', '/api/admin/hr/month-bonuses', { body: { ...period, rows: [{ staffId: 'mb-omar', amount: 300 }] } });
  assert.equal(entryOf(await read(), 'mb-omar').entry.status, 'PENDING', 'money needs approval again');
  await call('put', '/api/admin/hr/month-bonuses', { body: { ...period, rows: [{ staffId: 'mb-omar', amount: '', targetValue: '', achievedValue: '' }] } });
  assert.equal(entryOf(await read(), 'mb-omar').entry, null);
});

test('nobody records one for themselves, and a bad number is refused whole', { skip }, async () => {
  const own = await call('put', '/api/admin/hr/month-bonuses', { body: { ...period, rows: [{ staffId: 'mb-hr', amount: 100 }] } });
  assert.equal(own.statusCode, 409);
  assert.equal(own.body.code, 'HR_SELF_MUTATION');
  const bad = await call('put', '/api/admin/hr/month-bonuses', { body: { ...period, rows: [{ staffId: 'mb-omar', amount: 50 }, { staffId: 'mb-sara', amount: -5 }] } });
  assert.equal(bad.statusCode, 400);
  assert.equal(entryOf(await read(), 'mb-omar').entry, null, 'the first row was rolled back with the second');
});
