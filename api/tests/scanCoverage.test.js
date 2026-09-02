'use strict';
// A scan that says zero has to say zero out of what.
//
// This is the single failure mode that hid the most in this codebase. The
// permission matrix reported a closed matrix while examining 328 of 392 routes,
// and its other half reported zero violations while reading zero tabs — that
// one shipped. The reconciliation dashboard reported its page size as a count,
// hiding 5,983 failed customer messages behind the number 100. In every case
// the output was indistinguishable from a healthy one.
//
// So the guards themselves are guarded: each reports what it examined, and each
// is asserted to have examined a plausible amount. A regex that stops matching,
// a walk() that starts throwing, an exemption list that grows too broad — all
// of them turn a real check into a green light, and all of them show up here as
// a number falling through the floor rather than as silence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const tool = name => import(pathToFileURL(path.join(__dirname, '..', '..', 'tools', name)));

test('the permission matrix examines every staff route and every tab', async () => {
  const { scanPermissionMatrix } = await tool('permission-matrix-scan.mjs');
  const result = scanPermissionMatrix();
  assert.ok(result.staffRoutesExamined >= 390,
    `${result.staffRoutesExamined} staff routes examined`);
  assert.ok(result.tabCount >= 90, `${result.tabCount} dashboard tabs parsed`);
});

test('the public rate-limit scan is looking at public routes', async () => {
  const { scanPublicRateLimitDetail } = await tool('public-rate-limit-scan.mjs');
  const { examined, violations } = scanPublicRateLimitDetail();
  assert.ok(examined >= 50, `only ${examined} public routes examined — the scan lost its subjects`);
  assert.deepEqual(violations, []);
});

test('the bulk rate-limit scan is looking at bulk routes', async () => {
  const { scanBulkRateLimitDetail } = await tool('bulk-rate-limit-scan.mjs');
  const { examined, violations } = scanBulkRateLimitDetail();
  assert.ok(examined >= 12, `only ${examined} bulk/export routes examined`);
  assert.deepEqual(violations, []);
});

test('the notification tenant scan is finding the calls it checks', async () => {
  const { scanNotificationTenantDetail } = await tool('notification-tenant-scan.mjs');
  const { examined, violations } = scanNotificationTenantDetail();
  assert.ok(examined >= 30, `only ${examined} createNotification calls found — the extractor broke`);
  assert.deepEqual(violations, []);
});

test('the index-defeat scan is reading the source tree', async () => {
  const { scanIndexDefeatDetail } = await tool('index-defeat-scan.mjs');
  const { filesScanned, hits } = scanIndexDefeatDetail();
  assert.ok(filesScanned >= 150, `only ${filesScanned} files scanned`);
  assert.deepEqual(hits, []);
});

test('the query-filter scan is indexing GET routes', async () => {
  const { scanQueryFilterDrops } = await tool('query-filter-drop-scan.mjs');
  const { routesIndexed, drops } = scanQueryFilterDrops();
  assert.ok(routesIndexed >= 300, `only ${routesIndexed} GET routes indexed`);
  assert.deepEqual(drops, []);
});

test('the tenant-scope scan is tracking the tenant tables', async () => {
  const { scanTenantViolations } = await tool('tenant-scope-scan.mjs');
  const { tenantTableCount } = scanTenantViolations();
  assert.ok(tenantTableCount >= 150, `only ${tenantTableCount} tenant-scoped tables tracked`);
});
