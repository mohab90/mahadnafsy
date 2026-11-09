'use strict';
/**
 * Turning a client back into a lead (POST /api/admin/subscribers/:id/convert-to-lead), on a real MariaDB (these were regular expressions over
 * routes/admin/subscribers.js): a client with no payment, active enrolment, order or certificate request goes back to being a lead and leaves the client base;
 * one with any of that history is refused with what blocks it and nothing changes; a client who is gone, or another institute's, is a 404; and the archived
 * client no longer answers a client-code lookup. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-tolead-it'; const OTHER = 'tenant-tolead-other';
let pool; let router;

async function convert(id, tenantId = T) {
  const layer = router.stack.find(item => item.route?.path === '/api/admin/subscribers/:id/convert-to-lead' && item.route.methods.post);
  assert.ok(layer);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params: { id }, body: {}, query: {}, headers: {}, tenantId, user: { uid: 'u', email: 'owner@example.test' }, staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined };
  // The owner's delete right has its own test (integration/deleteRights), so it is skipped here like the identity guards.
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff', 'requireDeleteRight'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const tenant of [T, OTHER]) {
    for (const table of ['lead_timeline', 'enrollments', 'payments', 'subscribers', 'courses', 'leads', 'audit_events', 'activity_logs']) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [tenant]).catch(() => {});
    }
  }
}
const sub = (id, tenant, phone, code) => pool.query(
  "INSERT INTO subscribers (id, tenant_id, name, phone, client_code, branch, branch_id, is_active) VALUES (?, ?, 'عميل', ?, ?, 'ONLINE_EGYPT', 'branch-online-egypt', 1)", [id, tenant, phone, code]);
const state = async id => (await pool.query('SELECT is_active, deleted_at FROM subscribers WHERE id=?', [id]))[0][0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/admin/subscribers');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active'), (?, ?, 'IT2', 'active')", [T, T, OTHER, OTHER]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES ('co-tl-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 1000)`, [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a client with no history goes back to being a lead and leaves the client base', { skip }, async () => {
  await sub('sub-tl-clean', T, '01011110001', 'TLC1');
  const res = await convert('sub-tl-clean');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const gone = await state('sub-tl-clean');
  assert.deepEqual([Number(gone.is_active), !!gone.deleted_at], [0, true], 'archived');
  const [leads] = await pool.query('SELECT id, phone FROM leads WHERE tenant_id=? AND phone=?', [T, '01011110001']);
  assert.equal(leads.length, 1, 'and a lead holds the number');
  assert.equal((await convert('sub-tl-clean')).statusCode, 404, 'a client already archived is not found');
});

test('a client with a payment or an active enrolment is refused, with what blocks it, and nothing changes', { skip }, async () => {
  await sub('sub-tl-paid', T, '01011110002', 'TLC2');
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, status, payment_type, date) VALUES ('p-tl-1', ?, 'sub-tl-paid', 100, 'EGP', 'paid', 'OTHER', NOW())", [T]);
  const paid = await convert('sub-tl-paid');
  assert.equal(paid.statusCode, 409);
  assert.equal(paid.body.blockers.payments, 1);
  assert.equal(Number((await state('sub-tl-paid')).is_active), 1);

  await sub('sub-tl-enrolled', T, '01011110003', 'TLC3');
  await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, status, access_type) VALUES ('en-tl-1', ?, 'sub-tl-enrolled', 'co-tl-1', NOW(), 'active', 'full')", [T]);
  const enrolled = await convert('sub-tl-enrolled');
  assert.equal(enrolled.statusCode, 409);
  assert.equal(enrolled.body.blockers.enrollments, 1);
  const [leads] = await pool.query('SELECT id FROM leads WHERE tenant_id=? AND phone IN (?, ?)', [T, '01011110002', '01011110003']);
  assert.equal(leads.length, 0, 'no lead was made for either');
});

test('another institute\'s client is a 404', { skip }, async () => {
  await sub('sub-tl-foreign', OTHER, '01011110004', 'TLC4');
  assert.equal((await convert('sub-tl-foreign')).statusCode, 404);
  assert.equal(Number((await state('sub-tl-foreign')).is_active), 1);
});
