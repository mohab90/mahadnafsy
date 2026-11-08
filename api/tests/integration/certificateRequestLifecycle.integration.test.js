'use strict';
/**
 * The certificate requests desk, on a real MariaDB (these were regular expressions over routes/certificates.js, `PAID_STAGES`, `CERT_PAID_FORCE_REQUIRED`, `fullyPaid`,
 * `course_taken` and migration 229): a request is made for a client who holds the course in full and has finished it, once per type and course, priced or waiting for a price;
 * it moves on to the delivery stages only when it is paid in full, only along allowed steps, and never once the course was taken back; its price and currency are fixed after it
 * is paid; its details are the managers' to edit, and what a payment carries is not typed over; and deleting a paid one needs the owner's explicit force. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-certreq-it';
let pool; let router;

const MANAGER = { id: 'st-cr-mgr', name: 'المديرة', role: 'manager', permissions_json: '["manage_certificates"]' };
const CLERK = { id: 'st-cr-clerk', name: 'موظف', role: 'support', permissions_json: '["manage_certificates"]' };

async function call(method, path, { params = {}, body = {}, query = {}, staff = MANAGER, owner = false } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query, headers: {}, tenantId: T, user: { uid: 'u', email: 'mgr-cr@example.test', tenant_id: T }, staffRecord: owner ? null : staff, isSuperAdmin: owner, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
async function clean() {
  for (const table of ['activity_logs', 'financial_audit_log', 'certificate_requests', 'payments', 'course_completions', 'enrollments', 'subscribers', 'courses', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const create = (subscriberId, body = {}) => call('post', '/api/admin/certificate-requests', { body: { subscriberId, courseId: 'co-cr-1', type: 'INSTITUTE', ...body } });
const patch = (id, body, staff) => call('patch', '/api/admin/certificate-requests/:id', { params: { id }, body, staff });
const row = async id => (await pool.query('SELECT status, price, paid_amount, collection_party, admin_note FROM certificate_requests WHERE id=?', [id]))[0][0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/certificates');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES ('co-cr-1', ?, 'دبلومة', '', '', '', '', 'GENERAL', 'RECORDED', 3000)`, [T]);
  for (const [id, phone, enrolled] of [['sub-cr-a', '01019700001', true], ['sub-cr-b', '01019700002', true], ['sub-cr-c', '01019700003', true], ['sub-cr-none', '01019700004', false]]) {
    await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES (?, ?, 'عميلة كاملة الاسم', ?, 'ONLINE_EGYPT', 'branch-online-egypt')", [id, T, phone]);
    if (!enrolled) continue;
    await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, status, access_type, enrolled_at) VALUES (UUID(), ?, ?, 'co-cr-1', 'active', 'full', NOW())", [T, id]);
    await pool.query("INSERT INTO course_completions (id, tenant_id, subscriber_id, course_id, certificate_code, status) VALUES (UUID(), ?, ?, 'co-cr-1', ?, 'active')", [T, id, `CC-${id}`]);
  }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a request is made for a client who holds the course in full and finished it, once per type, priced or waiting for a price', { skip }, async () => {
  assert.equal((await call('post', '/api/admin/certificate-requests', { body: { type: 'INSTITUTE' } })).statusCode, 400, 'a client and a course are named');
  assert.equal((await create('sub-cr-a', { type: 'MADE_UP' })).statusCode, 400);
  assert.equal((await create('sub-cr-a', { price: -5 })).statusCode, 400);
  assert.equal((await create('sub-cr-none')).statusCode, 409, 'not enrolled, not finished');
  const waiting = await create('sub-cr-b');
  assert.equal(waiting.statusCode, 201, JSON.stringify(waiting.body));
  assert.equal(waiting.body.status, 'pending', 'no price in the list for it yet');
  const priced = await create('sub-cr-a', { price: 600 });
  assert.equal(priced.statusCode, 201, JSON.stringify(priced.body));
  assert.deepEqual([priced.body.status, priced.body.price, priced.body.paidAmount], ['priced', 600, 0]);
  const again = await create('sub-cr-a', { price: 600 });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.id, priced.body.id, 'asking again points at the open one');
});

test('a request reaches the delivery stages only when paid in full, along allowed steps, never once the course was taken back, and its price is fixed after payment', { skip }, async () => {
  const [[request]] = await pool.query("SELECT id FROM certificate_requests WHERE tenant_id=? AND subscriber_id='sub-cr-a'", [T]);
  assert.equal((await patch(request.id, { status: 'LOST' })).statusCode, 400, 'not a stage');
  assert.equal((await patch('nope', { status: 'PAID' })).statusCode, 404);
  const unpaid = await patch(request.id, { status: 'SHIPPED' });
  assert.equal(unpaid.statusCode, 409);
  assert.equal(unpaid.body.code, 'CERTIFICATE_NOT_PAID');
  assert.equal((await patch(request.id, { status: 'PENDING' })).statusCode, 409, 'PRICED does not go back to PENDING');
  assert.equal((await row(request.id)).status, 'PRICED', 'nothing moved');

  await pool.query('UPDATE certificate_requests SET paid_amount=600 WHERE id=?', [request.id]);
  assert.equal((await patch(request.id, { status: 'SHIPPED' })).statusCode, 200, 'paid in full');
  assert.equal((await row(request.id)).status, 'SHIPPED');
  const [events] = await pool.query("SELECT label FROM activity_logs WHERE tenant_id=? AND action='certificate_status'", [T]);
  assert.equal(events.length, 1, 'the move is in the client\'s history');
  assert.equal((await patch(request.id, { status: 'SHIPPED', price: 900 })).statusCode, 409, 'the price is fixed once it is paid');
  assert.equal((await patch(request.id, { status: 'DELIVERED', notes: 'استلمت' })).statusCode, 200);
  assert.equal((await row(request.id)).admin_note, 'استلمت');

  await pool.query("INSERT INTO certificate_requests (id, certificate_code, subscriber_id, course_id, type, status, price, paid_amount, currency, tenant_id) VALUES ('cr-taken', 'MAHADTAKEN', 'sub-cr-c', 'co-cr-1', 'OTHER', 'PAID', 500, 500, 'EGP', ?)", [T]);
  await pool.query("UPDATE enrollments SET status='revoked' WHERE tenant_id=? AND subscriber_id='sub-cr-c'", [T]);
  const taken = await patch('cr-taken', { status: 'ISSUED' });
  assert.equal(taken.statusCode, 409, 'a refund took the course away: no certificate on it');
  assert.equal((await row('cr-taken')).status, 'PAID');
});

test('details are the managers\' to edit, what a payment carries is not typed over, and a paid request is deleted only with the owner\'s force', { skip }, async () => {
  const details = (id, body, staff) => call('put', '/api/admin/certificate-requests/:id/details', { params: { id }, body, staff });
  const [[open]] = await pool.query("SELECT id FROM certificate_requests WHERE tenant_id=? AND subscriber_id='sub-cr-b'", [T]);
  assert.equal((await details(open.id, { collectionParty: 'شركة الشحن' }, CLERK)).body.code, 'MANAGERS_ONLY');
  assert.equal((await details(open.id, { nationality: 'MARTIAN' })).statusCode, 400);
  assert.equal((await details('nope', { adminNote: 'x' })).statusCode, 404);
  const saved = await details(open.id, { collectionParty: 'شركة الشحن', adminNote: 'العنوان في الدقي' });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual((await row(open.id)).collection_party, 'شركة الشحن');

  await pool.query("UPDATE certificate_requests SET price=800, status='PRICED' WHERE id=?", [open.id]);
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, status, payment_type, certificate_request_id, date) VALUES ('p-cr-1', ?, 'sub-cr-b', 'co-cr-1', 300, 300, 'EGP', 'paid', 'CERTIFICATE', ?, NOW())", [T, open.id]);
  assert.equal((await details(open.id, { paidAmount: 800 })).statusCode, 409, 'what was paid is the payment\'s');

  assert.equal((await call('delete', '/api/admin/certificate-requests/:id', { params: { id: open.id }, staff: CLERK })).body.code, 'MANAGERS_ONLY');
  const refused = await call('delete', '/api/admin/certificate-requests/:id', { params: { id: open.id } });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'CERT_PAID_FORCE_REQUIRED');
  assert.equal((await call('delete', '/api/admin/certificate-requests/:id', { params: { id: open.id }, query: { force: '1' } })).statusCode, 409, 'a manager cannot force it');
  const forced = await call('delete', '/api/admin/certificate-requests/:id', { params: { id: open.id }, query: { force: '1' }, owner: true });
  assert.equal(forced.statusCode, 200, JSON.stringify(forced.body));
  assert.equal((await pool.query('SELECT id FROM certificate_requests WHERE id=?', [open.id]))[0].length, 0);
  assert.equal((await pool.query("SELECT id, certificate_request_id FROM payments WHERE id='p-cr-1'"))[0][0].certificate_request_id, null, 'the money stays, no longer pointing at it');
  assert.equal((await pool.query("SELECT id FROM financial_audit_log WHERE tenant_id=? AND action='force_delete'", [T]))[0].length, 1);
});
