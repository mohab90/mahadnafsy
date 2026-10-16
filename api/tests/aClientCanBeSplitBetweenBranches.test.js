'use strict';
/**
 * «لو العميل بيحضر كورس اونلاين وكورس حضور محتاجين نقدر نقسم العميل بين الفروع، وفي تحويل جزئي لكورس معين»
 * (15 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

test('every client list reaches a branch by its own clients and by the courses placed there', () => {
  const lists = read('api/routes/admin/stafflists.js');
  assert.doesNotMatch(lists, /s\.branch IN \(\$\{branches\.map/, 'no scope clause reads the client\'s own branch alone');
  assert.ok((lists.match(/ownOrPlaced\(branches\)/g) || []).length >= 4);
  assert.match(lists, /params: \[\.\.\.branches, \.\.\.branches\]/, 'the branch filter binds the list twice');
  assert.ok((lists.match(/coursePlacements: placementsBySub\.get\(r\.id\) \|\| \{\}/g) || []).length >= 5, 'every client list carries the placements');
  assert.match(lists, /router\.put\('\/api\/admin\/subscribers\/:id\/course-branch'/);
});

test('the table lists a split client in both branches, each with its own courses; the modal offers the partial transfer', () => {
  const tab = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  assert.match(tab, /holdsIn\(s, isDokkiHere\)/);
  assert.match(tab, /itemShowsIn\(client, item, hereTest\)/);
  assert.match(read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx'), /itemVisible\(row, item\.item\)/);
  assert.match(read('admin/pages/dashboard/tabs/OnlineClientConvertModal.tsx'), /تحويل كورس معيّن لفرع تاني \(جزئي\)/);
  assert.match(read('admin/components/PaymentModal.tsx'), /subject\.coursePlacements\?\.\[d\.courseId\]/, 'a payment for a placed course is that branch\'s');
});
