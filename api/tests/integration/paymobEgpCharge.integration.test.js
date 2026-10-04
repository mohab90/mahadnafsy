'use strict';
/**
 * Paymob Egypt charges in EGP only, so a SAR order is sent to it in EGP at the
 * day's rate (routes/public-orders.js paymobCharge). The rate is fixed on the
 * order the first time, so a retried checkout asks for the same figure; with
 * no fresh rate the checkout is refused rather than charged at a guess.
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
const TENANT = 'tenant-paymob-egp-it';
let pool; let paymobCharge; let setTenantSetting; let invalidateFxCache;

async function clean() {
  await pool.query('DELETE FROM orders WHERE tenant_id=?', [TENANT]).catch(() => {});
  await pool.query('DELETE FROM tenant_settings WHERE tenant_id=?', [TENANT]).catch(() => {});
  await pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
}
async function rates(sar, updatedAt = new Date().toISOString()) {
  await setTenantSetting('content', {
    'exchange.sar_to_egp': String(sar), 'exchange.usd_to_egp': '48', 'exchange.source': 'test', 'exchange.updated_at': updatedAt,
  }, { tenantId: TENANT });
  invalidateFxCache(TENANT);
}
async function order(id, amount, currency) {
  await pool.query(
    "INSERT INTO orders (id, tenant_id, item_id, item_title, type, status, amount, currency, customer_name, customer_email, customer_phone) VALUES (?, ?, 'c1', 'كورس', 'course', 'pending', ?, ?, 'عميلة', 'c@example.test', '1012000009')",
    [id, TENANT, amount, currency]);
  const [[row]] = await pool.query('SELECT amount, currency, charge_amount, charge_currency FROM orders WHERE id=?', [id]);
  return row;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ _paymobCharge: paymobCharge } = require('../../routes/public-orders'));
  ({ setTenantSetting } = require('../../lib/tenantSettings'));
  ({ invalidateFxCache } = require('../../lib/finance'));
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Paymob EGP IT', 'suspended')", [TENANT, TENANT]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('an EGP order is charged as it is', { skip }, async () => {
  assert.deepEqual(await paymobCharge('egp-1', TENANT, await order('egp-1', 1500, 'EGP')), { amount: 1500, currency: 'EGP' });
});

test('a SAR order is charged in EGP at the day\'s rate, and a retry asks for the same figure', { skip }, async () => {
  await rates(13.25);
  const first = await paymobCharge('sar-1', TENANT, await order('sar-1', 95, 'SAR'));
  assert.deepEqual(first, { amount: 1258.75, currency: 'EGP' });
  const [[stored]] = await pool.query('SELECT amount, currency, charge_amount, charge_currency, charge_fx_rate FROM orders WHERE id=?', ['sar-1']);
  assert.equal(Number(stored.amount), 95, 'the order keeps the customer\'s price');
  assert.equal(stored.currency, 'SAR');
  assert.equal(Number(stored.charge_amount), 1258.75);
  assert.equal(Number(stored.charge_fx_rate), 13.25);

  await rates(14);
  assert.deepEqual(await paymobCharge('sar-1', TENANT, stored), first, 'the rate moved; the order\'s charge did not');
});

test('with no fresh rate the checkout is refused, not charged at a guess', { skip }, async () => {
  await rates(13, new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString());
  assert.equal(await paymobCharge('sar-2', TENANT, await order('sar-2', 50, 'SAR')), null);
});
