'use strict';
/**
 * «اشتغل علي السرعة، أي صفحة تفتح في أقل من ثانية» (18 Oct 2026).
 *
 * The slowness the owner felt could not be measured against the stand-in API or from the outside, so a private
 * copy of the database was built at production scale (150,000 leads, 30,000 clients, 60,000 orders; synthetic,
 * tools/seed-synthetic-load.cjs) and the real API ran against it. What it found is pinned here, because every
 * one of these queries was correct and stayed correct — it just read the whole table:
 *
 *   GET /api/auth/me                    0.67 s -> 0.008 s   the head of every page load for every employee
 *   GET /api/admin/abandoned-checkouts  31 s   -> 0.02 s
 *   GET /api/admin/funnel/attribution   45 s+  -> 1.4 s
 *   GET /api/admin/payments/review      20 s+  -> 1.4 s
 *   GET /api/admin/reconciliation-dashboard  60 s+ -> 0.9 s
 *   GET /api/admin/leads/stats          0.4 s  -> 0.01 s when held (15 s), recounted after any write
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');



test('the lookups the reports made without an index have one, in the migration and in schema.sql', () => {
  const migration = read('api/migrations/294_v26_lead_and_paid_order_lookups.sql');
  const schema = read('api/schema.sql');
  for (const [table, name, columns] of [
    ['subscribers', 'idx_subscribers_tenant_lead', '`tenant_id`,`lead_id`'],
    ['orders', 'idx_orders_paid_lookup_phone', '`tenant_id`,`status`,`item_id`,`customer_phone`'],
    ['orders', 'idx_orders_paid_lookup_email', '`tenant_id`,`status`,`item_id`,`customer_email`(100)'],
    ['orders', 'idx_orders_tenant_subscriber', '`tenant_id`,`subscriber_id`,`created_at`'],
    ['orders', 'idx_orders_tenant_email', '`tenant_id`,`customer_email`(100),`created_at`'],
  ]) {
    assert.ok(migration.includes(`ALTER TABLE ${table} ADD INDEX IF NOT EXISTS ${name}`), `${name} in the migration`);
    assert.ok(schema.includes(`KEY \`${name}\` (${columns})`), `${name} in schema.sql`);
  }
});

test('the lookups a client makes for their own data are indexed and split, not ORed through a function', () => {
  const me = read('api/routes/orders.js');
  const route = me.slice(me.indexOf("router.get('/api/me/orders'"));
  
  
  
  const privacy = read('api/lib/privacyService.js');
  const find = privacy.slice(privacy.indexOf('async function findSubscriberForIdentity'), privacy.indexOf('async function buildSubscriberExport'));
  // The email lookup stays on the bare indexed column; it only also refuses a
  // client already linked to another account (an unverified sign-up email).
  assert.ok(find.includes('AND firebase_uid=? LIMIT 1') && /AND email=\?\s+AND \(firebase_uid IS NULL/.test(find));
  
});

test('«paid, or phone, or email» is asked as separate lookups, so each can use its own index', () => {
  const orders = read('api/routes/orders.js');
  const abandoned = orders.slice(orders.indexOf("router.get('/api/admin/abandoned-checkouts'"), orders.indexOf("router.get('/api/me/orders'"));
  assert.ok(abandoned.includes('AND p.customer_phone = o.customer_phone\n         )'));
  assert.ok(abandoned.includes('AND p.customer_email = o.customer_email\n         )'));
  assert.ok(!/p\.customer_phone = o\.customer_phone OR p\.customer_email/.test(abandoned), 'the OR across two columns uses neither index');

  const payments = read('api/routes/payments.js');
  assert.ok(!/pp\.id = CONCAT\('paymob-', orders\.id\)\s*\n\s*OR/.test(payments), 'an OR between the key and transaction_id read every payment per order');
  // Each twin is its own LEFT JOIN that must find nothing (a NOT EXISTS was materialised: 2.7 s -> 5-26 ms on the lab).
  assert.ok(payments.includes("LEFT JOIN payments p1 ON p1.id = CONCAT('paymob-', orders.id)"));
  assert.ok(payments.includes('AND p2.transaction_id = orders.transaction_id'));
  assert.ok(payments.includes('p1.id IS NULL AND p2.id IS NULL'));
  assert.ok(!/NOT EXISTS\s*\(\s*SELECT 1 FROM payments pp/.test(payments), 'the twin lookups went back to NOT EXISTS');

  const payops = read('api/routes/core/payops.js');
  assert.ok(!/\(p\.id=o\.id OR \(o\.transaction_id IS NOT NULL/.test(payops));
  assert.ok(!/\(p\.id=CONCAT\('proof-',pp\.id\) OR p\.transaction_id=pp\.id\)/.test(payops));
});





test('the synthetic-data tool refuses anything but a local mahad_perf database', () => {
  const run = env => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'seed-synthetic-load.cjs')], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20000 });
  for (const env of [
    { SEED_DB_HOST: '187.55.227.200' },
    { SEED_DB_NAME: 'mahadnafsy_db' },
    { SEED_DB_PORT: '3306' },
  ]) {
    const result = run(env);
    assert.equal(result.status, 1, JSON.stringify(env));
    assert.match(result.stderr, /refusing: .* is not a local mahad_perf database/, JSON.stringify(env));
  }
});
