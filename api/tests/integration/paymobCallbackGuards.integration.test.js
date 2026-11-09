'use strict';
/**
 * What a signed Paymob callback may and may not do, through the real app on a real MariaDB (these were regular expressions over routes/public-orders.js and
 * lib/paymobFinalise.js — `paymobSuccess`, `capture.amountCents !== expectedCents`, `amountMismatch`/`currencyMismatch`, `ORDER_ALREADY_PAID`, «always fetch bundle
 * courses from DB»): a declined transaction credits nothing; a capture of less than the order, or in another currency, credits nothing and the order stays pending;
 * a path opens the courses the database says it holds, whatever the browser put in the order; and an order that is paid cannot be reserved back to pending.
 * Runs only with DB_* (or TEST_DB_*).
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
const T = 'tenant-paymob-guards-it';
const SECRET = 'paymob-guards-it-hmac-secret';
let pool; let server; let base; let txn = 9910000;

const TABLES = ['journal_entry_lines', 'journal_entries', 'payment_audit_log', 'financial_audit_log', 'finance_outbox', 'message_outbox', 'outbox', 'crm_commissions',
  'entitlement_events', 'enrollments', 'payments', 'orders', 'subscribers', 'lead_events', 'leads', 'bundle_courses', 'bundles', 'courses', 'tenant_settings', 'job_queue'];
async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of TABLES) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': T }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

function signed(orderId, charged, overrides = {}) {
  txn += 1;
  const obj = {
    id: txn, amount_cents: Math.round(charged * 100), created_at: '2026-10-21T10:00:00', currency: 'EGP', error_occured: false,
    has_parent_transaction: false, integration_id: 1, is_3d_secure: true, is_auth: false, is_capture: false,
    is_refunded: false, is_standalone_payment: true, is_voided: false, owner: 1, pending: false, success: true,
    order: { id: 78000 + (txn % 1000), merchant_order_id: `${orderId}~1729500000000` },
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    ...overrides,
  };
  const { buildPaymobHmacPayload } = require('../../lib/paymobHmac');
  return { obj, hmac: crypto.createHmac('sha512', SECRET).update(buildPaymobHmacPayload(obj)).digest('hex') };
}
const callback = ({ obj, hmac }) => call('POST', `/api/webhooks/paymob?hmac=${hmac}`, { type: 'TRANSACTION', obj });

async function reserve(orderId, type, itemId, email, extra = {}) {
  const quote = await call('POST', '/api/public/price-quote', { itemType: type, itemId, payMode: 'cash', currency: 'EGP' });
  assert.equal(quote.status, 200, quote.text);
  const res = await call('POST', '/api/orders/reserve', {
    orderId, type, itemId, itemTitle: 'عنصر', amount: quote.body.dueNow, currency: 'EGP', customerName: 'طالبة', customerEmail: email, customerPhone: '01011113333', ...extra,
  });
  assert.equal(res.status, 200, res.text);
  return quote.body.dueNow;
}
const status = async id => String((await pool.query('SELECT status FROM orders WHERE id=?', [id]))[0][0].status).toLowerCase();
const credited = async id => (await pool.query('SELECT id FROM payments WHERE tenant_id=? AND id=?', [T, `paymob-${id}`]))[0].length;
const opened = async email => (await pool.query(
  'SELECT e.course_id FROM enrollments e JOIN subscribers s ON s.id=e.subscriber_id WHERE e.tenant_id=? AND s.email=? ORDER BY e.course_id', [T, email]))[0].map(row => row.course_id);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Paymob guards IT', 'active')", [T, T]);
  for (const [id, price] of [['co-pg-1', 1500], ['co-pg-2', 1000], ['co-pg-3', 900]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
       VALUES (?, ?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', ?, 1)`, [id, T, `${id}-it`, id, price]);
  }
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description, price_egp, is_published) VALUES ('bu-pg-1', ?, 'مسار', '', 2000, 1)", [T]);
  await pool.query("INSERT INTO bundle_courses (tenant_id, bundle_id, course_id) VALUES (?, 'bu-pg-1', 'co-pg-1'), (?, 'bu-pg-1', 'co-pg-2')", [T, T]);
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await setTenantSetting('sys_payment_gateway', { active_provider: 'paymob', paymob: { enabled: true, hmac_secret: SECRET } }, { tenantId: T });
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

test('a declined transaction, a partial capture and a capture in another currency credit nothing and open nothing', { skip }, async () => {
  const email = 'declined-pg@example.test';
  const due = await reserve('ord-pg-a', 'course', 'co-pg-1', email);

  await callback(signed('ord-pg-a', due, { success: false }));
  assert.deepEqual([await status('ord-pg-a'), await credited('ord-pg-a'), (await opened(email)).length], ['pending', 0, 0], 'declined');

  await callback(signed('ord-pg-a', due / 2));
  assert.deepEqual([await status('ord-pg-a'), await credited('ord-pg-a'), (await opened(email)).length], ['pending', 0, 0], 'half of the price was captured');

  await callback(signed('ord-pg-a', due, { currency: 'USD' }));
  assert.deepEqual([await status('ord-pg-a'), await credited('ord-pg-a'), (await opened(email)).length], ['pending', 0, 0], 'captured in dollars');

  const right = await callback(signed('ord-pg-a', due));
  assert.equal(right.body.ok, true, right.text);
  assert.deepEqual([await status('ord-pg-a'), await credited('ord-pg-a'), await opened(email)], ['paid', 1, ['co-pg-1']], 'the right capture pays it');
});

test('a path opens the courses the database says it holds, whatever the browser put in the order', { skip }, async () => {
  const email = 'bundle-pg@example.test';
  const due = await reserve('ord-pg-b', 'bundle', 'bu-pg-1', email, { bundleCourseIds: ['co-pg-3', 'co-pg-1'] });
  const res = await callback(signed('ord-pg-b', due));
  assert.equal(res.body.ok, true, res.text);
  assert.equal(await status('ord-pg-b'), 'paid');
  assert.deepEqual(await opened(email), ['co-pg-1', 'co-pg-2'], 'the path\'s two courses, not the one the browser added');
});

test('an order that is paid is not reserved back to pending, and a repeated callback credits it once', { skip }, async () => {
  const again = await call('POST', '/api/orders/reserve', {
    orderId: 'ord-pg-b', type: 'bundle', itemId: 'bu-pg-1', itemTitle: 'عنصر', amount: 1700, currency: 'EGP', customerName: 'طالبة', customerEmail: 'bundle-pg@example.test', customerPhone: '01011113333',
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'ORDER_ALREADY_PAID');
  assert.equal(await status('ord-pg-b'), 'paid');
  const retried = await callback(signed('ord-pg-b', 1700));
  assert.equal(retried.status, 200);
  assert.equal(await credited('ord-pg-b'), 1);
});
