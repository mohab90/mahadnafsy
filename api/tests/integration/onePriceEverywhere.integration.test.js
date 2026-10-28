'use strict';
/**
 * The price the site shows is the price charged (lib/effectivePrice.js): the
 * public price list, the quote with a code, and POST /api/orders/reserve all
 * read the marketing discount and the promo code from the same settings.
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
const TENANT = 'tenant-money-it';
let pool; let ordersRouter; let pricingRouter;

const handler = (router, path, method = 'post') => {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  return layer.route.stack.at(-1).handle;
};
async function call(router, path, body = {}, method = 'post') {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  await handler(router, path, method)({ body, tenantId: TENANT, headers: {}, ip: '127.0.0.1', socket: {}, get: () => undefined }, res);
  return res;
}
const reserve = body => call(ordersRouter, '/api/orders/reserve', {
  type: 'course', itemId: 'co-money-1', itemTitle: 'كورس', currency: 'EGP', customerName: 'عميلة', ...body,
});

async function clean() {
  for (const table of ['orders', 'promo_codes', 'courses', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  // The gateway is switched on for this tenant only in this test.
  const saas = require('../../lib/saasSettings');
  const file = require.resolve('../../lib/saasSettings');
  require.cache[file].exports = { ...saas, getPaymentGatewaySettings: async () => ({}), isPaymobActive: () => true };
  ordersRouter = require('../../routes/public-orders');
  pricingRouter = require('../../routes/public-pricing');
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Money IT', 'suspended')", [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp, price_sar, is_published)
     VALUES ('co-money-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 3600, 450, 1)`, [TENANT]);
  await setTenantSetting('discounts', [
    { id: 'd1', type: 'course', targetId: 'co-money-1', discountPercent: 22, active: true, label: 'خصم العيد' },
    { id: 'd2', type: 'course', targetId: 'co-money-1', discountPercent: 40, active: true, promoCode: 'BIG40' },
  ], { tenantId: TENANT });
  await setTenantSetting('content', { 'enroll.cashDiscountPercent': '10' }, { tenantId: TENANT });
  await pool.query(
    `INSERT INTO promo_codes (id, tenant_id, code, discount_type, discount_value, max_uses, active)
     VALUES ('pc-money-1', ?, 'ONCE50', 'percent', 50, 1, 1)`, [TENANT]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the public price list shows the discounted price the course page and the card both read', { skip }, async () => {
  const res = await call(pricingRouter, '/api/public/prices', {}, 'get');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const entry = res.body.items['course:co-money-1'];
  assert.deepEqual([entry.EGP.base, entry.EGP.price, entry.EGP.discount.source], [3600, 2808, 'rule']);
  assert.equal(entry.SAR.price, 351);
  assert.equal(entry.USD, undefined, 'no dollar price, nothing to show');
});

test('reserve charges the discounted price for paying in full, and refuses the base price and anything lower', { skip }, async () => {
  const due = Math.round(2808 * 0.9);
  const lower = await reserve({ orderId: 'o-money-low', amount: due - 100 });
  assert.equal(lower.body?.code, 'PRICE_MISMATCH');
  assert.equal(lower.body.expected, due);
  const base = await reserve({ orderId: 'o-money-base', amount: 3600 });
  assert.equal(base.body?.code, 'PRICE_MISMATCH', 'the undiscounted price is not what the page showed');
  const ok = await reserve({ orderId: 'o-money-ok', amount: due });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const [[row]] = await pool.query('SELECT amount, coupon_code FROM orders WHERE id=? AND tenant_id=?', ['o-money-ok', TENANT]);
  assert.deepEqual([Number(row.amount), row.coupon_code], [due, null]);
});

test('a code is quoted and charged by the same rule, and its uses are counted from paid orders', { skip }, async () => {
  const quote = await call(pricingRouter, '/api/public/price-quote', { itemType: 'course', itemId: 'co-money-1', promoCode: 'big40', currency: 'EGP' });
  assert.equal(quote.statusCode, 200, JSON.stringify(quote.body));
  assert.deepEqual([quote.body.price, quote.body.dueNow, quote.body.discount.code], [2160, 1944, 'BIG40']);
  const coded = await reserve({ orderId: 'o-money-code', amount: 1944, promoCode: 'BIG40' });
  assert.equal(coded.statusCode, 200, JSON.stringify(coded.body));
  const [[row]] = await pool.query('SELECT amount, coupon_code FROM orders WHERE id=? AND tenant_id=?', ['o-money-code', TENANT]);
  assert.deepEqual([Number(row.amount), row.coupon_code], [1944, 'BIG40']);
  const bad = await reserve({ orderId: 'o-money-bad', amount: 1000, promoCode: 'NOSUCH' });
  assert.equal(bad.body?.code, 'PROMO_INVALID');

  // ONCE50 may be used once: a paid order carrying it spends it.
  const once = await reserve({ orderId: 'o-money-once', amount: 1620, promoCode: 'ONCE50' });
  assert.equal(once.statusCode, 200, JSON.stringify(once.body));
  await pool.query("UPDATE orders SET status='paid' WHERE id='o-money-once' AND tenant_id=?", [TENANT]);
  const again = await reserve({ orderId: 'o-money-once-2', amount: 1620, promoCode: 'ONCE50' });
  assert.equal(again.body?.code, 'PROMO_INVALID');
});
