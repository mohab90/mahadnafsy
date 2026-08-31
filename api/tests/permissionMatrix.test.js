'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'tools', 'permission-matrix-scan.mjs')));

test('route, button/tab and permission registries form a closed matrix', async () => {
  const tool = await load();
  const result = tool.scanPermissionMatrix();
  assert.deepEqual(result.unguardedStaffRoutes, []);
  assert.deepEqual(result.unknownRoutePermissions, []);
  assert.deepEqual(result.unmappedTabs, []);
  assert.deepEqual(result.unknownTabPermissions, []);
  assert.deepEqual(result.permissionRegistryDrift, []);
});

// "0 violations" is only worth as much as the number of routes it was measured
// over, and that number silently fell out of the scan twice over:
//
//   • the route pattern was anchored on /api/(admin|staff)/, so a staff route
//     mounted anywhere else was never examined — POST
//     /api/messaging/channels/:id/test carried requireAdminOrStaff and no
//     permission at all, and the matrix reported closed;
//   • guards hoisted into a shared array and spread in (`...view`) contain no
//     literal `requireAdminOrStaff` at the call site, hiding 63 more.
//
// Between them the scan looked at 328 of 392 staff routes while claiming to
// have looked at all of them. A floor on the count is what makes that visible:
// re-anchoring the regex or dropping spread expansion drops it by ~64 and fails
// here, instead of quietly narrowing the net and still printing zero.
test('the scan still examines every staff route, not just the conveniently named ones', async () => {
  const tool = await load();
  const result = tool.scanPermissionMatrix();
  assert.ok(
    result.staffRoutesExamined >= 390,
    `only ${result.staffRoutesExamined} staff routes examined — coverage narrowed, so "0 violations" no longer means the matrix is closed`,
  );
});

// The same failure had already happened on the other half, and shipped.
//
// unmappedTabs is tabKeys.filter(key => !mappedTabs.has(key)), so it reports
// nothing when tabKeys is empty. The union is captured up to the first `;`, and
// the merged-menu refactor introduced a comment containing prose punctuation
// immediately under `export type TabKey =` — the capture stopped inside the
// comment. The scan went to 0 tabs, kept printing 0 violations, and the check
// that every dashboard tab names a permission had been off ever since.
//
// Nothing had actually slipped through, which is precisely why it went
// unnoticed: a dead check and a passing check look identical from the outside.
test('the tab half of the matrix is reading tabs at all', async () => {
  const tool = await load();
  const result = tool.scanPermissionMatrix();
  assert.ok(
    result.tabCount >= 90,
    `only ${result.tabCount} dashboard tabs parsed — the TabKey union stopped being readable, so unmappedTabs can no longer report anything`,
  );
});
