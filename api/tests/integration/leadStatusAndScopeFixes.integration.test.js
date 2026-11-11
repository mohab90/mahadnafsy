'use strict';
/**
 * Defects of the 11 Nov 2026 sales review, each against a real MariaDB:
 *   - the status «مش مهتم ومخفي» hides the lead wherever it is set, because transitionLead does it;
 *   - «أداء الموظفين» counts a lead marked «won» as converted, like every report;
 *   - enrolling a CLIENT in a sequence needs the client to be inside the caller's scope;
 *   - the team report shows one row to anyone whose data scope is their own leads — whatever the role is called.
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
const T = 'tenant-lead-fixes-it';
let pool;

async function call(router, method, path, { params = {}, body = {}, query = {}, staff = null } = {}) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `no ${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({
    method: method.toUpperCase(), params, query, body, headers: {}, tenantId: T, user: { uid: 'u-fixes', email: 'fixes@lead-it.test' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}
async function clean() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for (const table of ['drip_enrollments', 'drip_sequences', 'lead_timeline', 'communications', 'payments', 'subscribers', 'leads', 'staff', 'activity_logs']) {
      await conn.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
    }
  } finally { conn.release(); }
}
const lead = (id, fields = {}) => {
  const row = { name: id, phone: null, source: 'test', status: 'new', hidden: 0, ...fields };
  const columns = Object.keys(row);
  return pool.query(`INSERT INTO leads (id, tenant_id, ${columns.join(', ')}) VALUES (?, ?, ${columns.map(() => '?').join(', ')})`, [id, T, ...columns.map(c => row[c])]);
};
const asRep = (id, role = 'sales', scope = null) => ({ id, role, data_scope: scope, permissions_json: '[]' });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  for (const id of ['lf-rep-a', 'lf-rep-b', 'lf-support']) {
    await pool.query(
      `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?,?,?,?,?, 'sales', 1, '2026-01-01')`,
      [id, T, id, `${id}@lead-it.test`, `0109310${String(Math.floor(Math.random() * 9000) + 1000)}`]);
  }
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); setTimeout(() => process.exit(), 300).unref(); } });

test('the status «مش مهتم ومخفي» hides the lead whichever path sets it — and again if it shows', { skip }, async () => {
  const { transitionLead } = require('../../lib/leadState');
  await lead('lf-h1', { phone: '1019400001', status: 'interested' });
  await transitionLead({ tenantId: T, leadId: 'lf-h1', toStatus: 'not_interested_hidden', actor: 'bulk-edit' });
  const row = async id => (await pool.query('SELECT status, hidden FROM leads WHERE tenant_id=? AND id=?', [T, id]))[0][0];
  assert.deepEqual({ ...(await row('lf-h1')) }, { status: 'not_interested_hidden', hidden: 1 });
  // Someone unhid it with the status unchanged: asking for the status again hides it again.
  await pool.query("UPDATE leads SET hidden=0 WHERE tenant_id=? AND id='lf-h1'", [T]);
  await transitionLead({ tenantId: T, leadId: 'lf-h1', toStatus: 'not_interested_hidden', actor: 'bulk-edit' });
  assert.equal((await row('lf-h1')).hidden, 1);
  // A plain «مش مهتم» does not hide.
  await lead('lf-h2', { phone: '1019400002', status: 'interested' });
  await transitionLead({ tenantId: T, leadId: 'lf-h2', toStatus: 'not_interested', actor: 'x' });
  assert.deepEqual({ ...(await row('lf-h2')) }, { status: 'not_interested', hidden: 0 });
  // The CRM interaction route no longer carries the rule itself, and still hides.
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('lf-admin', ?, 'a', 'lf-admin@lead-it.test', '1019400900', 'ADMIN', 1, '2026-01-01')", [T]);
  await lead('lf-h3', { phone: '1019400003', status: 'contacted', assigned_sales_id: 'lf-rep-a' });
  const advanced = require('../../routes/crm-advanced');
  const res = await call(advanced, 'post', '/api/admin/crm/leads/:id/interactions',
    { params: { id: 'lf-h3' }, body: { type: 'call', notes: 'رفض', newStatus: 'not_interested_hidden' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual({ ...(await row('lf-h3')) }, { status: 'not_interested_hidden', hidden: 1 });
});

test('«أداء الموظفين» counts a lead marked «won» as converted', { skip }, async () => {
  await lead('lf-w1', { phone: '1019400011', status: 'won', assigned_sales_id: 'lf-rep-b' });
  await lead('lf-w2', { phone: '1019400012', status: 'converted', assigned_sales_id: 'lf-rep-b' });
  await lead('lf-w3', { phone: '1019400013', status: 'closed', assigned_sales_id: 'lf-rep-b' });
  const res = await call(require('../../routes/admin/leads/insights'), 'get', '/api/admin/leads/staff-performance', { query: {} });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.byStaff['lf-rep-b'].converted, 2, 'won + converted; closed is not a sale');
  assert.equal(res.body.byStaff['lf-rep-b'].contacted, 2, 'and both count as having been reached');
});

test('a client is enrolled in a sequence only by someone whose scope holds that client', { skip }, async () => {
  const router = require('../../routes/crm-sequences');
  await pool.query("INSERT INTO drip_sequences (id, tenant_id, name, steps) VALUES ('lf-seq', ?, 's', ?)", [T, JSON.stringify([{ delay_days: 0, subject: 's', body_html: '<p>b</p>' }])]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, email, assigned_sales_id) VALUES ('lf-sub-b', ?, 'LF1', 'عميل أحمد', '1019400021', 'b@lead-it.test', 'lf-rep-b')", [T]);
  const enroll = staff => call(router, 'post', '/api/admin/crm/sequences/:id/enroll', { params: { id: 'lf-seq' }, body: { subscriber_id: 'lf-sub-b' }, staff });
  const stranger = await enroll(asRep('lf-rep-a'));
  assert.equal(stranger.statusCode, 404, 'another rep\'s client does not exist for her');
  assert.equal((await pool.query("SELECT COUNT(*) AS n FROM drip_enrollments WHERE tenant_id=?", [T]))[0][0].n, 0);
  const own = await enroll(asRep('lf-rep-b'));
  assert.equal(own.statusCode, 201, JSON.stringify(own.body));
  await pool.query('DELETE FROM drip_enrollments WHERE tenant_id=?', [T]);
  assert.equal((await enroll(null)).statusCode, 201, 'the owner enrols any client');
});

test('the team report shows one row to whoever sees only their own leads, by data scope and not by role name', { skip }, async () => {
  const router = require('../../routes/crm-advanced');
  const report = staff => call(router, 'get', '/api/admin/crm/team-report', { staff });
  const everyone = (await report(null)).body.reps.map(rep => rep.id);
  assert.ok(everyone.includes('lf-rep-a') && everyone.includes('lf-rep-b'), `the manager sees the team: ${everyone}`);
  // A role that is not called «sales» but whose scope is its own leads: one row, hers.
  const support = (await report(asRep('lf-support', 'support', 'assigned_sales'))).body.reps.map(rep => rep.id);
  assert.deepEqual(support.filter(id => id !== 'lf-support'), [], 'no colleague\'s row');
  const rep = (await report(asRep('lf-rep-a'))).body.reps.map(row => row.id);
  assert.deepEqual(rep, ['lf-rep-a']);
  const nothing = (await report(asRep('lf-support', 'support', 'none'))).body;
  assert.deepEqual(nothing.reps.map(row => row.id).filter(id => id !== 'lf-support'), [], 'a scope of nothing sees no colleague');
  const received = await call(router, 'get', '/api/admin/crm/team-report/received', { query: { rep: 'lf-rep-b' }, staff: asRep('lf-rep-a') });
  assert.equal(received.statusCode, 200);
  assert.deepEqual(received.body.rows, [], 'asking for a colleague returns her own (none), not the colleague\'s');
});
