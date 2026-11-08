'use strict';
/**
 * The guards of recording a payment by hand, on a real MariaDB (these were regular expressions over routes/subscriber-payments.js — `PHONE_REQUIRED`, `bookAny`,
 * `identitySpellings`, `existingName`, `cleanReference`, `applyCertificatePayment`; the recording and the approval are in manualPaymentApproval / paymentReviewAndReceipts):
 * money is recorded only against a client with a real phone; a rep books their own clients while customer service books any; a new client under a number someone already holds,
 * however the number is written, is refused naming who holds it; a reference of zeros is no reference, so it never collides; a desk payment answers with its receipt number and the
 * online one without; and a certificate payment moves its request. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-bookguard-it';
let pool; let payments;

const staff = (id, role, permissions) => ({ id, name: id, role, permissions_json: JSON.stringify(permissions) });
const REP = staff('st-bg-rep', 'sales', ['manage_payments', 'manage_subscribers']);
const OTHER_REP = staff('st-bg-rep2', 'sales', ['manage_payments']);
const SUPPORT = staff('st-bg-cs', 'support', ['manage_payments', 'manage_subscribers']);
const FINANCE = staff('st-bg-fin', 'accountant', ['manage_payments', 'manage_financial']);

async function book(who, body) {
  const layer = payments.stack.find(item => item.route?.path === '/api/admin/subscriber-payments' && item.route.methods.post);
  assert.ok(layer);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params: {}, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'boss-bg@example.test', tenant_id: T }, staffRecord: who, isSuperAdmin: false, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const pay = (overrides = {}) => ({ amount: 500, currency: 'EGP', paymentType: 'other', paymentMethod: 'كاش', status: 'pending', ...overrides });
const count = async sql => Number((await pool.query(sql, [T]))[0][0].n);

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'finance_outbox', 'certificate_requests', 'receipt_counters', 'payments', 'subscribers', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  payments = require('../../routes/subscriber-payments');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES
       ('st-bg-rep', ?, 'مندوبة', 'rep-bg@example.test', '1019800001', 'SALES', 1, '2025-01-01'),
       ('st-bg-rep2', ?, 'مندوب آخر', 'rep2-bg@example.test', '1019800002', 'SALES', 1, '2025-01-01'),
       ('st-bg-cs', ?, 'خدمة', 'cs-bg@example.test', '1019800003', 'SUPPORT', 1, '2025-01-01'),
       ('st-bg-fin', ?, 'محاسب', 'fin-bg@example.test', '1019800004', 'ACCOUNTANT', 1, '2025-01-01')`, [T, T, T, T]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id, assigned_sales_id, assigned_sales_name) VALUES
       ('sub-bg-own', ?, 'عميلة المندوبة', '1019800010', 'ONLINE_EGYPT', 'branch-online-egypt', 'st-bg-rep', 'مندوبة'),
       ('sub-bg-nophone', ?, 'بلا رقم', '123', 'ONLINE_EGYPT', 'branch-online-egypt', 'st-bg-rep', 'مندوبة')`, [T, T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('money is recorded only against a client with a real phone', { skip }, async () => {
  const refused = await book(REP, { subscriber_id: 'sub-bg-nophone', payment: pay() });
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.body.code, 'PHONE_REQUIRED');
  assert.equal(await count("SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND subscriber_id='sub-bg-nophone'"), 0);
});

test('a rep books their own clients and not another rep\'s; customer service books any', { skip }, async () => {
  assert.equal((await book(REP, { subscriber_id: 'sub-bg-own', payment: pay() })).statusCode, 200);
  const foreign = await book(OTHER_REP, { subscriber_id: 'sub-bg-own', payment: pay({ amount: 501 }) });
  assert.equal(foreign.statusCode, 403);
  assert.equal(foreign.body.code, 'SUBSCRIBER_OUT_OF_SCOPE');
  assert.equal((await book(SUPPORT, { subscriber_id: 'sub-bg-own', payment: pay({ amount: 502 }) })).statusCode, 200, 'customer service books any client it finds');
  assert.equal(await count("SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND subscriber_id='sub-bg-own'"), 2);
});

test('a new client under a number someone holds, however it is written, is refused naming who holds it', { skip }, async () => {
  const draft = phone => ({ subscriber: { name: 'عميلة جديدة بالكامل', phone, branch: 'ONLINE_EGYPT' }, payment: pay({ amount: 300 }) });
  for (const spelling of ['01019800010', '1019800010', '+20 101 980 0010', '00201019800010']) {
    const res = await book(REP, draft(spelling));
    assert.equal(res.statusCode, 409, spelling);
    assert.equal(res.body.code, 'SUBSCRIBER_EXISTS', spelling);
    assert.equal(res.body.existingName, 'عميلة المندوبة');
    assert.match(res.body.error, /المسئول عنه مندوبة/, 'it says who is responsible for them');
  }
  assert.equal(await count("SELECT COUNT(*) AS n FROM subscribers WHERE tenant_id=? AND name='عميلة جديدة بالكامل'"), 0, 'no second client');
  const fresh = await book(REP, draft('01019800099'));
  assert.equal(fresh.statusCode, 200, JSON.stringify(fresh.body));
  const [[created]] = await pool.query("SELECT phone FROM subscribers WHERE tenant_id=? AND name='عميلة جديدة بالكامل'", [T]);
  assert.equal(created.phone, '1019800099', 'stored as the identity: the ten digits');
});

test('a reference of zeros is no reference, so it never collides; a real one is used once', { skip }, async () => {
  for (const [index, reference] of ['0', '000', '---', 'لا يوجد'].entries()) {
    const res = await book(REP, { subscriber_id: 'sub-bg-own', payment: pay({ amount: 101 + index, transactionId: reference }) });
    assert.equal(res.statusCode, 200, `${reference}: ${JSON.stringify(res.body)}`);
  }
  assert.equal(await count("SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND transaction_id IS NOT NULL AND transaction_id IN ('0','000','---','لا يوجد')"), 0, 'stored as none');
  assert.equal((await book(REP, { subscriber_id: 'sub-bg-own', payment: pay({ amount: 701, transactionId: 'TX-BG-1' }) })).statusCode, 200);
  const again = await book(REP, { subscriber_id: 'sub-bg-own', payment: pay({ amount: 702, transactionId: 'TX-BG-1' }) });
  assert.ok(again.statusCode >= 400, 'the same real reference twice is refused');
  assert.equal(await count("SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND transaction_id='TX-BG-1'"), 1);
});

test('a desk payment answers with its receipt number, an online one without, and a certificate payment moves its request', { skip }, async () => {
  const desk = await book(SUPPORT, { subscriber_id: 'sub-bg-own', payment: pay({ amount: 410, branch: 'DAQQI' }) });
  assert.equal(desk.statusCode, 200, JSON.stringify(desk.body));
  assert.ok(desk.body.receiptNo, 'a Dokki desk payment takes the branch\'s next number');
  assert.equal(desk.body.receiptBranch, 'DAQQI');
  const online = await book(REP, { subscriber_id: 'sub-bg-own', payment: pay({ amount: 411 }) });
  assert.equal(online.body.receiptNo, undefined, 'an online payment is on no branch\'s series');

  await pool.query("INSERT INTO certificate_requests (id, certificate_code, subscriber_id, type, status, price, paid_amount, currency, tenant_id) VALUES ('cr-bg-1', 'MAHADBG0001', 'sub-bg-own', 'OTHER', 'PRICED', 600, 0, 'EGP', ?)", [T]);
  const certificate = await book(FINANCE, { subscriber_id: 'sub-bg-own', payment: pay({ amount: 600, paymentType: 'certificate', certId: 'cr-bg-1', status: 'paid' }) });
  assert.equal(certificate.statusCode, 200, JSON.stringify(certificate.body));
  const [[request]] = await pool.query("SELECT status, paid_amount FROM certificate_requests WHERE id='cr-bg-1'");
  assert.equal(Number(request.paid_amount), 600, 'the request holds what was paid');
  assert.notEqual(request.status, 'PRICED', 'and has moved on');
});
