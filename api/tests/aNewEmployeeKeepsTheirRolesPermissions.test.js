'use strict';

// An employee on their role's defaults is not an employee with nothing.
//
// permissions_json NULL means "whatever the role grants"; a stored list, the
// empty one included, is an override meaning exactly that list. The staff list
// sends NULL through as null and the panel falls back to the role. GET
// /api/staff/me sent it as [] — an override meaning none — and that is the
// answer the panel uses for everyone who cannot read the staff list, which is
// every role without view_staff: sales, collection, support, reception.
//
// So a new employee signed in, was refused every permission their role grants,
// and no screen opened. Reported after خلود created an account from «الموارد
// البشرية»: «بيكون بلا اي صلاحيات ومش بيفتح اي صفحه».
//
// The same confusion on the way in: a create form that mentions no permissions
// must store NULL, not an empty list.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the two readings of an employee agree', () => {
  const staff = read('api/routes/staff.js');
  const me = staff.slice(staff.indexOf("router.get('/api/staff/me'"), staff.indexOf("router.patch('/api/staff/me'"));
  assert.ok(me.includes('r.permissions_json ? tryJson(r.permissions_json, []) : null'),
    'GET /api/staff/me must send null for NULL, the way the list does');
  assert.ok(!/permissions: r\.permissions_json \? tryJson\(r\.permissions_json, \[\]\) : \[\]/.test(me),
    'an empty list here locks the employee out of everything');
});

test('null is the role, [] is nothing — and the server and the panel agree', () => {
  // The server reads the column, the panel reads the field the API sends. Both
  // have to answer the same, or an employee works through the API and sees
  // nothing on screen — which is the failure this file is about.
  const server = require('../constants/permissions');
  const roleDefaults = server.resolvePermissions({ role: 'sales' });
  assert.ok(Array.isArray(roleDefaults) && roleDefaults.includes('view_dashboard'), 'sales must have its own defaults');
  assert.deepEqual(server.resolvePermissions({ role: 'sales', permissions_json: null }), roleDefaults, 'NULL → the role');
  assert.deepEqual(server.resolvePermissions({ role: 'sales', permissions_json: '[]' }), [], '[] → nothing, deliberately');

  const js = require('node:module')
    .stripTypeScriptTypes(read('admin/constants/permissions.ts'))
    .replace(/^export /gm, '');
  const box = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', js + '\nmodule.exports = { resolvePermissions };')(box, box.exports);
  const panel = box.exports.resolvePermissions;
  assert.deepEqual(panel({ role: 'sales' }), roleDefaults, 'absent → the role, as on the server');
  assert.deepEqual(panel({ role: 'sales', permissions: null }), roleDefaults, 'null → the role');
  assert.deepEqual(panel({ role: 'sales', permissions: [] }), [], '[] → nothing, as on the server');
});

test('creating an employee without choosing permissions leaves them on their role', () => {
  for (const file of [
    'admin/pages/dashboard/tabs/HRTab.tsx',
    'admin/pages/dashboard/tabs/hr-sections/RecruitmentPipelinePanel.tsx',
  ]) {
    const source = read(file);
    assert.ok(!source.includes('permissions: result.permissions || undefined'),
      `${file}: an empty list is truthy, so "nothing chosen" is stored as "nothing allowed"`);
    assert.ok(source.includes('permissions: result.permissions?.length ? result.permissions : undefined'),
      `${file}: nothing chosen must reach the API as undefined`);
  }
});
