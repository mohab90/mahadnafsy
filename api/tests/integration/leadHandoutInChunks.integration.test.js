'use strict';
/**
 * «توزيع الليدز» and bulk-assign on a pool larger than one request takes (owner's decision, 11 Nov 2026): a request hands out at most
 * HANDOUT_CAP leads in short chunks, answers how many remain and where to carry on, writes one «assigned» timeline event per lead and
 * one notice per rep; bulk-assign refuses a status filter that is not an open one. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-lead-handout-it';
const POOL_SIZE = 2300;
let pool;

async function call(router, method, path, { body = {}, staff = null } = {}) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `no ${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({
    method: method.toUpperCase(), params: {}, query: {}, body, headers: {}, tenantId: TENANT,
    user: { uid: 'u-handout', email: 'handout@lead-it.test' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}

async function clean() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for (const table of ['lead_timeline', 'notifications', 'leads', 'staff', 'activity_logs', 'tenant_settings']) {
      await conn.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
    }
  } finally { conn.release(); }
}
async function fillPool(prefix, count, status = 'new') {
  for (let from = 0; from < count; from += 500) {
    const rows = [];
    for (let i = from; i < Math.min(count, from + 500); i++) rows.push([`${prefix}-${String(i).padStart(5, '0')}`, TENANT, `ليد ${i}`, 'site', status, 0]);
    await pool.query('INSERT INTO leads (id, tenant_id, name, source, status, hidden) VALUES ?', [rows]);
  }
}
const resetPool = () => pool.query('DELETE FROM lead_timeline WHERE tenant_id=?', [TENANT])
  .then(() => pool.query('DELETE FROM notifications WHERE tenant_id=?', [TENANT]))
  .then(() => pool.query('DELETE FROM leads WHERE tenant_id=?', [TENANT]));

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  for (const id of ['ho-rep-1', 'ho-rep-2']) {
    await pool.query(
      `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?,?,?,?,?, 'sales', 1, '2026-01-01')`,
      [id, TENANT, id, `${id}@lead-it.test`, `0109308${String(Math.floor(Math.random() * 9000) + 1000)}`]);
  }
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); setTimeout(() => process.exit(), 300).unref(); } });

async function drain(router, path, body = {}) {
  const answers = [];
  let carry = {};
  for (let round = 0; round < 6; round++) {
    const res = await call(router, 'post', path, { body: { ...body, ...carry } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    answers.push(res.body);
    if (!res.body.remaining) break;
    carry = { skip: res.body.skip };
  }
  return answers;
}
const eventsPerLead = async () => (await pool.query(
  "SELECT lead_id, COUNT(*) AS n FROM lead_timeline WHERE tenant_id=? AND event_type='assigned' GROUP BY lead_id", [TENANT]))[0];

test('distribute hands out at most the cap per request, says what remains, and carries on from there', { skip }, async () => {
  const { HANDOUT_CAP } = require('../../lib/leadHandout');
  const router = require('../../routes/lead-capture-crm');
  await fillPool('ho-d', POOL_SIZE);
  const answers = await drain(router, '/api/admin/leads/distribute');
  assert.ok(answers.length >= 2, 'a pool larger than the cap takes more than one request');
  assert.ok(answers[0].assigned <= HANDOUT_CAP && answers[0].remaining > 0, JSON.stringify(answers[0]));
  assert.equal(answers.at(-1).remaining, 0);
  const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=? AND assigned_sales_id IS NOT NULL', [TENANT]);
  assert.equal(Number(count.n), answers.reduce((sum, a) => sum + a.assigned, 0), 'the answers add up to what is in the table');
  assert.ok(Number(count.n) > POOL_SIZE / 2, `most of the pool was handed out (${count.n})`);

  // One «assigned» event for each lead handed out, and none for the ones left in the pool.
  const events = await eventsPerLead();
  assert.equal(events.length, Number(count.n));
  assert.ok(events.every(row => Number(row.n) === 1));
  // One notice per rep per request — a summary, not a row per lead.
  const [notices] = await pool.query("SELECT recipient_staff_id, COUNT(*) AS n FROM notifications WHERE tenant_id=? AND type='lead' GROUP BY recipient_staff_id", [TENANT]);
  assert.ok(notices.length >= 1 && notices.every(row => Number(row.n) <= answers.length), JSON.stringify(notices));
});

test('bulk-assign works the same way: capped, counted, an event per lead, one notice per rep', { skip }, async () => {
  const { HANDOUT_CAP } = require('../../lib/leadHandout');
  const router = require('../../routes/admin/leads/assignment');
  await resetPool();
  await fillPool('ho-b', POOL_SIZE);
  const first = await call(router, 'post', '/api/admin/leads/bulk-assign', { body: {} });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.assigned, HANDOUT_CAP, 'the cap');
  assert.equal(first.body.remaining, POOL_SIZE - HANDOUT_CAP, 'and the rest is reported, for the screen to continue');
  const second = await call(router, 'post', '/api/admin/leads/bulk-assign', { body: { skip: first.body.skip } });
  assert.deepEqual([second.body.assigned, second.body.remaining], [POOL_SIZE - HANDOUT_CAP, 0]);
  const events = await eventsPerLead();
  assert.equal(events.length, POOL_SIZE);
  const [notices] = await pool.query("SELECT recipient_staff_id, COUNT(*) AS n FROM notifications WHERE tenant_id=? AND type='lead' GROUP BY recipient_staff_id", [TENANT]);
  assert.equal(notices.length, 2, 'both reps are told');
  assert.ok(notices.every(row => Number(row.n) === 2), 'once per request, not once per lead');
});

test('bulk-assign takes only an open status as a filter: converted, won and nonsense are refused', { skip }, async () => {
  const router = require('../../routes/admin/leads/assignment');
  await resetPool();
  await fillPool('ho-s', 3, 'converted');
  for (const statusFilter of ['converted', 'won', 'archived', 'nonsense']) {
    const res = await call(router, 'post', '/api/admin/leads/bulk-assign', { body: { statusFilter } });
    assert.equal(res.statusCode, 400, statusFilter);
  }
  const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM leads WHERE tenant_id=? AND assigned_sales_id IS NOT NULL', [TENANT]);
  assert.equal(Number(count.n), 0, 'no customer lead was handed to a rep');
  await fillPool('ho-o', 2, 'interested');
  const ok = await call(router, 'post', '/api/admin/leads/bulk-assign', { body: { statusFilter: 'interested' } });
  assert.deepEqual([ok.statusCode, ok.body.assigned], [200, 2]);
});
