'use strict';
/**
 * The sales / CRM audit of 11 Nov 2026, against a real MariaDB — each case is a defect that unit stubs cannot show, because the
 * fault is in what the database does with the statement (a unique key, a join that multiplies rows, a UTC boundary):
 *   - a quote's item count and order ids are not multiplied by each other;
 *   - a public form, a signup and «تحويل إلى ليد» meet a HIDDEN lead holding the number instead of failing on its unique key;
 *   - «تم» on a follow-up closes it every time, not only the first;
 *   - a sequence enrolment can be paused or ended only by someone who may see its lead;
 *   - the sales team's list carries the sales-and-collection managers the screen draws;
 *   - a lead's timeline is read inside the caller's own scope, for every scoped role;
 *   - «أداء الموظفين» counts the leads of a month's first hours (Cairo) in that month;
 *   - 'won' needs a customer, like 'converted';
 *   - «التسجيلات» asks for its accounts' own numbers instead of reading every lead.
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
const TENANT = 'tenant-crm-audit-it';
let pool;

/** Runs a route's own handler (the guards have their own tests) as the owner, or as the staff row given. */
async function call(router, method, path, { params = {}, body = {}, query = {}, staff = null } = {}) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `no ${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({
    method: method.toUpperCase(), params, query, body, headers: {}, tenantId: TENANT,
    user: { uid: 'u-audit', email: 'audit@crm-it.test' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}

async function clean() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for (const table of ['crm_quote_orders', 'crm_quote_items', 'crm_quotes', 'drip_enrollments', 'drip_sequences', 'communications', 'lead_timeline',
      'users', 'subscribers', 'leads', 'staff', 'activity_logs', 'notifications']) {
      await conn.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
    }
  } finally { conn.release(); }
}
const staff = (id, role) => pool.query(
  `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?,?,?,?,?,?,1,'2026-01-01')`,
  [id, TENANT, id, `${id}@crm-it.test`, `0109306${String(Math.floor(Math.random() * 9000) + 1000)}`, role]);
const lead = (id, fields = {}) => {
  const row = { name: id, phone: null, source: 'test', status: 'new', hidden: 0, ...fields };
  const columns = Object.keys(row);
  return pool.query(`INSERT INTO leads (id, tenant_id, ${columns.join(', ')}) VALUES (?, ?, ${columns.map(() => '?').join(', ')})`, [id, TENANT, ...columns.map(c => row[c])]);
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await staff('au-rep-a', 'sales');
  await staff('au-rep-b', 'sales');
  await staff('au-col', 'collection');
  await staff('au-scm', 'sales_collection_manager');
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); setTimeout(() => process.exit(), 300).unref(); } });

test('a converted quote shows its real item count and each order id once', { skip }, async () => {
  const router = require('../../routes/crm-quotes');
  await lead('au-q-lead', { phone: '1019990201' });
  await pool.query("INSERT INTO crm_quotes (id, tenant_id, quote_number, lead_id, valid_until, status, created_by) VALUES ('au-q1', ?, 'Q-AU-1', 'au-q-lead', '2027-01-01', 'converted', 'au')", [TENANT]);
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for (const n of [1, 2, 3]) {
      await conn.query(
        `INSERT INTO crm_quote_items (id, tenant_id, quote_id, item_type, item_id, description, quantity, unit_price, line_subtotal, catalog_snapshot, sort_order)
         VALUES (?, ?, 'au-q1', 'course', ?, 'c', 1, 100, 100, '{}', ?)`, [`au-qi-${n}`, TENANT, `c${n}`, n]);
      await conn.query('INSERT INTO crm_quote_orders (tenant_id, quote_id, quote_item_id, order_id) VALUES (?, ?, ?, ?)', [TENANT, 'au-q1', `au-qi-${n}`, `au-ord-${n}`]);
    }
  } finally { conn.release(); }
  const res = await call(router, 'get', '/api/admin/crm/quotes');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const quote = res.body.find(row => row.id === 'au-q1');
  assert.equal(Number(quote.item_count), 3, 'three items, not three items times three orders');
  assert.equal(String(quote.order_ids).split(',').length, 3, `each order once: ${quote.order_ids}`);
});

test('a public form for the number of a hidden lead adds to that lead instead of failing on the number\'s unique key', { skip }, async () => {
  const { capturePublicLead } = require('../../lib/publicLead');
  await lead('au-hidden-1', { phone: '1019990101', hidden: 1, notes: 'old', assigned_sales_id: 'au-rep-a' });
  const result = await capturePublicLead({ tenantId: TENANT, name: 'زائرة', phone: '01019990101', notes: 'عايزة تفاصيل', source: 'site', branch: 'ONLINE_EGYPT' });
  assert.deepEqual([result.id, result.existing], ['au-hidden-1', true]);
  const [[row]] = await pool.query("SELECT notes, hidden, (SELECT COUNT(*) FROM leads WHERE tenant_id=? AND phone='1019990101') AS n FROM leads WHERE tenant_id=? AND id='au-hidden-1'", [TENANT, TENANT]);
  assert.equal(Number(row.n), 1, 'no second row for the number');
  assert.match(row.notes, /old\nعايزة تفاصيل/, 'the form\'s words are appended to the lead');
  assert.equal(Number(row.hidden), 0, 'the person is interested again, so the lead is back (owner, 11 Nov; leadReturningFromHidden has the full rule)');
});

test('a signup, and «تحويل إلى ليد», find the hidden lead that already holds the number', { skip }, async () => {
  const { ensureLeadForUser } = require('../../lib/registrationLead');
  await lead('au-hidden-2', { phone: '1019990102', hidden: 1, assigned_sales_id: 'au-rep-a' });
  const conn = await pool.getConnection();
  try {
    const outcome = await ensureLeadForUser(conn, { tenantId: TENANT, user: { id: 'u-x', name: 'مسجلة', phone: '01019990102' } });
    assert.deepEqual([outcome.created, outcome.leadId, outcome.reason, outcome.reopened], [false, 'au-hidden-2', 'already a lead', true]);
  } finally { conn.release(); }
});

test('«تم» on a follow-up closes it every time it is pressed, not only the first', { skip }, async () => {
  const router = require('../../routes/crm-advanced');
  await lead('au-fu', { phone: '1019990301', status: 'contacted', assigned_sales_id: 'au-rep-a', next_follow_up_date: '2026-11-05' });
  const press = () => call(router, 'post', '/api/admin/crm/leads/:id/interactions',
    { params: { id: 'au-fu' }, body: { type: 'note', notes: '✅ تم إنجاز المتابعة', closeFollowUp: true } });
  const dateOf = async () => (await pool.query("SELECT next_follow_up_date AS d FROM leads WHERE tenant_id=? AND id='au-fu'", [TENANT]))[0][0].d;
  assert.equal((await press()).statusCode, 200);
  assert.equal(await dateOf(), null, 'the first press closes it');
  await pool.query("UPDATE leads SET next_follow_up_date='2026-11-06' WHERE tenant_id=? AND id='au-fu'", [TENANT]);
  assert.equal((await press()).statusCode, 200);
  assert.equal(await dateOf(), null, 'the second press, on a later follow-up, closes it too');
  const [[count]] = await pool.query("SELECT COUNT(*) AS n FROM communications WHERE tenant_id=? AND lead_id='au-fu'", [TENANT]);
  assert.equal(Number(count.n), 2, 'both contacts are on the lead');
});

test('a sequence enrolment is paused only by someone who may see its lead', { skip }, async () => {
  const router = require('../../routes/crm-sequences');
  await lead('au-seq-lead', { phone: '1019990401', assigned_sales_id: 'au-rep-a' });
  await pool.query("INSERT INTO drip_sequences (id, tenant_id, name, steps) VALUES ('au-seq', ?, 's', '[]')", [TENANT]);
  await pool.query("INSERT INTO drip_enrollments (id, tenant_id, sequence_id, lead_id, email, status) VALUES ('au-enr', ?, 'au-seq', 'au-seq-lead', 'x@y.test', 'active')", [TENANT]);
  const asRep = id => ({ id, role: 'sales', data_scope: null, permissions_json: '[]' });
  const other = await call(router, 'post', '/api/admin/crm/sequence-enrollments/:id/actions', { params: { id: 'au-enr' }, body: { action: 'pause' }, staff: asRep('au-rep-b') });
  assert.equal(other.statusCode, 404, 'a rep who does not hold the lead cannot touch its sequence');
  assert.equal((await pool.query("SELECT status FROM drip_enrollments WHERE id='au-enr'"))[0][0].status, 'active');
  const own = await call(router, 'post', '/api/admin/crm/sequence-enrollments/:id/actions', { params: { id: 'au-enr' }, body: { action: 'pause' }, staff: asRep('au-rep-a') });
  assert.equal(own.statusCode, 200, JSON.stringify(own.body));
  assert.equal((await pool.query("SELECT status FROM drip_enrollments WHERE id='au-enr'"))[0][0].status, 'paused');
});

test('the sales team report carries a sales-and-collection manager', { skip }, async () => {
  const router = require('../../routes/analytics/sales');
  const res = await call(router, 'get', '/api/admin/reports/sales-performance');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const ids = res.body.staff.map(row => row.id);
  assert.ok(ids.includes('au-scm'), `the team was ${ids.join(', ')}`);
  assert.ok(ids.includes('au-rep-a'));
});

test('a lead\'s timeline is read inside the caller\'s own scope, for a collection officer as for a rep', { skip }, async () => {
  const router = require('../../routes/admin/leads/convert');
  await lead('au-tl-mine', { phone: '1019990501', assigned_cs_id: 'au-col' });
  await lead('au-tl-other', { phone: '1019990502', assigned_sales_id: 'au-rep-a' });
  const officer = { id: 'au-col', role: 'collection', data_scope: null, permissions_json: '[]' };
  assert.equal((await call(router, 'get', '/api/admin/leads/:id/timeline', { params: { id: 'au-tl-mine' }, staff: officer })).statusCode, 200);
  assert.equal((await call(router, 'get', '/api/admin/leads/:id/timeline', { params: { id: 'au-tl-other' }, staff: officer })).statusCode, 403);
  assert.equal((await call(router, 'get', '/api/admin/leads/:id/timeline', { params: { id: 'au-tl-other' } })).statusCode, 200, 'the owner reads any');
});

test('«أداء الموظفين» counts a lead made at 00:30 Cairo on the 1st in that month', { skip }, async () => {
  const router = require('../../routes/admin/leads/insights');
  // 22:30 UTC on 31 Oct is 00:30 on 1 Nov in Cairo (UTC+2 since the clocks went back on 29 Oct 2026).
  await lead('au-perf-1', { phone: '1019990601', assigned_sales_id: 'au-rep-b', created_at: '2026-10-31 22:30:00' });
  await lead('au-perf-0', { phone: '1019990602', assigned_sales_id: 'au-rep-b', created_at: '2026-10-31 20:30:00' });
  const res = await call(router, 'get', '/api/admin/leads/staff-performance', { query: { from: '2026-11-01' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.byStaff['au-rep-b'].leads, 1, 'the 00:30 lead is November\'s, the 22:30 one (Cairo, 31 Oct) is not');
});

test('a lead cannot be marked «won» with no customer behind it, like «converted»', { skip }, async () => {
  const { transitionLead } = require('../../lib/leadState');
  await lead('au-won', { phone: '1019990701', status: 'interested' });
  for (const toStatus of ['won', 'converted']) {
    await assert.rejects(transitionLead({ tenantId: TENANT, leadId: 'au-won', toStatus }), error => error.statusCode === 409, toStatus);
  }
  assert.equal((await pool.query("SELECT status FROM leads WHERE tenant_id=? AND id='au-won'", [TENANT]))[0][0].status, 'interested');
});

test('«التسجيلات» drops the accounts a lead already holds — hidden ones too — without reading every lead', { skip }, async () => {
  const router = require('../../routes/registrations');
  const user = (id, email, phone) => pool.query(
    "INSERT INTO users (id, tenant_id, email, phone, name, role, is_active, password_hash) VALUES (?,?,?,?,?, 'user', 1, 'x')", [id, TENANT, email, phone, id]);
  await user('au-u1', 'u1@reg.test', '01019990801');
  await user('au-u2', 'u2@reg.test', null);
  await user('au-u3', 'u3@reg.test', '01019990803');
  await lead('au-reg-1', { phone: '01019990801', hidden: 1 });
  await lead('au-reg-2', { email: 'U2@reg.test', phone: '1019990802' });
  const seen = [];
  const original = pool.query.bind(pool);
  pool.query = (sql, ...rest) => { seen.push(String(sql)); return original(sql, ...rest); };
  let res;
  try { res = await call(router, 'get', '/api/admin/registrations'); } finally { pool.query = original; }
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.map(row => row.id), ['au-u3'], 'the account with a (hidden) lead by number and the one with a lead by email are claimed');
  const leadReads = seen.filter(sql => /FROM leads/i.test(sql));
  assert.ok(leadReads.length > 0 && leadReads.every(sql => /\bIN \(/i.test(sql)), `every read of leads is narrowed to the accounts' own identities: ${leadReads.join(' | ')}`);
});
