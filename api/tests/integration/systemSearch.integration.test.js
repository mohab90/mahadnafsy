'use strict';
/**
 * GET /api/search?scope=system against a real MariaDB (lib/systemSearch.js): one
 * box finds the client, the lead, the payment by its transaction number, the
 * certificate by its code and the ticket — and nothing of another institute's,
 * and nothing an account may not open. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-search-it';
const OTHER = 'tenant-search-it-2';
let pool, searchSystem;

async function clean() {
  for (const table of ['support_tickets', 'course_completions', 'payments', 'leads', 'subscribers', 'courses']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id IN (?, ?)`, [TENANT, OTHER]);
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ searchSystem } = require('../../lib/systemSearch'));
  await clean();
  for (const [tenant, suffix] of [[TENANT, '1'], [OTHER, '2']]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, slug, description, short_description, instructor, thumbnail, category, type)
       VALUES (?, ?, 'العلاج المعرفي', ?, '', '', '', '', 'GENERAL', 'RECORDED')`, [`ss-course-${suffix}`, tenant, `ss-course-${suffix}`]);
    await pool.query(
      `INSERT INTO subscribers (id, tenant_id, client_code, name, phone, email, branch, is_active, assigned_sales_id)
       VALUES (?, ?, ?, 'سلمى البحث', ?, ?, 'ONLINE_EGYPT', 1, 'ss-rep')`,
      [`ss-sub-${suffix}`, tenant, `SS${suffix}`, `101777000${suffix}`, `salma${suffix}@x.test`]);
    await pool.query(
      `INSERT INTO leads (id, tenant_id, client_code, name, phone, source, status, branch, hidden, assigned_sales_id)
       VALUES (?, ?, ?, 'سلمى المحتملة', ?, 'facebook', 'new', 'ONLINE_EGYPT', 0, ?)`,
      [`ss-lead-${suffix}`, tenant, `SL${suffix}`, `101777100${suffix}`, suffix === '1' ? 'ss-other-rep' : 'ss-rep']);
    await pool.query(
      `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, amount_egp, date, status, transaction_id, branch)
       VALUES (?, ?, ?, 1200, 'EGP', 1200, NOW(), 'paid', ?, 'ONLINE_EGYPT')`,
      [`ss-pay-${suffix}`, tenant, `ss-sub-${suffix}`, `VC-88${suffix}4401`]);
    await pool.query(
      `INSERT INTO course_completions (id, tenant_id, subscriber_id, course_id, certificate_code, completed_at, status)
       VALUES (?, ?, ?, ?, ?, NOW(), 'active')`,
      [`ss-cc-${suffix}`, tenant, `ss-sub-${suffix}`, `ss-course-${suffix}`, `MHAD-SSIT-${suffix}`]);
    await pool.query(
      `INSERT INTO support_tickets (id, tenant_id, ticket_code, subject, subscriber_name, status, department)
       VALUES (?, ?, ?, 'مش عارفة أدخل', 'سلمى البحث', 'open', 'support')`,
      [`ss-tk-${suffix}`, tenant, `TK-SS${suffix}`]);
  }
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

const owner = { tenantId: TENANT, isSuperAdmin: true, user: { uid: 'owner' } };

test('one box: the client, the lead and the ticket by name — this institute\'s only', { skip }, async () => {
  const answer = await searchSystem(owner, 'سلمي');
  assert.deepEqual(answer.clients.map(row => row.id), ['ss-sub-1']);
  assert.deepEqual(answer.leads.map(row => row.id), ['ss-lead-1']);
  assert.deepEqual(answer.tickets.map(row => row.id), ['ss-tk-1']);
  assert.deepEqual(answer.clients[0].open, { client: 'SS1' });
});

test('a payment by its transaction number, a certificate by its code, a client by a phone fragment', { skip }, async () => {
  assert.deepEqual((await searchSystem(owner, 'vc-8814')).payments.map(row => row.id), ['ss-pay-1']);
  const certificates = (await searchSystem(owner, 'mhad-ssit')).certificates;
  assert.deepEqual(certificates.map(row => row.id), ['ss-cc-1']);
  assert.deepEqual(certificates[0].open, { client: 'SS1' });
  assert.deepEqual((await searchSystem(owner, '01017770001')).clients.map(row => row.id), ['ss-sub-1']);
});

test('a sales rep: their own leads and clients, no payments, no certificates', { skip }, async () => {
  const rep = { tenantId: TENANT, user: { uid: 'ss-rep', mfa_verified: true }, staffRecord: { id: 'ss-rep', role: 'sales', tenant_id: TENANT } };
  const answer = await searchSystem(rep, 'سلمى');
  assert.deepEqual(answer.leads, [], 'the lead is another rep\'s');
  assert.deepEqual(answer.clients.map(row => row.id), ['ss-sub-1']);
  assert.ok(!answer.kinds.includes('payments') && !answer.kinds.includes('certificates'));
  assert.deepEqual((await searchSystem(rep, 'vc-8814')).payments, []);
});
