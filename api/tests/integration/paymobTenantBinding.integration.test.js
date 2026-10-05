'use strict';
/**
 * A Paymob «paid» callback credits only the orders of the institute whose
 * secret verified it. The order is looked up by id, so an institute with a
 * Paymob account of its own could otherwise sign a callback for another
 * institute's order and have it marked paid with no money behind it.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const A = 'tenant-paymob-a-it';
const B = 'tenant-paymob-b-it';
let pool;

async function clean() {
  for (const t of [A, B]) {
    await pool.query('DELETE FROM orders WHERE tenant_id=?', [t]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id=?', [t]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'A', 'suspended'), (?, ?, 'B', 'suspended')", [A, A, B, B]);
  await pool.query(
    "INSERT INTO orders (id, tenant_id, item_id, item_title, type, status, amount, currency, customer_name, customer_email, customer_phone) VALUES ('ord-b-1', ?, 'c1', 'كورس', 'course', 'PENDING', 900, 'EGP', 'عميلة', 'b@example.test', '1012000010')",
    [B]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test("a callback verified with one institute's secret cannot credit another's order", { skip }, async () => {
  const { finalisePaymobOrder } = require('../../lib/paymobFinalise');
  const result = await finalisePaymobOrder('ord-b-1', 'txn-forged-1', { amountCents: 90000, currency: 'EGP' }, A);
  assert.equal(result.found, false);
  const [[order]] = await pool.query("SELECT status, transaction_id FROM orders WHERE id='ord-b-1'");
  assert.equal(order.status, 'PENDING');
  assert.equal(order.transaction_id, null);
});
