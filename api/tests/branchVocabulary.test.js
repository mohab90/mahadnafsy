'use strict';

// The four lists that name a branch have to agree.
//
// There are five sources for what a branch is: the `branches` table (which the
// payment dialogs read through /api/branches), the alias map and two id maps in
// api/lib/branches.js, VALID_BRANCHES in api/constants/permissions.js, and the
// admin's own enum. The table holds seven branches and the code knows six.
//
// The extra one, «الفرع الإداري - طنطا», is internal_only=1, so listBranches
// filters it out and no dialog offers it — checked on production, nothing is
// misfiled today. But flip that column and every record on it is filed as
// `branch-other` in silence: gone from every branch filter, its money in the
// wrong bucket, nothing anywhere saying so.
//
// This test cannot see the table. What it can do is make the four lists in the
// code agree with each other, so adding a branch is one change that either
// lands everywhere or fails here.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const { BRANCH_ALIASES, branchIdForBranch, branchForId, normalizeBranch } =
  require('../lib/branches');
const { VALID_BRANCHES } = require('../constants/permissions');

test('the alias map, the id maps and the permission set name the same branches', () => {
  const fromAliases = new Set(Object.values(BRANCH_ALIASES));
  const fromPermissions = new Set(VALID_BRANCHES);

  // The id maps, read out of the source — they are local objects.
  const src = read('api/lib/branches.js');
  const idMap = /function branchIdForBranch[\s\S]*?const map = \{([\s\S]*?)\};/.exec(src)[1];
  const fromIdMap = new Set([...idMap.matchAll(/^\s*([A-Z_]+):/gm)].map(m => m[1]));
  const backMap = /function branchForId[\s\S]*?const map = \{([\s\S]*?)\};/.exec(src)[1];
  const fromBackMap = new Set([...backMap.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]));

  const sorted = set => [...set].sort();
  assert.deepEqual(sorted(fromIdMap), sorted(fromPermissions),
    'branchIdForBranch and VALID_BRANCHES disagree about which branches exist');
  assert.deepEqual(sorted(fromBackMap), sorted(fromPermissions),
    'branchForId and VALID_BRANCHES disagree');
  for (const branch of fromPermissions) {
    assert.ok(fromAliases.has(branch),
      `${branch} is a valid branch that no alias resolves to — normalizeBranch would return null for it`);
  }
});

test('every branch survives the round trip through both id maps', () => {
  for (const branch of VALID_BRANCHES) {
    const id = branchIdForBranch(branch);
    assert.notEqual(id, undefined, `${branch} has no branch id`);
    assert.equal(branchForId(id), branch,
      `${branch} → ${id} → ${branchForId(id)} — the two maps are not inverses`);
  }
});

test('a branch the code cannot name is filed under the fallback, and says so', () => {
  // The silent version of this is the bug: a record vanishing from every branch
  // filter with nothing written down.
  assert.equal(normalizeBranch('tanta_admin'), null, 'the premise: the enum cannot name it');
  assert.equal(branchIdForBranch('tanta_admin'), 'branch-other', 'the fallback is still the safe answer');

  const src = read('api/lib/branches.js');
  assert.match(src, /logger\.warn\('\[branches\] no branch id for this branch/);
  // And an empty value is not a mystery worth logging — it is just absent.
  assert.match(src, /if \(raw\) \{/);
  assert.equal(branchIdForBranch(''), 'branch-other');
  assert.equal(branchIdForBranch(null), 'branch-other');
});

test('the admin enum matches the API', () => {
  const adminSrc = read('admin/constants/branches.ts');
  const listed = /export const BRANCHES = \[([\s\S]*?)\] as const;/.exec(adminSrc)[1];
  const adminBranches = [...listed.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(adminBranches, [...VALID_BRANCHES].sort(),
    'the admin and the API disagree about which branches exist');

  // And every one of them has an Arabic label, or a filter renders `undefined`.
  const labels = /BRANCH_LABELS_AR: Record<BranchKey, string> = \{([\s\S]*?)\};/.exec(adminSrc)[1];
  for (const branch of adminBranches) {
    assert.match(labels, new RegExp(`${branch}:`), `${branch} has no Arabic label`);
  }
});
