'use strict';
/**
 * GET /api/admin/finance/payments-register against a real MariaDB: payments
 * named by the course they paid for, numbered, filtered by a merged channel
 * (every spelling of one box), by who recorded them, and searchable by their
 * number. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-register-it';
let pool, router;

async function register(query = {}) {
  const layer = router.stack.find(l => l.route?.path === '/api/admin/finance/payments-register');
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query, body: {}, headers: {}, tenantId: TENANT, user: { uid: 'admin' },
    staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}
async function clean() {
  for (const t of ['payments', 'subscribers', 'courses', 'staff']) await pool.query(`DELETE FROM ${t} WHERE tenant_id=?`, [TENANT]);
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/finance-payments-register');
  await clean();
  await pool.query(`INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
    ('reg-st-1', ?, 'منى المحاسبة', 'reg1@x.test', '1016660001', 'ACCOUNTANT', 1, '2025-01-01')`, [TENANT]);
  await pool.query(`INSERT INTO courses (id, tenant_id, title, title_ar, description, short_description, instructor, thumbnail, category, type, price_egp)
    VALUES ('reg-c-1', ?, 'Diploma', 'دبلومة الإرشاد النفسي', '', '', '', '', 'GENERAL', 'RECORDED', 3000)`, [TENANT]);
  await pool.query(`INSERT INTO subscribers (id, tenant_id, client_code, name, phone) VALUES ('reg-sub-1', ?, 'REG1', 'هبة', '1016660002')`, [TENANT]);
  const pay = (id, method, staff, date) => [id, TENANT, 'reg-sub-1', 'reg-c-1', 1000, 1000, 'EGP', 'COURSE', method, 'paid', date, staff];
  await pool.query(`INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, payment_type, payment_method, status, date, staff_id) VALUES ?`,
    [[pay('reg-p-1', 'كاش', 'reg-st-1', '2026-09-01'), pay('reg-p-2', 'خزنة الدقي', null, '2026-09-02'),
      pay('reg-p-3', 'فودافون كاش‏ 7722', 'reg-st-1', '2026-09-03'), pay('reg-p-4', 'فودافون كاش 7722', null, '2026-09-04')]]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('a payment is named by what it paid for, numbered, and its box merged', { skip }, async () => {
  const body = await register();
  assert.equal(body.total, 4);
  assert.ok(body.rows.every(r => r.service === 'دبلومة الإرشاد النفسي'), 'the course by name, not «كورس»');
  assert.ok(body.rows.every(r => Number.isInteger(r.number)));
  assert.equal(new Set(body.rows.map(r => r.number)).size, 4);
  const channels = Object.fromEntries(body.facets.channels.map(c => [c.channel, c.count]));
  assert.deepEqual(channels, { 'خزنة الدقي - كاش': 2, 'فودافون كاش 7722': 2 });
  assert.equal(body.rows[0].client.code, 'REG1');
});

test('filters: a merged channel takes every spelling; recorded-by; date; the operation number', { skip }, async () => {
  assert.equal((await register({ channel: 'فودافون كاش 7722' })).total, 2);
  assert.equal((await register({ channel: 'خزنة الدقي - كاش' })).total, 2);
  assert.equal((await register({ method: 'كاش' })).total, 2, 'a raw box name opens its whole channel');
  assert.equal((await register({ staff: 'reg-st-1' })).total, 2);
  assert.equal((await register({ staff: '__none__' })).total, 2);
  assert.equal((await register({ from: '2026-09-02', to: '2026-09-03' })).total, 2);
  const { rows } = await register();
  const one = rows[1];
  const found = await register({ q: `#${one.number}` });
  assert.deepEqual(found.rows.map(r => r.id), [one.id]);
  assert.equal((await register({ q: '01016660002' })).total, 4, 'the client by phone');
});
