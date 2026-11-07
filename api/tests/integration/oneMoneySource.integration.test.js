'use strict';
/**
 * One source of truth for what a client owes (7 Nov 2026): «سعر الكورس أحيانًا رقم في صفحة العميل ورقم تاني عند زر دفع وحجز»,
 * «عدّلت سعر شهادة العميل وشباك الدفع ما أخدهاش». Real MariaDB; runs only with DB_* (or TEST_DB_*).
 *
 * Root causes, found on the lab:
 *  (a) the booking dialog opens as a NEW booking by default, and a new booking is priced by the branch tier alone: the dialog shows the tier's
 *      figure (admin/components/payment-modal/usePaymentModalModel.tsx tierBooking → _effPx = tierPx) and POST /api/admin/subscriber-payments takes
 *      `tierPrice.price` over everything (routes/subscriber-payments.js: resolvedExpected = tierPrice.price) and then WRITES it as the client's
 *      price (setAgreedPrice, same file, «A price the desk entered…»), wiping the price edited on the client's page.
 *  (b) a certificate request's price is read as «the price list's figure, else the request's own» (lib/certificatePricing.js certificateDue, used by
 *      lib/clientView.js loadCertificateRequests — what the dialog is handed — and by routes/certificates.js priceDue), so a price edited for one
 *      client (PUT certificate-requests/:id/details) is shown on the client's page and ignored by the dialog.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-onemoney-it';
let pool; let paymentsRouter; let contentRouter; let certificatesRouter;

const ADMIN = { isSuperAdmin: true, user: { uid: 'u', email: 'owner@example.test' }, staffRecord: null };

async function call(router, method, path, { params = {}, body = {}, query = {}, who = ADMIN } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query, headers: {}, tenantId: TENANT, ip: '127.0.0.1', get: () => undefined, ...who };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const book = body => call(paymentsRouter, 'post', '/api/admin/subscriber-payments', { body });
const clientPage = (id, item, expected) => call(contentRouter, 'put', '/api/admin/subscribers/:id/item-money', { params: { id }, body: { item, expected } });

const IDENTITY = { nameAr: 'أحمد محمد عبد الله', nameEn: 'Ahmed Mohamed Abdallah', nationalId: '29001011234567', phoneConfirmed: true };
// What the dialog sends for a new booking: the tier, and the tier's figure as courseExpected.
const dialogBooking = overrides => ({
  amount: 500, currency: 'EGP', paymentType: 'COURSE', courseId: 'co-om-1', paymentMethod: 'كاش', isInstallment: false,
  branch: 'DAQQI', status: 'paid', priceTier: 'DAQQI', courseExpected: 2500, ...overrides,
});

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [TENANT]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'instructor_fees', 'client_item_money', 'activity_logs',
    'entitlement_events', 'enrollments', 'payments', 'certificate_requests', 'catalog_prices', 'subscribers', 'courses', 'tenant_settings', 'outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'One money IT', 'active')", [TENANT, TENANT]);
  paymentsRouter = require('../../routes/subscriber-payments');
  contentRouter = require('../../routes/core/content');
  certificatesRouter = require('../../routes/certificates');
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp, price_sar)
     VALUES ('co-om-1', ?, 'كورس العلاج المعرفي', '', '', '', '', 'GENERAL', 'RECORDED', 3000, 450)`, [TENANT]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES
       ('sub-om-1', ?, 'Ahmed fb', '1016000001', 'DAQQI', 'branch-daqqi'),
       ('sub-om-2', ?, 'منى أحمد', '1016000002', 'DAQQI', 'branch-daqqi')`, [TENANT, TENANT]);
  const conn = await pool.getConnection();
  try {
    await require('../../lib/priceTiers').saveItemPricing(conn, { tenantId: TENANT, type: 'course', itemId: 'co-om-1', tiers: { DAQQI: { price: 2500, discountPrice: 2200 } }, bonuses: {} });
  } finally { conn.release(); }
  await require('../../lib/tenantSettings').setTenantSetting('content', { extra_cert_pricing: JSON.stringify({ AIN_SHAMS: { egyptianEGP: 1000, residentEGP: 1400 } }) }, { tenantId: TENANT });
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

test('(a) a booking opened from the client page keeps the price edited there, not the branch price', { skip }, async () => {
  const { agreedPrice } = require('../../lib/agreedPrice');
  const priceNow = () => agreedPrice(pool, { tenantId: TENANT, subscriberId: 'sub-om-1', courseId: 'co-om-1' });
  const first = await book({ subscriber_id: 'sub-om-1', client: IDENTITY, payment: dialogBooking() });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(await priceNow(), 2500, 'the branch price is where a NEW booking starts');

  const edited = await clientPage('sub-om-1', 'co-om-1', 2000);
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.body));
  assert.equal(await priceNow(), 2000, 'the client page now says 2000');

  // «دفع وحجز» from a dialog that still holds the branch figure it computed from the catalogue: refused, with the price on file, and nothing is written.
  const stale = await book({ subscriber_id: 'sub-om-1', client: IDENTITY, payment: dialogBooking({ amount: 300 }) });
  assert.equal(stale.statusCode, 409, JSON.stringify(stale.body));
  assert.deepEqual([stale.body.code, stale.body.price], ['PRICE_CHANGED', 2000]);
  assert.equal(stale.body.error, 'السعر اتغير، افتح من جديد');
  assert.equal(await priceNow(), 2000, 'the refused booking changed nothing');

  // The dialog opened afresh proposes the price on file (and still names the tier): it is recorded, and the client's price stays.
  const fresh = await book({ subscriber_id: 'sub-om-1', client: IDENTITY, payment: dialogBooking({ amount: 300, courseExpected: 2000 }) });
  assert.equal(fresh.statusCode, 200, JSON.stringify(fresh.body));
  const [rows] = await pool.query("SELECT course_expected FROM payments WHERE tenant_id=? AND subscriber_id='sub-om-1' ORDER BY created_at, id", [TENANT]);
  assert.deepEqual(rows.map(row => Number(row.course_expected)), [2000, 2000], 'every booking of the course carries the client own price');
  assert.equal(await priceNow(), 2000);

  // Nobody sending nothing gets the same price.
  const silent = await book({ subscriber_id: 'sub-om-1', payment: { amount: 100, currency: 'EGP', paymentType: 'COURSE', courseId: 'co-om-1', paymentMethod: 'كاش', isInstallment: true, status: 'paid' } });
  assert.equal(silent.statusCode, 200, JSON.stringify(silent.body));
  assert.equal(await priceNow(), 2000);
});

test('(b) a certificate price edited for one client is the price the dialog is handed', { skip }, async () => {
  const { loadCertificateRequests } = require('../../lib/clientView');
  await pool.query(
    `INSERT INTO certificate_requests (id, tenant_id, subscriber_id, type, nationality, status, price, currency, paid_amount)
     VALUES ('cr-om-1', ?, 'sub-om-2', 'AIN_SHAMS', 'EGYPTIAN', 'PRICED', 1000, 'EGP', 0)`, [TENANT]);
  const before = (await loadCertificateRequests(TENANT, ['sub-om-2']))['sub-om-2'][0];
  assert.equal(before.price, 1000, 'the price list\'s figure, until somebody edits it for this client');

  const edited = await call(certificatesRouter, 'put', '/api/admin/certificate-requests/:id/details', { params: { id: 'cr-om-1' }, body: { price: 800 } });
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.body));
  const [[stored]] = await pool.query("SELECT price FROM certificate_requests WHERE id='cr-om-1' AND tenant_id=?", [TENANT]);
  assert.equal(Number(stored.price), 800, 'the client\'s page (the panel) shows 800');

  const handed = (await loadCertificateRequests(TENANT, ['sub-om-2']))['sub-om-2'][0];
  assert.equal(handed.price, 800, 'the dialog is handed the same 800');
  const listed = await call(certificatesRouter, 'get', '/api/admin/certificate-requests', { query: { subscriber_id: 'sub-om-2' } });
  assert.equal(listed.body[0].remaining, 800, 'and so is the certificates page: remaining = 800 − 0');
});
