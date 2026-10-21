'use strict';
/**
 * The CRM against a real MariaDB (20 Oct 2026 review, L8 / L9 / L10 / follow-ups):
 *   - a lead's number is kept and compared by identity, so a client typed «+20 101…» is
 *     recognised, and «تحويل» links the lead to that same client instead of refusing;
 *   - a Facebook lead already closed or archived comes back to its rep, due today, and a
 *     client filling an ad goes to whoever looks after them, not into a new lead;
 *   - a ticket is never routed to someone on leave, and a reopened one is back on the clock;
 *   - a rep's «متابعات النهارده» is the same count everywhere.
 * Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-crm-it';
let pool;
let staffSeq = 0;

async function call(router, method, path, { params = {}, body = {}, query = {} } = {}) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({
    method: method.toUpperCase(), params, query, body, headers: {}, tenantId: TENANT, user: { uid: 'admin', email: 'admin@crm-it.test' },
    staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}

async function clean() {
  for (const table of ['lead_timeline', 'notifications', 'activity_logs', 'ticket_events', 'support_tickets', 'leaves', 'users', 'subscribers', 'leads', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]);
  }
}
const staff = (id, role, name = id) => pool.query(
  `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?,?,?,?,?,?,1,'2026-01-01')`,
  [id, TENANT, name, `${id}@crm-it.test`, `0109305${String(++staffSeq).padStart(4, '0')}`, role]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await staff('crm-rep-1', 'sales', 'رامي');
  await staff('crm-rep-2', 'sales', 'سارة');
  await staff('crm-cs-1', 'collection', 'منى');
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('a client typed «+20 101…» is not filed as a new lead, and a new lead is kept by identity', { skip }, async () => {
  const router = require('../../routes/admin/leads/write');
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('crm-sub-1', ?, 'عميلة', '1019990001')", [TENANT]);
  const taken = await call(router, 'post', '/api/admin/leads', { body: { name: 'نفس العميلة', phone: '+20 101 999 0001', source: 'test', skipAutoAssign: true } });
  assert.equal(taken.statusCode, 409, JSON.stringify(taken.body));
  assert.equal(taken.body.type, 'subscriber');
  assert.equal(taken.body.existingId, 'crm-sub-1');

  const created = await call(router, 'post', '/api/admin/leads', { body: { name: 'جديدة', phone: '+20 101 999 0002', source: 'test', skipAutoAssign: true } });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const [[row]] = await pool.query("SELECT phone FROM leads WHERE tenant_id=? AND name='جديدة'", [TENANT]);
  assert.equal(row.phone, '1019990002');
  // The same number in another spelling is the same lead.
  const again = await call(router, 'post', '/api/admin/leads', { body: { name: 'تاني', phone: '01019990002', source: 'test', skipAutoAssign: true } });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.type, 'lead');
});

test('a Saudi number stored with its code is found typed locally', { skip }, async () => {
  const { findLeadByIdentity } = require('../../lib/leadRepository');
  await pool.query("INSERT INTO leads (id, tenant_id, name, phone, source, status) VALUES ('crm-sa', ?, 'سعودي', '966501230001', 'test', 'new')", [TENANT]);
  assert.equal((await findLeadByIdentity({ tenantId: TENANT, phone: '0501230001' }))?.id, 'crm-sa');
  assert.equal((await findLeadByIdentity({ tenantId: TENANT, phone: '501230001' }))?.id, 'crm-sa');
});

test('«تحويل» of a lead whose number is its own client links the two instead of refusing', { skip }, async () => {
  const router = require('../../routes/admin/leads/convert');
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('crm-sub-3', ?, 'عميل', '1019990003')", [TENANT]);
  await pool.query("INSERT INTO leads (id, tenant_id, name, phone, source, status) VALUES ('crm-lead-3', ?, 'عميل', '+20 101 999 0003', 'test', 'interested')", [TENANT]);
  const res = await call(router, 'post', '/api/admin/leads/:id/convert', { params: { id: 'crm-lead-3' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.subscriber_id, 'crm-sub-3');
  assert.equal(res.body.already_existed, true);
  const [[sub]] = await pool.query("SELECT lead_id FROM subscribers WHERE id='crm-sub-3'");
  assert.equal(sub.lead_id, 'crm-lead-3');
  const [[lead]] = await pool.query("SELECT status FROM leads WHERE id='crm-lead-3'");
  assert.equal(lead.status, 'converted');

  // Somebody else on the number (another address on both): still refused, naming them.
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, email) VALUES ('crm-sub-4', ?, 'أخوها', '1019990004', 'brother@crm-it.test')", [TENANT]);
  await pool.query("INSERT INTO leads (id, tenant_id, name, phone, email, source, status) VALUES ('crm-lead-4', ?, 'أخته', '01019990004', 'sister@crm-it.test', 'test', 'new')", [TENANT]);
  const refused = await call(router, 'post', '/api/admin/leads/:id/convert', { params: { id: 'crm-lead-4' } });
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'PHONE_IN_USE');
});

const fbEvent = (leadgenId, phone) => ({
  event: { id: `evt-${leadgenId}`, tenant_id: TENANT },
  payload: { entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: 'page-1', form_id: 'form-1' } }] }] },
  deps: {
    getConfig: async () => ({ pageAccessToken: 'token' }),
    fetchDetails: async () => ({ field_data: [{ name: 'full_name', values: ['زائرة'] }, { name: 'phone_number', values: [phone] }] }),
    assignSales: async () => ({ id: 'crm-rep-2', name: 'سارة' }),
  },
});

test('a Facebook lead closed «مش مهتم» and archived comes back to its rep, due today, and the rep is told', { skip }, async () => {
  const { processFacebookLeadEvent } = require('../../lib/facebookLeadEvents');
  const { cairoToday } = require('../../lib/dates');
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, assigned_sales_id, assigned_sales_name)
     VALUES ('crm-fb-old', ?, 'زائرة', '1019990005', 'facebook', 'not_interested', 1, 'crm-rep-1', 'رامي')`, [TENANT]);
  const { event, payload, deps } = fbEvent('9001', '+201019990005');
  const result = await processFacebookLeadEvent({ event, payload }, deps);
  assert.equal(result.imported, 0);
  const [rows] = await pool.query("SELECT id, status, hidden, assigned_sales_id, DATE_FORMAT(next_follow_up_date,'%Y-%m-%d') AS due FROM leads WHERE tenant_id=? AND (phone LIKE '%1019990005')", [TENANT]);
  assert.equal(rows.length, 1, 'no second lead');
  assert.deepEqual({ ...rows[0] }, { id: 'crm-fb-old', status: 'new', hidden: 0, assigned_sales_id: 'crm-rep-1', due: cairoToday() });
  const [[notice]] = await pool.query("SELECT type, recipient_staff_id FROM notifications WHERE tenant_id=? AND data_json LIKE '%crm-fb-old%'", [TENANT]);
  assert.deepEqual({ ...notice }, { type: 'lead', recipient_staff_id: 'crm-rep-1' });
});

test('a client filling a Facebook ad goes to whoever looks after them, not into a new lead', { skip }, async () => {
  const { processFacebookLeadEvent } = require('../../lib/facebookLeadEvents');
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, assigned_cs_id) VALUES ('crm-sub-6', ?, 'عميلة', '1019990006', 'crm-cs-1')", [TENANT]);
  const { event, payload, deps } = fbEvent('9002', '01019990006');
  await processFacebookLeadEvent({ event, payload }, deps);
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM leads WHERE tenant_id=? AND phone LIKE '%1019990006'", [TENANT]);
  assert.equal(Number(n), 0);
  const [[notice]] = await pool.query("SELECT type, recipient_staff_id FROM notifications WHERE tenant_id=? AND data_json LIKE '%crm-sub-6%'", [TENANT]);
  assert.deepEqual({ ...notice }, { type: 'subscriber', recipient_staff_id: 'crm-cs-1' });
});

test('a ticket is never routed to an agent on an approved day off', { skip }, async () => {
  const { pickAssignee } = require('../../lib/ticketRouting');
  const { cairoToday, addDaysToDateOnly } = require('../../lib/dates');
  const today = cairoToday();
  await staff('crm-sup-a', 'support', 'أ');
  await staff('crm-sup-b', 'support', 'ب');
  // A has never had a ticket, so in turn A is first — but A is on leave today.
  await pool.query(
    `INSERT INTO leaves (id, tenant_id, staff_id, type, start_date, end_date, total_days, status)
     VALUES ('crm-leave-1', ?, 'crm-sup-a', 'ANNUAL', ?, ?, 2, 'APPROVED')`, [TENANT, addDaysToDateOnly(today, -1), today]);
  await pool.query(
    `INSERT INTO support_tickets (id, tenant_id, ticket_code, subject, status, department, assigned_to, created_at)
     VALUES ('crm-t-0', ?, 'CRM-IT-0', 'قديمة', 'closed', 'support', 'crm-sup-b', NOW() - INTERVAL 1 DAY)`, [TENANT]);
  assert.equal((await pickAssignee(pool, TENANT, 'support', { today }))?.id, 'crm-sup-b');
  // Back tomorrow, A is in turn again.
  assert.equal((await pickAssignee(pool, TENANT, 'support', { today: addDaysToDateOnly(today, 1) }))?.id, 'crm-sup-a');
});

test('a reopened ticket loses its old resolution and is back on the clock', { skip }, async () => {
  const { reopenTicketSql } = require('../../lib/ticketRouting');
  await pool.query(
    `INSERT INTO support_tickets (id, tenant_id, ticket_code, subject, status, department, priority, created_at,
                                 first_response_at, resolved_at, sla_due_at, sla_breach_notified_at)
     VALUES ('crm-t-1', ?, 'CRM-IT-1', 'رجعت', 'resolved', 'support', 'high', NOW() - INTERVAL 3 DAY,
             NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 2 DAY, NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY)`, [TENANT]);
  await pool.query(
    `UPDATE support_tickets SET ${reopenTicketSql()}, status=IF(status IN ('resolved','closed'),'open',status), updated_at=NOW()
      WHERE id='crm-t-1' AND tenant_id=?`, [TENANT]);
  const [[t]] = await pool.query(
    `SELECT status, resolved_at, first_response_at, sla_breach_notified_at,
            TIMESTAMPDIFF(MINUTE, NOW(), sla_due_at) AS minutes_left FROM support_tickets WHERE id='crm-t-1'`);
  assert.equal(t.status, 'open');
  assert.equal(t.resolved_at, null);
  assert.equal(t.first_response_at, null);
  assert.equal(t.sla_breach_notified_at, null);
  assert.ok(t.minutes_left > 3 * 60 && t.minutes_left <= 4 * 60, `high priority: four hours from now, got ${t.minutes_left} min`);

  // The status route's form: the reopening terms, then its own resolved_at term.
  await pool.query("UPDATE support_tickets SET status='closed', resolved_at=NOW() WHERE id='crm-t-1'");
  await pool.query(
    `UPDATE support_tickets SET ${reopenTicketSql('TRUE')}, status=?, closed_reason=?,
            resolved_at = IF(? IN ('resolved','closed'), COALESCE(resolved_at, NOW()), resolved_at), updated_at = NOW()
      WHERE id='crm-t-1' AND tenant_id=?`, ['in_progress', null, 'in_progress', TENANT]);
  const [[again]] = await pool.query("SELECT status, resolved_at FROM support_tickets WHERE id='crm-t-1'");
  assert.deepEqual({ ...again }, { status: 'in_progress', resolved_at: null });
});

test('a rep\'s follow-ups today are one count: archived and closed out, a crm_json date in', { skip }, async () => {
  const router = require('../../routes/admin/leads/insights');
  const { cairoToday } = require('../../lib/dates');
  const today = cairoToday();
  const lead = (id, status, hidden, column, json) => pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, assigned_sales_id, next_follow_up_date, crm_json)
     VALUES (?, ?, ?, NULL, 'test', ?, ?, 'crm-rep-2', ?, ?)`,
    [id, TENANT, id, status, hidden, column, json ? JSON.stringify({ nextFollowUpDate: json }) : null]);
  await lead('crm-fu-1', 'contacted', 0, today, null);
  await lead('crm-fu-2', 'new', 0, null, today);
  await lead('crm-fu-3', 'new', 1, today, null);
  await lead('crm-fu-4', 'lost', 0, today, null);
  const res = await call(router, 'get', '/api/admin/leads/staff-performance');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.byStaff['crm-rep-2'].followUpsToday, 2);
});
