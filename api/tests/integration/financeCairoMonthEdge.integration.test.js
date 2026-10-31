'use strict';
/**
 * A month is Cairo days, on every screen (31 Oct 2026 audit).
 *
 * Payments are stored as UTC instants. The dashboard cut «this month» at Cairo's midnight; the statement, the payments
 * register, the cockpit and the period-close checks cut it at UTC midnight, three hours early. On the lab the dashboard
 * said 1,463,200 and the statement 1,446,000: 18 payments taken between 00:00 and 03:00 on the 1st. A payment at
 * 00:30 Cairo on 1 October is October's in all of them.
 *
 * Also pinned: the payments export and list took `date <= '2026-10-31'` as the end of the range, which is the first
 * second of the 31st, so the last day's payments were left out.
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
const TENANT = 'tenant-cairo-month-it';
let pool; let finance; let register;

async function call(router, path, query) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods.get);
  assert.ok(layer, path);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await layer.route.stack.at(-1).handle({
    params: {}, query, body: {}, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'x@example.test' },
    staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}

async function clean() {
  for (const table of ['payments', 'subscribers', 'courses']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

const pay = (id, date, amountEgp) => ({
  id, subscriber_id: 'sub-cm-1', date, amount: amountEgp, currency: 'EGP', fx_rate_to_egp: 1, amount_egp: amountEgp,
  payment_type: 'COURSE', course_id: 'co-cm-1', status: 'paid', branch: 'ONLINE_EGYPT', branch_id: 'branch-online-egypt', payment_method: 'كاش',
});

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  finance = require('../../routes/finance');
  register = require('../../routes/finance-payments-register');
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type)
     VALUES ('co-cm-1', ?, 'دبلومة', '', '', '', '', 'GENERAL', 'RECORDED')`, [TENANT]);
  await pool.query(`INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES ('sub-cm-1', ?, 'عميل', '1017100001', 'ONLINE_EGYPT', 'branch-online-egypt')`, [TENANT]);
  // UTC instants. Egypt is on summer time (+03:00) until the last Friday of October and on +02:00 after it.
  const rows = [
    pay('p-cm-1', '2026-09-30 21:30:00', 100),  // 00:30 on 1 Oct, Cairo (+3)      -> October
    pay('p-cm-2', '2026-09-30 20:30:00', 200),  // 23:30 on 30 Sep, Cairo          -> September
    pay('p-cm-3', '2026-10-31 20:30:00', 400),  // 22:30 on 31 Oct, Cairo (+2)     -> October, the last evening
    pay('p-cm-4', '2026-10-31 22:30:00', 800),  // 00:30 on 1 Nov, Cairo (+2)      -> November
  ];
  for (const row of rows) {
    const cols = Object.keys(row);
    await pool.query(`INSERT INTO payments (tenant_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`, [TENANT, ...Object.values(row)]);
  }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('the statement cuts October at Cairo midnight at both ends', { skip }, async () => {
  const october = await call(finance, '/api/admin/finance/statement', { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(october.statusCode, 200, JSON.stringify(october.body));
  assert.equal(october.body.current.collected, 500, '100 at 00:30 on the 1st and 400 on the last evening');
  assert.equal(october.body.current.payments, 2);
  const september = await call(finance, '/api/admin/finance/statement', { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(september.body.current.collected, 200, 'the 00:30 payment is not September\'s');
});

test('the daily series puts a payment on the Cairo day it was taken', { skip }, async () => {
  const october = await call(finance, '/api/admin/finance/statement', { from: '2026-10-01', to: '2026-10-31' });
  const day = key => october.body.series.points.find(p => p.key === key)?.collected || 0;
  assert.equal(day('2026-10-01'), 100);
  assert.equal(day('2026-10-31'), 400);
});

test('the payments register filters the same days', { skip }, async () => {
  const res = await call(register, '/api/admin/finance/payments-register', { from: '2026-10-01', to: '2026-10-31', pageSize: '50' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.totalEgp, 500);
  assert.equal(res.body.total, 2);
});
