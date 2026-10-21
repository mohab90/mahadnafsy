'use strict';
/**
 * The public endpoints through the real app (lib/httpApp.js createHttpApp):
 * its parsers, tenant resolution, rate limits and routers, over HTTP — not a
 * handler called by hand. And a card payment end to end: the order reserved,
 * a callback signed the way Paymob signs it (lib/paymobHmac.js), the course
 * opened; a forged callback opens nothing, a repeated one charges nothing twice.
 * Against a real MariaDB; runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-ops-http-it';
const COURSE = 'co-ops-http-1';
const ORDER = 'ord-ops-http-1';
const HMAC_SECRET = 'ops-http-it-hmac-secret';
const EMAIL = 'ops.http.it@example.test';
let pool; let server; let base;

const TABLES = ['journal_entry_lines', 'journal_entries', 'payment_audit_log', 'financial_audit_log', 'finance_outbox', 'message_outbox',
  'outbox', 'crm_commissions', 'entitlement_events', 'enrollments', 'payments', 'orders', 'subscribers', 'lead_events', 'leads',
  'courses', 'tenant_settings', 'job_queue'];
async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [TENANT]).catch(() => {});
  for (const table of TABLES) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  await pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': TENANT, ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

// What the reservation below charged: Paymob reports it back in cents.
let chargedAmount = 1500;
function signedCallback(overrides = {}, secret = HMAC_SECRET) {
  const obj = {
    id: 9900001, amount_cents: Math.round(chargedAmount * 100), created_at: '2026-10-21T10:00:00', currency: 'EGP', error_occured: false,
    has_parent_transaction: false, integration_id: 1, is_3d_secure: true, is_auth: false, is_capture: false,
    is_refunded: false, is_standalone_payment: true, is_voided: false, owner: 1, pending: false, success: true,
    order: { id: 77001, merchant_order_id: `${ORDER}~1729500000000` },
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    ...overrides,
  };
  const { buildPaymobHmacPayload } = require('../../lib/paymobHmac');
  const hmac = crypto.createHmac('sha512', secret).update(buildPaymobHmacPayload(obj)).digest('hex');
  return { obj, hmac };
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Ops HTTP IT', 'active')", [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES (?, ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 1500)`, [COURSE, TENANT]);
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await setTenantSetting('sys_payment_gateway', {
    active_provider: 'paymob',
    paymob: { enabled: true, hmac_secret: HMAC_SECRET },
  }, { tenantId: TENANT });
  const { createHttpApp } = require('../../lib/httpApp');
  const app = createHttpApp({ pool, brandAssetRoot: os.tmpdir() });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!ENABLED) return;
  await clean();
  await new Promise(resolve => server.close(resolve));
  await pool.end().catch(() => {});
});

test('the app answers its health check', { skip }, async () => {
  const res = await call('GET', '/api/health/live');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('an unknown institute is refused before any route', { skip }, async () => {
  const res = await call('POST', '/api/leads-public', { name: 'x', phone: '01000000000' }, { 'X-Tenant-Id': 'tenant-nobody-it' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'TENANT_UNKNOWN');
});

test('the public lead forms refuse a form with no name or number', { skip }, async () => {
  for (const path of ['/api/leads-public', '/api/registrations']) {
    const res = await call('POST', path, { name: 'بدون رقم' });
    assert.equal(res.status, 400, `${path}: ${res.text}`);
  }
  const malformed = await call('POST', '/api/leads-public', '{"name":');
  assert.equal(malformed.status, 400, 'a body that is not JSON is a 400, not a 500');
});

test('a lead form through the real app files a lead for that institute', { skip }, async () => {
  const res = await call('POST', '/api/leads-public', { name: 'عميلة HTTP', phone: '01098765432', source: 'ops-http-it' });
  assert.equal(res.status, 200, res.text);
  const [[lead]] = await pool.query('SELECT tenant_id, name FROM leads WHERE id=?', [res.body.id]);
  assert.deepEqual({ ...lead }, { tenant_id: TENANT, name: 'عميلة HTTP' });
});

test('a reservation with a bad amount, currency or type is a 400', { skip }, async () => {
  const order = { orderId: 'ord-ops-http-bad', type: 'course', itemId: COURSE, amount: 1500, currency: 'EGP' };
  for (const [change, code] of [
    [{ amount: -1500 }, 'INVALID_AMOUNT'],
    [{ amount: 'lots' }, 'INVALID_AMOUNT'],
    [{ amount: 5e9 }, 'INVALID_AMOUNT'],
    [{ currency: 'XYZ' }, 'INVALID_CURRENCY'],
    [{ type: 'consultation' }, 'ORDER_TYPE_NOT_RESERVABLE'],
  ]) {
    const res = await call('POST', '/api/orders/reserve', { ...order, ...change });
    assert.equal(res.status, 400, `${JSON.stringify(change)}: ${res.text}`);
    assert.equal(res.body.code, code);
  }
  const missing = await call('POST', '/api/orders/reserve', { type: 'course' });
  assert.equal(missing.status, 400);
  const cheap = await call('POST', '/api/orders/reserve', { ...order, amount: 1 });
  assert.equal(cheap.status, 409, 'not the catalogue price');
  assert.equal(cheap.body.code, 'PRICE_MISMATCH');
  const [rows] = await pool.query('SELECT id FROM orders WHERE tenant_id=?', [TENANT]);
  assert.equal(rows.length, 0, 'nothing was reserved');
});

test('reserve, a signed Paymob callback, and the course is open — once', { skip }, async () => {
  // Paying in full is the catalogue price less the cash rate: the figure the site quotes.
  const quote = await call('POST', '/api/public/price-quote', { itemType: 'course', itemId: COURSE, payMode: 'cash', currency: 'EGP' });
  assert.equal(quote.status, 200, quote.text);
  chargedAmount = quote.body.dueNow;
  const reserved = await call('POST', '/api/orders/reserve', {
    orderId: ORDER, type: 'course', itemId: COURSE, itemTitle: 'كورس', amount: quote.body.dueNow, currency: 'EGP',
    customerName: 'طالبة', customerEmail: EMAIL, customerPhone: '01011112222',
  });
  assert.equal(reserved.status, 200, reserved.text);

  // Signed with another secret: refused, nothing opened.
  const forged = signedCallback({}, 'not-the-institute-secret');
  const refused = await call('POST', `/api/webhooks/paymob?hmac=${forged.hmac}`, { type: 'TRANSACTION', obj: forged.obj });
  assert.equal(refused.status, 200);
  assert.equal(refused.body.reason, 'invalid_signature');
  let [[order]] = await pool.query('SELECT status FROM orders WHERE id=?', [ORDER]);
  assert.equal(String(order.status).toLowerCase(), 'pending');

  // A signed callback whose amount was tampered with no longer verifies.
  const tampered = signedCallback();
  tampered.obj.amount_cents = 100;
  const tamperedRes = await call('POST', `/api/webhooks/paymob?hmac=${tampered.hmac}`, { type: 'TRANSACTION', obj: tampered.obj });
  assert.equal(tamperedRes.body.reason, 'invalid_signature');

  const good = signedCallback();
  const paid = await call('POST', `/api/webhooks/paymob?hmac=${good.hmac}`, { type: 'TRANSACTION', obj: good.obj });
  assert.equal(paid.status, 200, paid.text);
  assert.equal(paid.body.ok, true);
  [[order]] = await pool.query('SELECT status, transaction_id, subscriber_id FROM orders WHERE id=?', [ORDER]);
  assert.equal(String(order.status).toLowerCase(), 'paid');
  assert.equal(order.transaction_id, '9900001');
  const [[enrolment]] = await pool.query(
    'SELECT e.status, e.entitlement_source FROM enrollments e JOIN subscribers s ON s.id=e.subscriber_id WHERE e.tenant_id=? AND e.course_id=? AND s.email=?',
    [TENANT, COURSE, EMAIL]);
  assert.ok(enrolment, 'the course was opened for the payer');
  assert.equal(enrolment.entitlement_source, 'paymob_order');

  // Paymob retries: nothing is charged or opened twice.
  const again = await call('POST', `/api/webhooks/paymob?hmac=${good.hmac}`, { type: 'TRANSACTION', obj: good.obj });
  assert.equal(again.status, 200);
  const [payments] = await pool.query('SELECT id FROM payments WHERE tenant_id=? AND transaction_id=?', [TENANT, '9900001']);
  assert.equal(payments.length, 1);
});
