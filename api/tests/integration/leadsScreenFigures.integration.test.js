'use strict';
/**
 * The leads screen's figures against a real MariaDB (18 Oct 2026). The strip above «عملائي المحتملون», the
 * follow-ups drawer and the «✓ مشترك» badge counted in the browser, out of every lead and client of the rep that
 * the screen downloaded whole; the database counts them now, over the rep's own set: GET /api/staff/leads-kpis,
 * /api/admin/leads/followups-panel and /api/admin/leads/clients. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-leads-figures-it';
const REP = { id: 'lf-rep-1', role: 'sales', tenant_id: TENANT };
const OTHER = { id: 'lf-rep-2', role: 'sales', tenant_id: TENANT };
let pool, kpisRouter, panelRouter, listsRouter;
let phoneSeq = 0;

async function call(router, path, staff, query = {}) {
  const layer = router.stack.find(l => l.route?.path === path);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({
    params: {}, query, body: {}, headers: {}, tenantId: TENANT, user: { uid: staff?.id || 'admin' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}
const clean = async () => {
  for (const table of ['payments', 'communications', 'subscribers', 'leads']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]);
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  kpisRouter = require('../../routes/admin/stafflists');
  panelRouter = require('../../routes/admin/leads/stats');
  listsRouter = require('../../routes/admin/leads/lists');
  const { cairoToday, addDaysToDateOnly } = require('../../lib/dates');
  const today = cairoToday();
  const yesterday = addDaysToDateOnly(today, -1);
  await clean();
  const lead = (id, status, rep, o = {}) => pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, email, source, status, assigned_sales_id, next_follow_up_date, hidden, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [id, TENANT, id, o.phone || `10188${String(++phoneSeq).padStart(5, '0')}`,
      o.email || null, o.source || 'test', status, rep, o.followUp || null, o.hidden ? 1 : 0]);
  await lead('lf-overdue', 'new', REP.id, { followUp: `${yesterday} 00:00:00` });
  await lead('lf-today', 'interested', REP.id, { followUp: `${today} 00:00:00` });
  await lead('lf-converted', 'converted', REP.id);
  await lead('lf-undated', 'contacted', REP.id);
  await lead('lf-lost', 'lost', REP.id);
  await lead('lf-archive', 'new', REP.id, { source: 'محلي قديم' });
  await lead('lf-hidden', 'new', REP.id, { hidden: true });
  await lead('lf-theirs', 'new', OTHER.id, { followUp: `${yesterday} 00:00:00` });
  const comm = (id, leadId, daysAgo) => pool.query(
    "INSERT INTO communications (id, tenant_id, lead_id, type, date, notes) VALUES (?, ?, ?, 'call', NOW() - INTERVAL ? DAY, 'x')",
    [id, TENANT, leadId, daysAgo]);
  await comm('lf-c1', 'lf-overdue', 0); // two today on their own lead
  await comm('lf-c2', 'lf-overdue', 0);
  await comm('lf-c3', 'lf-undated', 3); // inside the week
  await comm('lf-c4', 'lf-undated', 9); // outside it
  await comm('lf-c5', 'lf-theirs', 0); // another rep's lead
  const sub = (id, rep, o = {}) => pool.query(
    'INSERT INTO subscribers (id, tenant_id, name, phone, email, lead_id, assigned_sales_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, TENANT, id, o.phone || null, o.email || null, o.leadId || null, rep]);
  const pay = (id, subId, amount, currency, status) => pool.query(
    'INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, status, date) VALUES (?, ?, ?, ?, ?, ?, NOW())',
    [id, TENANT, subId, amount, currency, status]);
  await sub('lf-sub-mine', REP.id);
  await sub('lf-sub-theirs', OTHER.id);
  await pay('lf-p1', 'lf-sub-mine', 500, 'EGP', 'paid');
  await pay('lf-p2', 'lf-sub-mine', 200, 'EGP', 'pending'); // not collected
  await pay('lf-p3', 'lf-sub-mine', 100, 'SAR', 'paid'); // not pounds
  await pay('lf-p4', 'lf-sub-theirs', 999, 'EGP', 'paid'); // another rep's client
  // The clients the converted leads became: by the lead's own link, by e-mail, by phone.
  await lead('lf-linked', 'converted', REP.id);
  await lead('lf-by-mail', 'converted', REP.id, { email: 'LF.Mail@Example.com' });
  await lead('lf-by-phone', 'converted', REP.id, { phone: '1019990001' });
  await lead('lf-no-client', 'converted', REP.id);
  await lead('lf-their-converted', 'converted', OTHER.id);
  await sub('lf-client-linked', REP.id, { leadId: 'lf-linked' });
  await sub('lf-client-mail', REP.id, { email: 'lf.mail@example.com' });
  await sub('lf-client-phone', REP.id, { phone: '1019990001' });
  await sub('lf-client-theirs', OTHER.id, { leadId: 'lf-their-converted' });
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the strip: the rep\'s own live leads, their calls and the pounds their clients paid', { skip }, async () => {
  const { statusCode, body } = await call(kpisRouter, '/api/staff/leads-kpis', REP);
  assert.equal(statusCode, 200, JSON.stringify(body));
  // overdue, today, converted, undated, lost, linked, by-mail, by-phone, no-client — not the archive, the hidden or the other rep's.
  assert.equal(body.totalLeads, 9);
  assert.equal(body.converted, 5);
  assert.equal(body.convertedThisMonth, 5);
  assert.equal(body.active, 3, 'new, interested, contacted');
  assert.equal(body.overdue, 1);
  assert.equal(body.callsToday, 2);
  assert.equal(body.callsWeek, 3, 'today\'s two and the one three days ago; not the nine-day-old one, not another rep\'s');
  assert.equal(body.collectedEgp, 500, 'paid pounds of their own clients only');
});

test('the strip for another rep counts only theirs', { skip }, async () => {
  const { body } = await call(kpisRouter, '/api/staff/leads-kpis', OTHER);
  assert.equal(body.totalLeads, 2, 'their new lead and their converted one');
  assert.equal(body.callsToday, 1);
  assert.equal(body.collectedEgp, 999);
});

test('the drawer: true counts by group, the rows of each, in the rep\'s scope', { skip }, async () => {
  const { statusCode, body } = await call(panelRouter, '/api/admin/leads/followups-panel', REP);
  assert.equal(statusCode, 200, JSON.stringify(body));
  // The drawer never left the imported archive out (the staff copy it filtered did not), so the archive lead is open work here.
  assert.equal(body.openTotal, 4);
  assert.equal(body.overdueCount, 1);
  assert.equal(body.todayCount, 1);
  assert.equal(body.noFollowupCount, 2, 'new or contacted with no date; a lead with a date is not "without an appointment"');
  assert.deepEqual(body.overdue.map(l => l.id), ['lf-overdue']);
  assert.deepEqual(body.today.map(l => l.id), ['lf-today']);
  assert.deepEqual(body.noFollowup.map(l => l.id).sort(), ['lf-archive', 'lf-undated']);
  assert.equal(body.overdue[0].nextFollowUpDate.length, 10, 'a plain day, comparable with today\'s');
});

test('the client of each lead: own link, then e-mail, then phone; nothing for a lead outside the scope', { skip }, async () => {
  const ids = ['lf-linked', 'lf-by-mail', 'lf-by-phone', 'lf-no-client', 'lf-their-converted'].join(',');
  const { statusCode, body } = await call(listsRouter, '/api/admin/leads/clients', REP, { ids });
  assert.equal(statusCode, 200, JSON.stringify(body));
  assert.deepEqual(Object.fromEntries(Object.entries(body.clients).map(([lead, client]) => [lead, client.id])), {
    'lf-linked': 'lf-client-linked', 'lf-by-mail': 'lf-client-mail', 'lf-by-phone': 'lf-client-phone',
  });
  const none = await call(listsRouter, '/api/admin/leads/clients', REP, { ids: '' });
  assert.deepEqual(none.body, { clients: {} });
});
