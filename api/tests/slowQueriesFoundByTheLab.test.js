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

test('/auth/me looks the phone up by the column, not by LOWER(TRIM()) of it', () => {
  const me = read('api/routes/auth/session.js');
  const route = me.slice(me.indexOf("router.get('/api/auth/me'"));
  assert.ok(route.includes("FROM subscribers WHERE tenant_id=? AND email=? AND phone IS NOT NULL"));
  assert.ok(route.includes("FROM leads WHERE tenant_id=? AND email=? AND phone IS NOT NULL"));
  // The staff lookup beside them reads a table of a few dozen rows; the two big tables are the point.
  assert.ok(!/FROM (subscribers|leads) WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)/.test(route), 'a function around the column scans every lead on every page load');
});

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
  assert.ok(route.includes('UNION ALL'));
  assert.ok(route.includes('o.subscriber_id IS NULL AND o.customer_email=?'));
  assert.ok(!/LOWER\(TRIM\(o\.customer_email\)\)/.test(route), 'a function around the column reads every order');
  const privacy = read('api/lib/privacyService.js');
  const find = privacy.slice(privacy.indexOf('async function findSubscriberForIdentity'), privacy.indexOf('async function buildSubscriberExport'));
  // The email lookup stays on the bare indexed column; it only also refuses a
  // client already linked to another account (an unverified sign-up email).
  assert.ok(find.includes('AND firebase_uid=? LIMIT 1') && /AND email=\?\s+AND \(firebase_uid IS NULL/.test(find));
  assert.ok(!/LOWER\(TRIM\(email\)\)/.test(find), 'uid OR a wrapped email used neither index');
});

test('«paid, or phone, or email» is asked as separate lookups, so each can use its own index', () => {
  const orders = read('api/routes/orders.js');
  const abandoned = orders.slice(orders.indexOf("router.get('/api/admin/abandoned-checkouts'"), orders.indexOf("router.get('/api/me/orders'"));
  assert.ok(abandoned.includes('AND p.customer_phone = o.customer_phone\n         )'));
  assert.ok(abandoned.includes('AND p.customer_email = o.customer_email\n         )'));
  assert.ok(!/p\.customer_phone = o\.customer_phone OR p\.customer_email/.test(abandoned), 'the OR across two columns uses neither index');

  const payments = read('api/routes/payments.js');
  assert.ok(!/pp\.id = CONCAT\('paymob-', orders\.id\)\s*\n\s*OR/.test(payments), 'an OR between the key and transaction_id read every payment per order');
  assert.ok(payments.includes("AND pp.id = CONCAT('paymob-', orders.id)"));
  assert.ok(payments.includes('AND pp.transaction_id = orders.transaction_id'));

  const payops = read('api/routes/core/payops.js');
  assert.ok(!/\(p\.id=o\.id OR \(o\.transaction_id IS NOT NULL/.test(payops));
  assert.ok(!/\(p\.id=CONCAT\('proof-',pp\.id\) OR p\.transaction_id=pp\.id\)/.test(payops));
});

test('«converted lead without a client» is NOT A AND NOT B AND NOT C, and the count is not a derived table', () => {
  const checks = read('api/lib/reconcileChecks.js');
  const predicate = checks.slice(checks.indexOf('const LIVE_SUBSCRIBER_FOR_LEAD'), checks.indexOf('const CHECKS'));
  assert.ok(predicate.includes('(NOT (NOT EXISTS (SELECT 1 FROM subscribers s'), 'one negation around three anti-joins');
  assert.ok((predicate.match(/\bAND NOT /g) || []).length >= 2);
  assert.ok(!/\)\s*\n\s*OR \(l\./.test(predicate), 'NOT (A OR B OR C) over three EXISTS ran for minutes');
  const payops = read('api/routes/core/payops.js');
  assert.ok(payops.includes("population.replace(/^\\s*SELECT[\\s\\S]*?\\sFROM\\s/i, 'SELECT COUNT(*) AS n FROM ')"));
  assert.ok(payops.includes('/\\b(GROUP BY|HAVING|DISTINCT|UNION)\\b/i.test(population)'), 'a grouped check still goes through the wrapper');
});

test('the panel counters are held for 15 s and dropped by the first successful write', () => {
  const stats = read('api/routes/admin/leads/stats.js');
  assert.ok(stats.includes("const { cached } = require('../../../lib/db');"));
  assert.ok(stats.includes('const key = `figures:leads-stats:${req.tenantId}:${scopeClause}:${JSON.stringify(params)}`;'), 'one entry per tenant and scope');
  assert.ok(stats.includes('await cached(key, 15 * 1000, async () => {'));
  assert.ok(stats.includes('res.json(payload);'));
  assert.ok(stats.includes('cached(`figures:followups-due:'), 'the header bell, on every page, is held too');
  assert.ok(read('api/routes/analytics/dashboard.js').includes('cached(`figures:revenue:'), 'the first figure of the landing screen is held too');
  const app = read('api/lib/httpApp.js');
  assert.ok(app.includes("cacheInvalidateLocal('figures:')"), 'this process only: fifteen seconds is not worth an insert per write');
  assert.ok(app.includes('res.statusCode < 400'), 'a failed write changed nothing');
  assert.ok(app.includes("req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS'"));
  assert.ok(/app\.use\(timeRequests\);\n\s*app\.use\(dropFiguresAfterWrites\);/.test(app), 'registered before any route can answer');
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
