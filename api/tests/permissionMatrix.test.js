'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('route, button/tab and permission registries form a closed matrix', async () => {
  const tool = await import(pathToFileURL(path.join(__dirname, '..', '..', 'tools', 'permission-matrix-scan.mjs')));
  const result = tool.scanPermissionMatrix();
  assert.deepEqual(result.unguardedStaffRoutes, []);
  assert.deepEqual(result.unknownRoutePermissions, []);
  assert.deepEqual(result.unmappedTabs, []);
  assert.deepEqual(result.unknownTabPermissions, []);
  assert.deepEqual(result.permissionRegistryDrift, []);
});
