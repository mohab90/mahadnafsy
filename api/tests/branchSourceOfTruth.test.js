'use strict';
// The branch dropdown must be fed from the branches table, not a content key.
//
// The booking dialog parsed content['institute.branches'] and that key does not
// exist on the live tenant, so instituteBranches was an empty array and the
// select rendered with only its placeholder — while the field is drawn as
// required, in red. A lead with no branch could not be given one, and 61 leads
// have no branch.
//
// It failed silently by construction: JSON.parse of a missing key with a '[]'
// default is a valid empty list, so there is no error to notice. The same
// dialog opened from other screens had a full list, because those screens use
// hooks/useBranches — whose own comment says the content fallback "is why the
// branch dropdown was empty in some places and differed in others".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', 'admin', ...rel.split('/')), 'utf8');
const derived = read('pages/dashboard/useDashboardDerived.ts');
const dashboard = read('pages/Dashboard.tsx');
const hook = read('hooks/useBranches.ts');

test('the dashboard feeds its branch list from the branches table', () => {
  // The hook that reads the table has to be the source, and it has to reach
  // the derived-state hook that the payment dialog's branchOptions comes from.
  assert.match(dashboard, /import \{ useBranches \} from '\.\.\/hooks\/useBranches'/);
  assert.match(dashboard, /const branchesFromTable = useBranches\(\)/);
  assert.match(dashboard, /useDashboardDerived\(content, notifications, branchesFromTable\)/);
});

test('the table wins over the content key, which stays only as a fallback', () => {
  assert.match(derived, /branchesFromTable: BranchEntry\[\] = \[\]/);
  // Order matters: the table is consulted first, and the content parse is only
  // reached when it is empty. Reversed, a stale content key would win.
  const body = derived.slice(derived.indexOf('const instituteBranches'));
  const tableFirst = body.indexOf('branchesFromTable.length');
  const contentAfter = body.indexOf("content['institute.branches']");
  assert.ok(tableFirst > -1 && contentAfter > -1, 'both sources should still be present');
  assert.ok(tableFirst < contentAfter, 'the content key is being consulted before the table');
});

test('useBranches still reads the table it is named for', () => {
  assert.match(hook, /mysqlCatalog\.listBranches\(\)/);
  assert.match(hook, /branch_key/);
  // If this ever returns the content list first, the fix above is undone
  // without touching any of the files it edits.
  assert.match(hook, /return fetched\.length \? fetched : fromContent;/);
});
