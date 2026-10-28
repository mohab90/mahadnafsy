'use strict';
/**
 * A branch's clients' problems go to the branch's own queue (lib/ticketBranchQueue.js):
 * a Dokki client's complaint is handed to Dokki's staff who hold the inbox, the
 * branch manager is told, the central team does not see it, and escalation still
 * takes it to the administration. Online clients, billing, and a branch with
 * nobody to open the ticket stay as they were.
 * Against a real MariaDB; runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-product-tickets-it';
let pool; let support;
const tickets = {};

const STAFF = {
  central: { id: 'st-pt-cs', role: 'support', permissions_json: '["manage_inbox"]', branch_id: 'branch-online-egypt', data_scope: null },
  dokki: { id: 'st-pt-dq', role: 'RECEPTION_DAQQI', permissions_json: '["manage_inbox"]', branch_id: 'branch-daqqi', data_scope: 'branch:DAQQI' },
  manager: { id: 'st-pt-mg', role: 'DAQQI_MANAGER', permissions_json: '["view_dashboard"]', branch_id: 'branch-daqqi', data_scope: 'branch:DAQQI' },
};

async function clean() {
  for (const table of ['ticket_events', 'support_tickets', 'notifications', 'subscribers', 'staff', 'contact_messages']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}
async function open(subscriberId, category) {
  const conn = await pool.getConnection();
  try {
    return await support.createRoutedTicket(conn, {
      tenantId: TENANT, subscriberId, name: 'عميل', subject: `مشكلة ${category}`, body: 'التفاصيل', category,
      channel: 'user_dashboard', actor: { id: null, name: 'عميل' },
    });
  } finally { conn.release(); }
}
const handler = (path, method) => support.stack.find(item => item.route?.path === path && item.route.methods[method]).route.stack.at(-1).handle;
async function call(path, method, { staff = null, query = {}, params = {}, body = {} } = {}) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler(path, method)({
    query, params, body, tenantId: TENANT, headers: {}, ip: '127.0.0.1', get: () => undefined,
    user: { uid: staff?.id || 'admin', email: 'x@example.test' },
    ...(staff ? { staffRecord: { ...staff, tenant_id: TENANT, name: staff.id } } : { isSuperAdmin: true }),
  }, res);
  return res;
}
const inbox = (staff, query = {}) => call('/api/admin/cs/inbox', 'get', { staff, query });
const ids = res => res.body.tickets.map(t => t.id);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  support = require('../../routes/support');
  for (const [n, s] of Object.values(STAFF).entries()) {
    await pool.query(
      `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, permissions_json, branch_id, data_scope)
       VALUES (?, ?, ?, ?, ?, ?, 1, '2025-01-01', ?, ?, ?)`,
      [s.id, TENANT, s.id, `${s.id}@example.test`, `101700000${n}`, s.role, s.permissions_json, s.branch_id, s.data_scope]);
  }
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch) VALUES
       ('sub-pt-dq', ?, 'عميلة الدقي', '1017100001', 'DAQQI'),
       ('sub-pt-on', ?, 'عميل أونلاين', '1017100002', 'ONLINE_EGYPT'),
       ('sub-pt-tg', ?, 'عميل التجمع', '1017100003', 'TAGAMOA')`, [TENANT, TENANT, TENANT]);
  tickets.dokkiComplaint = await open('sub-pt-dq', 'complaint');
  tickets.dokkiBilling = await open('sub-pt-dq', 'billing');
  tickets.online = await open('sub-pt-on', 'technical');
  tickets.tagamoa = await open('sub-pt-tg', 'course_access');
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a Dokki client\'s complaint goes to Dokki\'s queue and its staff, and the branch manager is told', { skip }, async () => {
  const t = tickets.dokkiComplaint;
  assert.deepEqual([t.department, t.assignee?.id, t.branch], ['daqqi', STAFF.dokki.id, 'DAQQI']);
  const [[row]] = await pool.query('SELECT department, branch, branch_id FROM support_tickets WHERE id=?', [t.id]);
  assert.deepEqual({ ...row }, { department: 'daqqi', branch: 'DAQQI', branch_id: 'branch-daqqi' });
  const [notes] = await pool.query("SELECT recipient_staff_id FROM notifications WHERE tenant_id=? AND type='ticket'", [TENANT]);
  assert.ok(notes.some(n => n.recipient_staff_id === STAFF.manager.id), 'the manager is notified');
});

test('online clients, billing, and a branch with nobody to take it stay as they were', { skip }, async () => {
  assert.deepEqual([tickets.online.department, tickets.online.assignee?.id, tickets.online.branch], ['support', STAFF.central.id, null]);
  assert.equal(tickets.dokkiBilling.department, 'collection', 'billing keeps its team');
  assert.deepEqual([tickets.tagamoa.department, tickets.tagamoa.assignee?.id], ['support', STAFF.central.id], 'Tagamoa has nobody with the inbox');
});

test('each queue sees its own: the branch its clients\', the central team not the branch\'s', { skip }, async () => {
  const central = await inbox(STAFF.central);
  assert.ok(ids(central).includes(tickets.online.id));
  assert.ok(!ids(central).includes(tickets.dokkiComplaint.id), 'not in the central queue');
  const dokki = await inbox(STAFF.dokki);
  assert.ok(ids(dokki).includes(tickets.dokkiComplaint.id));
  assert.ok(!ids(dokki).includes(tickets.online.id));
  const reply = await call('/api/admin/tickets/:id', 'get', { staff: STAFF.central, params: { id: tickets.dokkiComplaint.id } });
  assert.equal(reply.statusCode, 404, 'the central team cannot open the branch\'s ticket');
});

test('the management inbox filters by branch, and escalation goes to the administration as before', { skip }, async () => {
  const all = await inbox(null);
  assert.ok(ids(all).includes(tickets.dokkiComplaint.id), 'the branch queue is in the management view');
  const dokki = await inbox(null, { branch: 'DAQQI' });
  assert.deepEqual(new Set(ids(dokki)), new Set([tickets.dokkiComplaint.id, tickets.dokkiBilling.id]), 'every problem of a Dokki client');
  const central = await inbox(null, { branch: 'CENTRAL' });
  assert.ok(!ids(central).includes(tickets.dokkiComplaint.id));
  assert.ok(ids(central).includes(tickets.online.id));

  const escalated = await call('/api/admin/tickets/:id/escalate', 'post', { staff: STAFF.dokki, params: { id: tickets.dokkiComplaint.id }, body: { reason: 'العميلة زعلانة' } });
  assert.equal(escalated.statusCode, 200, JSON.stringify(escalated.body));
  const [[row]] = await pool.query('SELECT department FROM support_tickets WHERE id=?', [tickets.dokkiComplaint.id]);
  assert.equal(row.department, 'management');
});
