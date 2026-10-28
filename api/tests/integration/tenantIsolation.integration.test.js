'use strict';
/**
 * Tenant isolation as behaviour: two institutes with the same shape of data
 * (tests/integration/support/tenantPair.js), each administrator signed in
 * through POST /api/auth/login on the real app (lib/httpApp.js createHttpApp),
 * and every key read — leads, clients, payments, orders, certificates,
 * tickets, reports, search — answered over HTTP without one row of the other
 * institute. A token from one institute presented to the other is refused.
 *
 * This replaces the keyword checks that read route files for "tenant_id";
 * the quality gate's static scan (tools/mahad-quality-check.mjs) still runs as
 * a separate net. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const { seedTenantPair, cleanTenantPair, signIn, getAs, assertIsolated, SHARED_PHONE } = require('./support/tenantPair');

let pool; let server; let base; let pair; let cookieA; let cookieB;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  pair = await seedTenantPair(pool);
  const { createHttpApp } = require('../../lib/httpApp');
  const app = createHttpApp({ pool, brandAssetRoot: os.tmpdir() });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  cookieA = await signIn(base, pair.a);
  cookieB = await signIn(base, pair.b);
});

after(async () => {
  if (!ENABLED) return;
  if (pair) await cleanTenantPair(pool, pair);
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end().catch(() => {});
});

// The reads both institutes have, each with the row it must show of its own.
const SHARED_READS = [
  { path: '/api/admin/leads', expectOwn: 'LEAD' },
  { path: '/api/admin/leads/table', expectOwn: 'LEAD' },
  { path: '/api/staff/leads', expectOwn: 'LEAD' },
  { path: '/api/admin/subscribers', expectOwn: 'CLIENT' },
  { path: '/api/staff/subscribers', expectOwn: 'CLIENT' },
  { path: '/api/admin/payments', expectOwn: 'PAYMENT' },
  { path: '/api/staff/payments', expectOwn: 'PAYMENT' },
  { path: '/api/admin/orders', expectOwn: 'ORDER' },
  { path: '/api/admin/certificate-requests', expectOwn: 'CERT' },
  { path: '/api/admin/tickets', expectOwn: 'TICKET' },
];

test('the original institute reads only its own leads, clients, money, certificates and tickets', { skip }, async () => {
  await assertIsolated(assert, base, pair.a, pair.b, cookieA, SHARED_READS);
});

test('the second institute reads only its own, through the same endpoints', { skip }, async () => {
  await assertIsolated(assert, base, pair.b, pair.a, cookieB, SHARED_READS);
});

test('reports and search count and find only the original institute\'s rows', { skip }, async () => {
  await assertIsolated(assert, base, pair.a, pair.b, cookieA, [
    { path: '/api/admin/reports/lead-funnel', expectOwn: 'SOURCE' },
    { path: '/api/admin/reports/sales-performance', expectOwn: 'REP' },
    { path: '/api/admin/reports/management' },
    { path: '/api/admin/reports/weekly-branches' },
    { path: '/api/admin/search?q=ISO-', expectOwn: 'CLIENT' },
    { path: `/api/admin/search?q=${SHARED_PHONE}`, expectOwn: 'LEAD' },
  ]);
  // The one lead each tenant filed: a funnel that counted both would say 2.
  const funnel = JSON.parse((await getAs(base, pair.a, cookieA, '/api/admin/reports/lead-funnel')).text);
  const own = funnel.bySource.find(row => row.source === `${pair.a.marker}-SOURCE`);
  assert.equal(Number(own.total), 1);
});

test('the second institute is kept out of the modules not yet scoped by tenant', { skip }, async () => {
  for (const path of ['/api/admin/reports/management', '/api/admin/reports/sales-performance', `/api/admin/search?q=${SHARED_PHONE}`]) {
    const { status, text } = await getAs(base, pair.b, cookieB, path);
    assert.equal(status, 503, `${path}: ${text}`);
    assert.equal(JSON.parse(text).code, 'TENANT_SCOPE_NOT_AVAILABLE');
  }
});

test('a row of the other institute cannot be opened by its id', { skip }, async () => {
  for (const path of [
    `/api/admin/tickets/${pair.b.ids.ticket}`,
    `/api/admin/subscribers/${pair.b.ids.subscriber}/payments`,
    `/api/admin/leads/${pair.b.ids.lead}/timeline`,
    `/api/admin/subscribers/${pair.b.ids.subscriber}/activity`,
    `/api/admin/subscribers/${pair.b.ids.subscriber}/course-access`,
    `/api/staff/subscribers/${pair.b.ids.subscriber}/timeline`,
    `/api/admin/payments/${pair.b.ids.payment}/receipt`,
  ]) {
    const { status, text } = await getAs(base, pair.a, cookieA, path);
    assert.ok(status === 404 || status === 403 || (status === 200 && !text.includes(pair.b.marker)),
      `A GET ${path} → ${status}: ${text.slice(0, 200)}`);
    assert.ok(!text.includes(pair.b.marker), `A GET ${path} shows B's row`);
  }
});

test('a session from one institute is refused by the other', { skip }, async () => {
  // B's cookie sent with A's tenant header: the signed tenant wins, and B's
  // administrator still sees only B.
  const crossed = await getAs(base, pair.a, cookieB, '/api/admin/leads');
  assert.ok(!crossed.text.includes(pair.a.marker), 'the header did not move the session into A');
  // A forged header alone, with no session, opens nothing.
  const anonymous = await fetch(`${base}/api/admin/leads`, { headers: { 'X-Tenant-Id': pair.b.tenantId } });
  assert.equal(anonymous.status, 401);
});
