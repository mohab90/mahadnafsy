'use strict';
/**
 * The review of certificate prices (15 Oct 2026), on a real MariaDB: a voided payment no longer leaves its
 * money on the request, the review finds a request whose paid amount disagrees with its payments, and what
 * the screen shows as the price is the price list's.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-certaudit-it';
let pool; let syncCertificateRequest; let auditRequests; let setTenantSetting;

const addPayment = (id, no, amount, deleted = false) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, date, payment_no, amount, currency, amount_egp, payment_type, payment_method, status, certificate_request_id, deleted_at)
   VALUES (?, ?, 'cert-sub-1', NOW(), ?, ?, 'EGP', ?, 'CERTIFICATE', 'خزنة', 'paid', 'cert-req-1', ?)`,
  [id, TENANT, 870000 + no, amount, amount, deleted ? new Date() : null]);
const clean = async () => {
  for (const table of ['payments', 'certificate_requests', 'subscribers', 'tenant_settings']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ syncCertificateRequest } = require('../../lib/certificatePayments'));
  ({ auditRequests } = require('../../routes/certificates'));
  ({ setTenantSetting } = require('../../lib/tenantSettings'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('cert-sub-1', ?, 'عميل', '1019000777')", [TENANT]);
  await setTenantSetting('content', { extra_cert_pricing: JSON.stringify({ AIN_SHAMS: { egyptianEGP: 1000, residentEGP: 1000, residentSAR: 0, foreignUSD: 0 } }) }, { tenantId: TENANT, actorId: 'it' });
  // Paid 1000 on the request, but one of the two 500 payments was voided.
  await pool.query("INSERT INTO certificate_requests (id, subscriber_id, type, status, price, paid_amount, currency, tenant_id) VALUES ('cert-req-1', 'cert-sub-1', 'AIN_SHAMS', 'PAID', 1000, 1000, 'EGP', ?)", [TENANT]);
  await addPayment('cert-pay-1', 1, 500);
  await addPayment('cert-pay-2', 2, 500, true);
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

test('the review finds a request paid more than its standing payments, and says why', { skip }, async () => {
  const { issues } = await auditRequests(TENANT);
  const issue = issues.find(row => row.id === 'cert-req-1');
  assert.ok(issue, 'found');
  assert.ok(issue.problems.includes('paid_mismatch') && issue.problems.includes('status_wrong'));
  assert.deepEqual([issue.paid, issue.linkedPaid, issue.fix.paid], [1000, 500, 500]);
});

test('syncing takes the voided money off and moves the status back to unpaid', { skip }, async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await syncCertificateRequest(conn, TENANT, 'cert-req-1');
    await conn.commit();
    assert.deepEqual([result.changed, result.paid, result.status], [true, 500, 'PRICED']);
  } finally { conn.release(); }
  const [[row]] = await pool.query("SELECT paid_amount, status FROM certificate_requests WHERE id='cert-req-1'");
  assert.deepEqual([Number(row.paid_amount), row.status], [500, 'PRICED']);
  assert.equal((await auditRequests(TENANT)).issues.find(issue => issue.id === 'cert-req-1'), undefined, 'and the review is clean');
});

test('a request with no payment row (imported as paid) keeps what it came with', { skip }, async () => {
  await pool.query("INSERT INTO certificate_requests (id, subscriber_id, type, status, price, paid_amount, currency, tenant_id) VALUES ('cert-req-imp', 'cert-sub-1', 'AIN_SHAMS', 'PAID', 1000, 1000, 'EGP', ?)", [TENANT]);
  const conn = await pool.getConnection();
  try {
    const result = await syncCertificateRequest(conn, TENANT, 'cert-req-imp');
    assert.deepEqual([result.changed, result.paid], [false, 1000]);
  } finally { conn.release(); }
});
