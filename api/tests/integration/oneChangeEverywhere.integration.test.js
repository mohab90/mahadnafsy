'use strict';
/**
 * «اتاكدت ان اي سعر او تعديل في المدفوعات بيسمع في كل مكان في السيستم … وكذلك لو شهاده … وصلح خطه الاقساط بردو» (8 Nov 2026).
 *
 * One client, one course with a booking and an instalment plan, one certificate. Each change is made once, where the staff make it — the client's page, the
 * «دفع وحجز» dialog, the certificate's page — and then read back through every place that shows it:
 *
 *   course:      the dialog (GET /clients/:id/money) · the client lists and the client's page (GET /api/admin/subscribers, moneyItems) · the receipts, the
 *                student's page and the instalments screen (lib/agreedPrice.js itemBalances) · «أرصدة مستحقة» (GET /payments/outstanding) · the client's plan
 *                (GET /subscribers/:id/installment-plans) and the overdue list (installment_entries)
 *   certificate: the dialog (GET /clients/:id/money) · the certificates page (GET /certificate-requests) · «أرصدة مستحقة» once it has a payment
 *
 * Real MariaDB; runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-everywhere-it';
const SUB = 'sub-ev-1';
const COURSE = 'co-ev-1';
const CERT = 'cr-ev-1';
let pool; let routers;

const ADMIN = { isSuperAdmin: true, user: { uid: 'u', email: 'owner@example.test' }, staffRecord: null };

async function call(router, method, path, { params = {}, body = {}, query = {} } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  if (!layer) throw new Error(`no ${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query, headers: {}, tenantId: T, ip: '127.0.0.1', get: () => undefined, ...ADMIN };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const ok = res => { assert.ok(res.statusCode < 300, `${res.statusCode} ${JSON.stringify(res.body)}`); return res.body; };
// JSON columns come back parsed or as text, depending on the server.
const arr = value => (typeof value === 'string' ? JSON.parse(value) : value);
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'instructor_fees', 'client_item_money', 'activity_logs',
    'entitlement_events', 'enrollments', 'installment_entries', 'installment_plans', 'payments', 'certificate_requests', 'subscribers', 'courses', 'tenant_settings', 'outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

/** What every place says about the course: { place → remaining } (and the agreed price where the place shows one). */
async function course() {
  const { itemBalances } = require('../../lib/agreedPrice');
  const money = ok(await call(routers.content, 'get', '/api/admin/clients/:id/money', { params: { id: SUB } })).items.find(line => line.item === COURSE);
  const rows = ok(await call(routers.lists, 'get', '/api/admin/subscribers', { query: { limit: 50 } }));
  const row = (Array.isArray(rows) ? rows : rows.items || rows.rows || rows.subscribers).find(item => item.id === SUB);
  const listed = (row.moneyItems || []).find(line => line.item === COURSE);
  const sql = (await itemBalances(pool, { tenantId: T, subscriberId: SUB })).get(COURSE);
  const outstanding = ok(await call(routers.tools, 'get', '/api/admin/payments/outstanding')).subscribers.find(item => item.id === SUB);
  const plans = ok(await call(routers.installments, 'get', '/api/admin/subscribers/:subscriberId/installment-plans', { params: { subscriberId: SUB } }));
  const { planEntries } = require('../../lib/installmentMath');
  const open = plans.flatMap(plan => planEntries(plan)).filter(entry => !entry.paidAt);
  const [[overdue]] = await pool.query('SELECT COALESCE(SUM(amount), 0) AS owed FROM installment_entries WHERE tenant_id=? AND subscriber_id=? AND paid=0', [T, SUB]);
  return {
    agreed: { dialog: money.agreed, lists: listed.expected, sql: Number(sql.expected) },
    remaining: {
      dialog: money.remaining, lists: listed.remaining, sql: Number(sql.remaining), outstanding: Number(outstanding?.outstanding || 0),
      plan: open.reduce((sum, entry) => sum + entry.amount - (entry.partialPaid || 0), 0), overdueList: Number(overdue.owed),
    },
  };
}

/** What every place says about the certificate. */
async function certificate() {
  const money = ok(await call(routers.content, 'get', '/api/admin/clients/:id/money', { params: { id: SUB } })).certificates.find(line => line.id === CERT);
  const page = ok(await call(routers.certificates, 'get', '/api/admin/certificate-requests', { query: { subscriber_id: SUB } })).find(item => item.id === CERT);
  const { loadCertificateRequests } = require('../../lib/clientView');
  const clientPage = (await loadCertificateRequests(T, [SUB]))[SUB].find(item => item.id === CERT);
  // The certificates page shows `due` (admin/pages/dashboard/tabs/CertRequestsTab.tsx: row.due ?? row.systemPrice ?? row.price).
  return { agreed: { dialog: money.agreed, page: page.due, clientPage: clientPage.price }, remaining: { dialog: money.remaining, page: page.remaining } };
}
const same = (figures, value, what) => {
  for (const [place, figure] of Object.entries(figures)) assert.equal(figure, value, `${what}: ${place} says ${figure}, not ${value} — ${JSON.stringify(figures)}`);
};

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'Everywhere IT', 'active')", [T, T]);
  routers = {
    content: require('../../routes/core/content'), payments: require('../../routes/subscriber-payments'), certificates: require('../../routes/certificates'),
    lists: require('../../routes/admin/stafflists'), tools: require('../../routes/crm-tools'), installments: require('../../routes/installments'),
  };
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES (?, ?, 'دبلومة العلاج الأسري', '', '', '', '', 'GENERAL', 'RECORDED', 3000)`, [COURSE, T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone, branch, nationality) VALUES (?, ?, 'EV1', 'منى عادل', '1017000001', 'ONLINE_EGYPT', 'EGYPTIAN')", [SUB, T]);
  // Booked at 3,000 and paid 1,000; the 2,000 left is on a plan of two: one already late, one next week.
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date, payment_method)
     VALUES ('pay-ev-1', ?, ?, ?, 1000, 'EGP', 1, 1000, 'COURSE', 'paid', 3000, ?, 'كاش')`, [T, SUB, COURSE, day(-60)]);
  await pool.query(
    `INSERT INTO installment_plans (id, tenant_id, subscriber_id, course_id, title, total_amount, currency, installments_count, paid_count,
       installment_amounts, due_dates, paid_dates, payment_ids, paid_amounts, status, created_at)
     VALUES ('plan-ev-1', ?, ?, ?, 'باقي الدبلومة', 2000, 'EGP', 2, 0, '[1000,1000]', ?, '[null,null]', '[null,null]', '[null,null]', 'active', NOW())`,
    [T, SUB, COURSE, JSON.stringify([day(-10), day(7)])]);
  await require('../../lib/installmentEntries').syncPlanEntries(pool, T, 'plan-ev-1');
  await require('../../lib/tenantSettings').setTenantSetting('content', { extra_cert_pricing: JSON.stringify({ AIN_SHAMS: { egyptianEGP: 1000, residentEGP: 1400 } }) }, { tenantId: T });
  await pool.query(
    `INSERT INTO certificate_requests (id, tenant_id, subscriber_id, type, nationality, status, price, currency, paid_amount)
     VALUES (?, ?, ?, 'AIN_SHAMS', 'EGYPTIAN', 'PRICED', 1000, 'EGP', 0)`, [CERT, T, SUB]);
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

test('to start with, every place agrees: 3,000 agreed, 2,000 left, and the plan asks for the 2,000', { skip }, async () => {
  const now = await course();
  same(now.agreed, 3000, 'agreed');
  same(now.remaining, 2000, 'remaining');
});

test('the price lowered on the client\'s page (3,000 → 2,500) is the price everywhere, and the plan asks for 500 less, off its last instalment', { skip }, async () => {
  ok(await call(routers.content, 'put', '/api/admin/subscribers/:id/item-money', { params: { id: SUB }, body: { item: COURSE, expected: 2500 } }));
  const now = await course();
  same(now.agreed, 2500, 'agreed');
  same(now.remaining, 1500, 'remaining');
  const [[plan]] = await pool.query("SELECT installment_amounts, total_amount FROM installment_plans WHERE id='plan-ev-1'");
  assert.deepEqual(arr(plan.installment_amounts), [1000, 500], 'the late instalment is still owed; the next one is what was taken off');
  assert.equal(Number(plan.total_amount), 1500);
});

test('a payment taken at «دفع وحجز» is seen everywhere, and it pays the late instalment on the plan', { skip }, async () => {
  ok(await call(routers.payments, 'post', '/api/admin/subscriber-payments', {
    body: { subscriber_id: SUB, payment: { id: 'pay-ev-2', amount: 1000, currency: 'EGP', paymentType: 'COURSE', courseId: COURSE, paymentMethod: 'كاش', isInstallment: true, status: 'paid' } },
  }));
  const now = await course();
  same(now.agreed, 2500, 'agreed');
  same(now.remaining, 500, 'remaining');
  const [[plan]] = await pool.query("SELECT paid_dates, payment_ids, paid_count FROM installment_plans WHERE id='plan-ev-1'");
  assert.equal(arr(plan.payment_ids)[0], 'pay-ev-2', 'the late instalment is paid by that payment');
  assert.equal(Number(plan.paid_count), 1);
  const [[late]] = await pool.query('SELECT COUNT(*) AS n FROM installment_entries WHERE tenant_id=? AND subscriber_id=? AND paid=0 AND due_date < CURDATE()', [T, SUB]);
  assert.equal(Number(late.n), 0, 'nothing is late any more on the overdue list');
});

test('the price raised again (2,500 → 3,000) is everywhere, and the plan that asked for all that was left asks for the 500 more', { skip }, async () => {
  ok(await call(routers.content, 'put', '/api/admin/subscribers/:id/item-money', { params: { id: SUB }, body: { item: COURSE, expected: 3000 } }));
  const now = await course();
  same(now.agreed, 3000, 'agreed');
  same(now.remaining, 1000, 'remaining');
});

test('a certificate price edited on its page (1,000 → 800) is the price on the dialog and on the certificates page', { skip }, async () => {
  ok(await call(routers.certificates, 'put', '/api/admin/certificate-requests/:id/details', { params: { id: CERT }, body: { price: 800 } }));
  const now = await certificate();
  same(now.agreed, 800, 'certificate agreed');
  same(now.remaining, 800, 'certificate remaining');
});

test('a certificate payment at «دفع وحجز» is seen on both, and is never course money — nor in «أرصدة مستحقة», which is course money only', { skip }, async () => {
  ok(await call(routers.payments, 'post', '/api/admin/subscriber-payments', {
    body: { subscriber_id: SUB, payment: { id: 'pay-ev-3', amount: 300, currency: 'EGP', paymentType: 'CERTIFICATE', certId: CERT, certType: 'AIN_SHAMS', paymentMethod: 'كاش', status: 'paid' } },
  }));
  const now = await certificate();
  same(now.agreed, 800, 'certificate agreed');
  same(now.remaining, 500, 'certificate remaining');
  // The course is untouched by certificate money, «أرصدة مستحقة» included: it counts the courses' and tracks' money only (lib/outstandingBalances.js, 2 Nov 2026);
  // what is left on a certificate is on the certificates page and the client's page.
  same((await course()).remaining, 1000, 'course remaining');
});
