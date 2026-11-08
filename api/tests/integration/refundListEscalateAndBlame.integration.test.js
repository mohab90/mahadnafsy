'use strict';
/**
 * The refunds list and what is done to a request around its decision, on a real MariaDB (these were regular expressions over routes/finance/refunds.js; the decision
 * itself, partial and full refunds and the confirmation are in refundBehaviour / refundDesk): the list names the course (or track) and how much the client has actually paid
 * (paid, not deleted, not pending) and says that a ticket history exists without sending it; a branch accountant sees their branch's requests only and an account with
 * neither view_financial nor manage_inbox is refused; escalating adds a note, who did it, and tells management; blaming a colleague is deliberate (an unknown staff member is not
 * found, an empty one clears it); and deleting archives the request out of the list. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-refund-list-it';
let pool; let router;

const CS = { id: 'st-rl-cs', name: 'خدمة العملاء', role: 'support', permissions_json: '["manage_inbox"]' };
const ACCOUNTS = { id: 'st-rl-acc', name: 'المحاسبة', role: 'accountant', permissions_json: '["view_financial","approve_refunds"]' };
const BRANCH_ACC = { id: 'st-rl-bacc', name: 'محاسب الدقي', role: 'accountant', permissions_json: '["view_financial"]', data_scope: 'branch:DAQQI' };
const NOBODY = { id: 'st-rl-no', name: 'مندوب', role: 'sales', permissions_json: '["view_leads"]' };

async function call(method, route, { id, body = {}, query = {}, staff = ACCOUNTS } = {}) {
  const layer = router.stack.find(item => item.route?.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params: { id }, body, query, headers: {}, tenantId: T, user: { uid: 'u', email: 'x@example.test', tenant_id: T }, staffRecord: staff, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff', 'requireAdmin'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const list = async (staff, query) => { const res = await call('get', '/api/admin/finance/refunds', { staff, query }); assert.equal(res.statusCode, 200, JSON.stringify(res.body)); return res.body; };

async function clean() {
  for (const table of ['notifications', 'communications', 'refund_requests', 'payments', 'subscribers', 'bundles', 'courses', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/finance/refunds');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-rl-cs', ?, 'خدمة العملاء', 'cs-rl@example.test', '1019500001', 'SUPPORT', 1, '2025-01-01'),
       ('st-rl-acc', ?, 'المحاسبة', 'acc-rl@example.test', '1019500002', 'ACCOUNTANT', 1, '2025-01-01'),
       ('st-rl-bacc', ?, 'محاسب الدقي', 'bacc-rl@example.test', '1019500003', 'ACCOUNTANT', 1, '2025-01-01'),
       ('st-rl-blamed', ?, 'الموظف المسؤول', 'blamed-rl@example.test', '1019500004', 'SALES', 1, '2025-01-01')`, [T, T, T, T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES ('co-rl-1', ?, 'دبلومة الإرشاد', '', '', '', '', 'GENERAL', 'RECORDED', 3000)`, [T]);
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description, price_egp, is_published) VALUES ('bu-rl-1', ?, 'مسار العلاج', '', 5000, 1)", [T]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, branch_id) VALUES
       ('sub-rl-1', ?, 'RL1', 'هبة', '1019500010', 'ONLINE_EGYPT', 'branch-online-egypt'),
       ('sub-rl-2', ?, 'RL2', 'سلمى', '1019500011', 'DAQQI', 'branch-daqqi')`, [T, T]);
  const payment = (id, status, amount, deleted = null) => pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, status, payment_type, course_expected, date, deleted_at)
     VALUES (?, ?, 'sub-rl-1', 'co-rl-1', ?, ?, 'EGP', ?, 'COURSE', 3000, NOW(), ?)`, [id, T, amount, amount, status, deleted]);
  await payment('p-rl-1', 'paid', 1000);
  await payment('p-rl-2', 'paid', 500);
  await payment('p-rl-3', 'pending', 900);
  await payment('p-rl-4', 'paid', 800, '2026-10-01 00:00:00');
  await pool.query(
    `INSERT INTO refund_requests (id, tenant_id, subscriber_id, payment_id, course_item, amount, currency, status, branch_id, ticket_history) VALUES
       ('rr-rl-1', ?, 'sub-rl-1', 'p-rl-1', NULL, 400, 'EGP', 'PENDING', 'branch-online-egypt', '[{"at":"2026-11-01","note":"شكوى"}]'),
       ('rr-rl-2', ?, 'sub-rl-2', NULL, 'bundle:bu-rl-1', 300, 'EGP', 'PENDING', 'branch-daqqi', NULL)`, [T, T]);
  await pool.query("INSERT INTO communications (id, tenant_id, subscriber_id, type, notes, outcome, date, staff_id) VALUES (UUID(), ?, 'sub-rl-1', 'call', 'اتصلت بيها', 'interested', NOW(), 'st-rl-cs')", [T]).catch(async () => {
    await pool.query("INSERT INTO communications (id, tenant_id, subscriber_id, type, notes, date, staff_id) VALUES (UUID(), ?, 'sub-rl-1', 'call', 'اتصلت بيها', NOW(), 'st-rl-cs')", [T]);
  });
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('the list names the course or track and what was actually paid, and says a history exists without sending it', { skip }, async () => {
  const rows = await list();
  const one = rows.find(row => row.id === 'rr-rl-1');
  const two = rows.find(row => row.id === 'rr-rl-2');
  assert.equal(one.course_title, 'دبلومة الإرشاد', 'the course of its payment');
  assert.equal(two.course_title, 'مسار العلاج', 'a track named by the request, when no payment is');
  assert.equal(Number(one.paid_total), 1500, 'paid and not deleted: 1,000 + 500; not the pending 900 or the deleted 800');
  assert.equal(one.has_ticket_history, true);
  assert.equal(two.has_ticket_history, false);
  assert.ok(!('ticket_history' in one), 'the history itself is fetched when someone opens it');
  assert.equal(one.contacts_count, 1);
  assert.equal(one.last_contact.notes, 'اتصلت بيها', 'the last contact since it was asked for');
});

test('a branch accountant sees their branch only; customer service reads; anyone else is refused', { skip }, async () => {
  assert.deepEqual((await list(BRANCH_ACC)).map(row => row.id), ['rr-rl-2']);
  assert.equal((await list(CS)).length, 2, 'manage_inbox is enough to read');
  assert.equal((await call('get', '/api/admin/finance/refunds', { staff: NOBODY })).statusCode, 403);
});

test('escalating adds a note and who did it and tells management; blaming a colleague is deliberate; deleting archives', { skip }, async () => {
  const note = await call('post', '/api/admin/finance/refunds/:id/escalate', { id: 'rr-rl-1', body: { note: 'العميلة مصرّة' }, staff: CS });
  assert.equal(note.statusCode, 200, JSON.stringify(note.body));
  const [[row]] = await pool.query("SELECT admin_note, escalated_by, escalated_at FROM refund_requests WHERE id='rr-rl-1'");
  assert.match(row.admin_note, /رفع للإدارة العليا: العميلة مصرّة/);
  assert.equal(row.escalated_by, 'st-rl-cs');
  assert.ok(row.escalated_at);
  assert.equal((await pool.query("SELECT id FROM notifications WHERE tenant_id=? AND type='refund'", [T]))[0].length, 1, 'management is told');
  assert.equal((await call('post', '/api/admin/finance/refunds/:id/escalate', { id: 'rr-nobody', staff: CS })).statusCode, 404);

  const blame = body => call('post', '/api/admin/finance/refunds/:id/blame', { id: 'rr-rl-1', body });
  assert.equal((await blame({ staff_id: 'st-rl-nobody' })).statusCode, 404, 'a colleague who does not exist');
  assert.equal((await blame({ staff_id: 'st-rl-blamed', note: 'وعدت بما لا يُقدَّم' })).statusCode, 200);
  assert.equal((await pool.query("SELECT blamed_staff_id FROM refund_requests WHERE id='rr-rl-1'"))[0][0].blamed_staff_id, 'st-rl-blamed');
  assert.equal((await list()).find(entry => entry.id === 'rr-rl-1').blamed_staff_name, 'الموظف المسؤول');
  assert.equal((await blame({})).statusCode, 200, 'an empty one clears it');
  assert.equal((await pool.query("SELECT blamed_staff_id FROM refund_requests WHERE id='rr-rl-1'"))[0][0].blamed_staff_id, null);

  assert.equal((await call('delete', '/api/admin/finance/refunds/:id', { id: 'rr-rl-2' })).statusCode, 200);
  assert.ok(!(await list()).some(entry => entry.id === 'rr-rl-2'), 'off the list');
  assert.ok((await pool.query("SELECT deleted_at FROM refund_requests WHERE id='rr-rl-2'"))[0][0].deleted_at, 'but kept');
  assert.equal((await call('delete', '/api/admin/finance/refunds/:id', { id: 'rr-rl-2' })).statusCode, 404);
});
