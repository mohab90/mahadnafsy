'use strict';

// A branch manager's «الموظفين» is their branch's employees.
//
// نشوى runs the Dokki branch and her data scope says so: her clients, her
// money, her leads and her orders are all filtered to Dokki by the routes
// that serve them. The staff list was not — it answered every employee of
// every branch to anyone holding view_staff, and manage_staff let her rewrite
// any of them, including another branch's.
//
// Scoped here the same way the other lists are: branch:X sees that branch,
// plus the reader's own row, which is theirs wherever it sits. 'all' is
// unchanged, and so is the owner.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'api', 'routes', 'staff.js'), 'utf8');
const between = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

test('the list is filtered to the reader\'s branch', () => {
  const handler = between("router.get('/api/admin/staff'", 'router.get(\'/api/staff/me\'');
  assert.ok(handler.includes('staffBranchScope(req)'), 'the list must ask for the reader\'s branch');
  assert.ok(/s\.branch_id\s*=\s*\?/.test(handler), 'the branch has to reach the query');
  assert.ok(handler.includes('s.id=?'), 'the reader\'s own row belongs to them wherever it sits');
});

test('a branch manager may not write outside their branch', () => {
  const handler = between("router.post('/api/admin/staff'", "router.get('/api/admin/staff'");
  assert.ok(handler.includes('staffBranchScope(req)'), 'the write must ask for the reader\'s branch');
  assert.ok(/OUTSIDE_YOUR_BRANCH/.test(handler), 'a refusal outside the branch needs a code of its own');
  assert.ok(handler.includes('existingStaff.branch_id'), 'the check is against the row being rewritten');
  assert.ok(/isSelf/.test(handler),
    'their own row is theirs wherever it is filed — the list says the same, and a manager filed elsewhere could otherwise not edit themselves');
  assert.ok(handler.includes('SELECT id, tenant_id, role, permissions_json, data_scope, branch_id FROM staff'),
    'branch_id has to be read before it can be compared');
});

test('the branch comes from the same data scope every other list uses', () => {
  const { resolveDataScope } = require('../constants/permissions');
  const helper = between('function staffBranchScope', '\n}\n');
  assert.ok(helper.includes('resolveDataScope('), 'one reading of the scope, not a second rule');
  assert.ok(helper.includes('branchIdForBranch('), 'branch:DAQQI is branch-daqqi in the column');
  // The owner and anyone scoped to everything are untouched.
  assert.equal(resolveDataScope({ role: 'manager' }, { isSuperAdmin: true, fallback: 'all' }), 'all');
  assert.equal(resolveDataScope({ role: 'daqqi_manager', data_scope: 'branch:DAQQI' }, { fallback: 'all' }), 'branch:DAQQI');
});
