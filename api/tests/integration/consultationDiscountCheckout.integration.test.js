'use strict';
/**
 * A consultation is charged the price the site shows: the discount marketing
 * aimed at consultations (lib/effectivePrice.js) comes off the doctor's fee in
 * the price list, the quote and the checkout order — and a course rule does not.
 * Against a real MariaDB; runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-product-consult-it';
let pool; let pricing; let checkout;

const handler = (router, path, method) => router.stack.find(item => item.route?.path === path && item.route.methods[method]).route.stack.at(-1).handle;
async function call(router, path, { body = {}, method = 'post', user = null } = {}) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  await handler(router, path, method)({
    body, tenantId: TENANT, headers: {}, ip: '127.0.0.1', socket: {}, get: () => undefined, ...(user ? { user } : {}),
  }, res);
  return res;
}

async function clean() {
  for (const table of ['consultations', 'orders', 'lead_events', 'leads', 'subscribers', 'therapists', 'tenant_settings',
    'notifications', 'client_code_counter']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  pricing = require('../../routes/public-pricing');
  checkout = require('../../routes/lead-capture-crm');
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Consult IT', 'active')", [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO therapists (id, tenant_id, name, specialty, image, experience, rating, price_egp, price_sar, price_usd, is_consultation_enabled, is_active)
     VALUES ('th-pc-1', ?, 'د. سارة', '', '', 5, 5, 1000, 0, 0, 1, 1),
            ('th-pc-2', ?, 'د. أحمد', '', '', 5, 5, 800, 0, 0, 1, 1)`, [TENANT, TENANT]);
  await setTenantSetting('discounts', [
    { id: 'd1', type: 'therapist_consultation', targetId: 'th-pc-1', discountPercent: 20, active: true, label: 'خصم د. سارة' },
    { id: 'd2', type: 'all_courses', discountPercent: 50, active: true },
    { id: 'd3', type: 'all_consultations', discountPercent: 30, active: true, promoCode: 'TALK30' },
  ], { tenantId: TENANT });
  await setTenantSetting('content', { 'enroll.cashDiscountPercent': '10' }, { tenantId: TENANT });
  await pool.query(
    "INSERT INTO subscribers (id, tenant_id, name, phone, branch, firebase_uid) VALUES ('sub-pc-1', ?, 'عميلة', '1016000001', 'ONLINE_EGYPT', 'uid-pc-1')", [TENANT]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the price list shows each doctor\'s session after the consultation discount', { skip }, async () => {
  const res = await call(pricing, '/api/public/prices', { method: 'get' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.items['consultation:th-pc-1'].EGP.price, res.body.items['consultation:th-pc-2'].EGP.price], [800, 800]);
});

test('the quote takes a consultation code, and never a cash rate', { skip }, async () => {
  const res = await call(pricing, '/api/public/price-quote', { body: { itemType: 'consultation', itemId: 'th-pc-2', promoCode: 'talk30', currency: 'EGP' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.price, res.body.dueNow, res.body.discount.code], [560, 560, 'TALK30']);
});

test('checkout charges the discounted session, with or without the code', { skip }, async () => {
  const user = { uid: 'uid-pc-1' };
  const plain = await call(checkout, '/api/public/checkout-intent', { user, body: { itemType: 'consultation', therapistId: 'th-pc-1', customerName: 'عميلة', customerPhone: '01016000001' } });
  assert.equal(plain.statusCode, 200, JSON.stringify(plain.body));
  assert.deepEqual([plain.body.amount, plain.body.basePrice], [800, 1000]);
  const coded = await call(checkout, '/api/public/checkout-intent', { user, body: { itemType: 'consultation', therapistId: 'th-pc-2', customerName: 'عميلة', customerPhone: '01016000001', promoCode: 'TALK30' } });
  assert.equal(coded.statusCode, 200, JSON.stringify(coded.body));
  assert.equal(coded.body.amount, 560);
  const [[order]] = await pool.query('SELECT amount, coupon_code FROM orders WHERE id=? AND tenant_id=?', [coded.body.orderId, TENANT]);
  assert.deepEqual([Number(order.amount), order.coupon_code], [560, 'TALK30']);
  const [[consultation]] = await pool.query('SELECT amount FROM consultations WHERE order_id=? AND tenant_id=?', [coded.body.orderId, TENANT]);
  assert.equal(Number(consultation.amount), 560, 'the desk\'s request carries what is charged');
});
