'use strict';
/**
 * Turning a lead into a client and handing leads out, on a real MariaDB (these were regular expressions over routes/admin/leads/convert.js and assignment.js —
 * `LEAD_NOT_FOUND`, `COURSE_NOT_FOUND`, `COLLECTION_BOOKING_REQUIRED`, `LIMIT 1 FOR UPDATE`, `transitionLead … converted`, `bulk-assign … logLeadEventStrict`; the state
 * rules themselves are in leadStateAndMerge): a lead is converted only within the caller's own leads, never by a collection officer (that is a booking), and only to a
 * course that exists; the conversion makes one client linked to the lead (no email needed), marks the lead converted with its timeline, opens no course by itself,
 * and converting again, or a number the client already holds under another spelling, answers with the same client; a bulk distribution is not for reps, hands only
 * open, unassigned, visible leads to the active sales reps, writes an event for each, and changes nothing when there is nobody to hand them to. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-leadconv-it';
let pool; let convert; let assignment;

const staff = (id, role, permissions) => ({ id, name: id, role, permissions_json: JSON.stringify(permissions) });
const MANAGER = staff('st-lc-mgr', 'manager', ['manage_leads', 'view_leads']);
const REP = staff('st-lc-rep1', 'sales', ['manage_leads', 'view_leads']);
const COLLECTOR = staff('st-lc-col', 'collection', ['manage_leads', 'view_leads']);

async function call(router, method, path, { params = {}, body = {}, who = MANAGER } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'mgr-lc@example.test', tenant_id: T }, staffRecord: who, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  const skipNames = ['requireAuth', 'requireAdminOrStaff', 'bulkOperationLimiter'];
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !skipNames.includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const convertLead = (id, body = {}, who) => call(convert, 'post', '/api/admin/leads/:id/convert', { params: { id }, body, who });
const leadRow = async id => (await pool.query('SELECT status, assigned_sales_id FROM leads WHERE id=?', [id]))[0][0];
const clients = async leadId => (await pool.query('SELECT id, lead_id, email, phone FROM subscribers WHERE tenant_id=? AND lead_id=?', [T, leadId]))[0];

async function clean() {
  for (const table of ['activity_logs', 'lead_timeline', 'enrollments', 'subscribers', 'users', 'crm_assignment_members', 'leads', 'courses', 'staff']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  convert = require('../../routes/admin/leads/convert');
  assignment = require('../../routes/admin/leads/assignment');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-lc-mgr', ?, 'المدير', 'mgr-lc@example.test', '1019900001', 'MANAGER', 1, '2025-01-01'),
       ('st-lc-rep1', ?, 'مندوبة ١', 'rep1-lc@example.test', '1019900002', 'SALES', 1, '2025-01-01'),
       ('st-lc-rep2', ?, 'مندوب ٢', 'rep2-lc@example.test', '1019900003', 'SALES', 1, '2025-01-01'),
       ('st-lc-col', ?, 'التحصيل', 'col-lc@example.test', '1019900004', 'COLLECTION', 1, '2025-01-01')`, [T, T, T, T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES ('co-lc-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 1000)`, [T]);
  const lead = (id, name, phone, extra = {}) => pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, email, source, status, hidden, assigned_sales_id, assigned_sales_name, branch)
     VALUES (?, ?, ?, ?, ?, 'test', ?, ?, ?, ?, 'ONLINE_EGYPT')`,
    [id, T, name, phone, extra.email ?? null, extra.status || 'new', extra.hidden ? 1 : 0, extra.sales ?? null, extra.sales ? 'مندوبة ١' : null]);
  await lead('ld-lc-own', 'ليد المندوبة', '01019910001', { sales: 'st-lc-rep1' });
  await lead('ld-lc-other', 'ليد المندوب الآخر', '01019910002', { sales: 'st-lc-rep2' });
  await lead('ld-lc-free', 'ليد حر', '01019910003');
  await lead('ld-lc-hidden', 'ليد مخفي', '01019910004', { hidden: true });
  await lead('ld-lc-spelling', 'ليد برقم موجود', '+20 101 991 0005');
  await lead('ld-lc-blank', ' ', '01019910006');
  await lead('ld-lc-cs', 'ليد التحصيل', '01019910007');
  await pool.query("UPDATE leads SET assigned_cs_id='st-lc-col', assigned_cs_name='التحصيل' WHERE id='ld-lc-cs'");
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES ('sub-lc-holder', ?, 'صاحبة الرقم', '1019910005', 'ONLINE_EGYPT', 'branch-online-egypt')", [T]);
  // for the distribution: open and unassigned, converted, lost, and already handed
  await lead('ld-ba-1', 'توزيع ١', '01019920001');
  await lead('ld-ba-2', 'توزيع ٢', '01019920002', { status: 'interested' });
  await lead('ld-ba-conv', 'محوّل', '01019920003', { status: 'converted' });
  await lead('ld-ba-lost', 'خسرنا', '01019920004', { status: 'lost' });
  await lead('ld-ba-hidden', 'مخفي', '01019920005', { hidden: true });
  await lead('ld-ba-held', 'عند مندوبة', '01019920006', { sales: 'st-lc-rep1' });
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a lead is converted only within the caller\'s leads, never by a collection officer, and only to a course that exists', { skip }, async () => {
  assert.equal((await convertLead('ld-lc-nobody')).body.code, 'LEAD_NOT_FOUND');
  assert.equal((await convertLead('ld-lc-hidden')).body.code, 'LEAD_NOT_FOUND', 'a hidden lead is not there');
  const foreign = await convertLead('ld-lc-other', {}, REP);
  assert.equal(foreign.statusCode, 403, 'a rep converts their own leads');
  assert.equal((await leadRow('ld-lc-other')).status, 'new');
  const collector = await convertLead('ld-lc-cs', {}, COLLECTOR);
  assert.equal(collector.statusCode, 403);
  assert.equal((await leadRow('ld-lc-cs')).status, 'new');
  assert.equal(collector.body.code, 'COLLECTION_BOOKING_REQUIRED', 'that is a booking, which goes to review');
  assert.equal((await convertLead('ld-lc-free', { courseId: 'co-nope' })).body.code, 'COURSE_NOT_FOUND');
  assert.equal((await convertLead('ld-lc-blank')).statusCode, 400, 'a name is needed');
  assert.equal((await clients('ld-lc-free')).length, 0, 'nothing was made by the refusals');
});

test('the conversion makes one client linked to the lead, needs no email, opens no course, and a second conversion answers with the same client', { skip }, async () => {
  const done = await convertLead('ld-lc-own', { courseId: 'co-lc-1' }, REP);
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.ok(done.body.subscriber_id);
  const [client] = await clients('ld-lc-own');
  assert.equal(client.id, done.body.subscriber_id);
  assert.equal(client.email, null, 'a phone-only client');
  assert.equal(client.phone, '1019910001', 'stored as the identity');
  assert.equal((await leadRow('ld-lc-own')).status, 'converted');
  assert.equal((await pool.query('SELECT id FROM enrollments WHERE tenant_id=? AND subscriber_id=?', [T, client.id]))[0].length, 0, 'choosing a course is intent, not access');
  const [events] = await pool.query("SELECT event_type FROM lead_timeline WHERE tenant_id=? AND lead_id='ld-lc-own'", [T]);
  assert.ok(events.some(item => item.event_type === 'converted'), 'the timeline says so');

  const again = await convertLead('ld-lc-own', {}, REP);
  assert.equal(again.statusCode, 200);
  assert.deepEqual([again.body.subscriber_id, again.body.already_existed], [client.id, true]);
  assert.equal((await clients('ld-lc-own')).length, 1, 'still one client');
});

test('a number the client already holds, under another spelling, is that client: the lead is converted onto them', { skip }, async () => {
  const done = await convertLead('ld-lc-spelling');
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.deepEqual([done.body.subscriber_id, done.body.already_existed], ['sub-lc-holder', true]);
  assert.equal((await leadRow('ld-lc-spelling')).status, 'converted');
  assert.equal((await pool.query("SELECT lead_id FROM subscribers WHERE id='sub-lc-holder'"))[0][0].lead_id, 'ld-lc-spelling');
});

test('a bulk distribution is not for reps, hands only open unassigned visible leads to the active reps with an event each, and changes nothing without reps', { skip }, async () => {
  const bulk = who => call(assignment, 'post', '/api/admin/leads/bulk-assign', { who });
  assert.equal((await bulk(REP)).statusCode, 403, 'reps do not distribute');
  await pool.query("UPDATE staff SET is_active=0 WHERE tenant_id=? AND role='SALES'", [T]);
  const nobody = await bulk(MANAGER);
  assert.equal(nobody.statusCode, 400, 'nobody to hand them to');
  assert.equal((await leadRow('ld-ba-1')).assigned_sales_id, null, 'and nothing moved');

  await pool.query("UPDATE staff SET is_active=1 WHERE tenant_id=? AND role='SALES'", [T]);
  const done = await bulk(MANAGER);
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  const handed = rows => rows.filter(item => item.assigned_sales_id).length;
  const [rowsAfter] = await pool.query("SELECT id, assigned_sales_id FROM leads WHERE tenant_id=? AND id LIKE 'ld-ba-%'", [T]);
  const byId = Object.fromEntries(rowsAfter.map(item => [item.id, item.assigned_sales_id]));
  assert.ok(byId['ld-ba-1'] && byId['ld-ba-2'], 'the open ones got a rep');
  assert.equal(byId['ld-ba-conv'], null, 'a converted lead is not handed out');
  assert.equal(byId['ld-ba-lost'], null, 'nor a lost one');
  assert.equal(byId['ld-ba-hidden'], null, 'nor a hidden one');
  assert.equal(byId['ld-ba-held'], 'st-lc-rep1', 'nor one that already has a rep');
  assert.ok(handed(rowsAfter) >= 3);
  const [events] = await pool.query("SELECT lead_id FROM lead_timeline WHERE tenant_id=? AND event_type='assigned' AND lead_id IN ('ld-ba-1','ld-ba-2')", [T]);
  assert.deepEqual(events.map(item => item.lead_id).sort(), ['ld-ba-1', 'ld-ba-2'], 'an event for each lead handed');
  assert.notEqual(byId['ld-ba-1'], byId['ld-ba-2'], 'two reps, two leads: one each');
});

test('a lead cannot be marked converted without a customer behind it, whichever caller asks', { skip }, async () => {
  const { transitionLead } = require('../../lib/leadState');
  await assert.rejects(
    transitionLead({ tenantId: T, leadId: 'ld-lc-free', toStatus: 'converted', actor: 'bulk-edit', db: pool }),
    error => error.statusCode === 409,
  );
  assert.equal((await leadRow('ld-lc-free')).status, 'new', 'it stays where it was');
  await assert.rejects(
    transitionLead({ tenantId: T, leadId: 'ld-lc-free', toStatus: 'converted', actor: 'x', db: pool, metadata: { subscriberId: 'sub-nobody' } }),
    error => error.statusCode === 409,
    'a claimed customer that does not exist is not one',
  );
  await transitionLead({ tenantId: T, leadId: 'ld-lc-free', toStatus: 'converted', actor: 'x', db: pool, metadata: { subscriberId: 'sub-lc-holder' } });
  assert.equal((await leadRow('ld-lc-free')).status, 'converted', 'with a real customer named it goes through');
});
