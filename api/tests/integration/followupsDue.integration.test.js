'use strict';
/**
 * GET /api/admin/leads/followups-due against a real MariaDB: the header bell's
 * number, counted by the database instead of out of the 500 newest leads the
 * panel no longer loads for it (12 Oct 2026). The browser's rule, in SQL: an
 * open lead (shared/leadStatuses.ts) whose follow-up — the column, else
 * crm_json's — is today or earlier in Cairo, in the caller's own scope.
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
const TENANT = 'tenant-followups-it';
let pool, router;

async function due(staff) {
  const layer = router.stack.find(l => l.route?.path === '/api/admin/leads/followups-due');
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({
    params: {}, query: {}, body: {}, headers: {}, tenantId: TENANT, user: { uid: staff?.id || 'admin' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  }, res);
  return res;
}
const clean = () => pool.query('DELETE FROM leads WHERE tenant_id=?', [TENANT]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/admin/leads/stats');
  const { cairoToday, addDaysToDateOnly } = require('../../lib/dates');
  const today = cairoToday();
  const ago = addDaysToDateOnly(today, -3);
  const ahead = addDaysToDateOnly(today, 1);
  await clean();
  const lead = (id, phone, status, rep, followUp, extra = {}) => pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, assigned_sales_id, next_follow_up_date, hidden, crm_json)
     VALUES (?, ?, ?, ?, 'test', ?, ?, ?, ?, ?)`,
    [id, TENANT, id, phone, status, rep, followUp, extra.hidden ? 1 : 0, extra.crm ? JSON.stringify(extra.crm) : null]);
  await lead('fu-overdue', '1017770001', 'new', 'fu-rep-1', `${ago} 00:00:00`);
  await lead('fu-today', '1017770002', 'contacted', 'fu-rep-2', `${today} 00:00:00`);
  await lead('fu-tomorrow', '1017770003', 'new', 'fu-rep-1', `${ahead} 00:00:00`);
  await lead('fu-converted', '1017770004', 'converted', 'fu-rep-1', `${ago} 00:00:00`);
  await lead('fu-hidden', '1017770005', 'new', 'fu-rep-1', `${ago} 00:00:00`, { hidden: true });
  // A date left in crm_json with an empty column (migration 349 copied every such date; every writer sets both now): the lead list
  // still shows it, the counters read the column alone and leave it out.
  await lead('fu-json', '1017770006', 'interested', 'fu-rep-1', null, { crm: { nextFollowUpDate: ago } });
  await lead('fu-none', '1017770007', 'new', 'fu-rep-1', null);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('an admin\'s bell: every open lead followed up today or overdue, hidden and closed ones left out', { skip }, async () => {
  const { statusCode, body } = await due();
  assert.equal(statusCode, 200, JSON.stringify(body));
  assert.deepEqual(body, { due: 2, overdue: 1, today: 1 });
});

test('a rep\'s bell: their own leads only, the scope the leads list answers with', { skip }, async () => {
  const { body } = await due({ id: 'fu-rep-1', role: 'sales', tenant_id: TENANT });
  assert.deepEqual(body, { due: 1, overdue: 1, today: 0 });
  const other = await due({ id: 'fu-rep-2', role: 'sales', tenant_id: TENANT });
  assert.deepEqual(other.body, { due: 1, overdue: 0, today: 1 });
});
