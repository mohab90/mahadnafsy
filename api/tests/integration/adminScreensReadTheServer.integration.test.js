'use strict';
/**
 * The figures the staff dashboard stopped computing out of lists it downloaded (21 Oct 2026), against a real MariaDB:
 *
 *   GET /api/admin/leads/rep-revenue      — each rep's clients' collected payments in a month («أداء المبيعات»),
 *                                           summed in the browser out of the 500 newest clients with their payments;
 *   GET /api/admin/leads/stats scoreBands — the open leads by score band, counted out of the page of leads held;
 *   GET /api/staff/subscribers?paged=1    — «العملاء الأونلاين» for the administration a page at a time, with the
 *                                           distribution panel's counts, instead of the whole client table.
 *
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
const TENANT = 'tenant-admin-it';
const REP = { id: 'adm-it-rep-1', role: 'sales', tenant_id: TENANT };
const OTHER = { id: 'adm-it-rep-2', role: 'sales', tenant_id: TENANT };
let pool, insightsRouter, statsRouter, staffListsRouter, month;

async function call(router, path, staff, query = {}) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods.get);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({
    params: {}, query, body: {}, headers: {}, tenantId: TENANT, user: { uid: staff?.id || 'admin' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}
const clean = async () => {
  for (const table of ['payments', 'subscribers', 'leads']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]);
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  insightsRouter = require('../../routes/admin/leads/insights');
  statsRouter = require('../../routes/admin/leads/stats');
  staffListsRouter = require('../../routes/admin/stafflists');
  month = new Date().toISOString().slice(0, 7);
  await clean();
  const sub = (id, rep, o = {}) => pool.query(
    'INSERT INTO subscribers (id, tenant_id, name, phone, branch, assigned_sales_id, assigned_cs_id, crm_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, TENANT, id, o.phone || null, o.branch || 'ONLINE_EGYPT', rep, o.cs || null, JSON.stringify(o.crm || {})]);
  const pay = (id, subId, amount, currency, status, when = 'NOW()') => pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, status, date) VALUES (?, ?, ?, ?, ?, ?, ${when})`,
    [id, TENANT, subId, amount, currency, status]);
  await sub('adm-it-s1', REP.id, { cs: 'adm-it-cs-1' });
  await sub('adm-it-s2', REP.id);
  await sub('adm-it-s3', OTHER.id, { crm: { clientStatus: 'old_intl' } });
  await sub('adm-it-dokki', REP.id, { branch: 'DAQQI' });
  await pay('adm-it-p1', 'adm-it-s1', 500, 'EGP', 'paid');
  await pay('adm-it-p2', 'adm-it-s1', 100, 'SAR', 'paid'); // 1,300 at the fallback rate the screen used
  await pay('adm-it-p3', 'adm-it-s2', 200, 'EGP', 'pending'); // not collected
  await pay('adm-it-p4', 'adm-it-s2', 300, 'EGP', 'paid', 'NOW() - INTERVAL 70 DAY'); // another month
  await pay('adm-it-p5', 'adm-it-s3', 50, 'USD', 'paid'); // 2,400
  const lead = (id, status, score, o = {}) => pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, score, hidden, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'test', ?, ?, ?, NOW(), NOW())`,
    [id, TENANT, id, `1017${id.replace(/\D/g, '').padStart(6, '0')}`, status, score, o.hidden ? 1 : 0]);
  await lead('adm-it-l1', 'new', 80);
  await lead('adm-it-l2', 'contacted', 55);
  await lead('adm-it-l3', 'new', 10);
  await lead('adm-it-l4', 'converted', 90); // closed: not an open lead
  await lead('adm-it-l5', 'new', 95, { hidden: true }); // archived
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('each rep\'s month revenue is their clients\' collected money, in pounds', { skip }, async () => {
  const res = await call(insightsRouter, '/api/admin/leads/rep-revenue', null, { month });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.month, month);
  assert.equal(res.body.byStaff[REP.id], 500 + 100 * 13, 'pending and other months are not counted');
  assert.equal(res.body.byStaff[OTHER.id], 50 * 48);
  // A rep is told their own figure only.
  const own = await call(insightsRouter, '/api/admin/leads/rep-revenue', REP, { month });
  assert.deepEqual(Object.keys(own.body.byStaff), [REP.id]);
  const bad = await call(insightsRouter, '/api/admin/leads/rep-revenue', null, { month: 'soon' });
  assert.equal(bad.statusCode, 400);
});

test('the open leads are counted by score band over the whole table', { skip }, async () => {
  const res = await call(statsRouter, '/api/admin/leads/stats', null);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.scoreBands, { high: 1, mid: 1, low: 1 }, 'converted and archived leads are left out');
});

test('the administration\'s online clients come a page at a time, with the distribution counts', { skip }, async () => {
  const page = await call(staffListsRouter, '/api/staff/subscribers', null, { paged: '1', view: 'active', limit: '1', offset: '0' });
  assert.equal(page.statusCode, 200);
  assert.equal(page.body.rows.length, 1, 'one page, not the table');
  assert.equal(page.body.total, 2, 'the online clients of the tenant, old data aside: the Dokki one is not on the online screen');
  assert.equal(page.body.unassignedMatching, 1);
  assert.deepEqual(page.body.assignedCounts, { 'adm-it-cs-1': 1 });
  // Paid in dollars: «دولي», old data or not — a foreign client lives in the tab of their market (the owner's tab rule of 29 Oct 2026).
  const old = await call(staffListsRouter, '/api/staff/subscribers', null, { paged: '1', view: 'real-intl', limit: '10', offset: '0' });
  assert.deepEqual(old.body.rows.map(row => row.id), ['adm-it-s3']);
  assert.equal(old.body.unassignedMatching, 1, 'the international tab distributes what nobody holds');
});
