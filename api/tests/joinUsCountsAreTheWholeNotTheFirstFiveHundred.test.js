'use strict';
/**
 * «عدد طلبات انضمام الموظفين مكتوب 427 وفي مكان تاني 1285 محتاجين مراجعه» (16 Oct 2026).
 * GET /api/admin/join-us stopped at the newest 500 rows and each screen counted what reached it.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const routes = read('api/routes/admin-operations.js');

test('the list pages instead of stopping at 500, and its counts use the same scope', () => {
  assert.match(routes, /function joinUsWhere\(req\)/);
  const list = routes.slice(routes.indexOf("router.get('/api/admin/join-us', "));
  assert.match(list, /const \{ where, params \} = joinUsWhere\(req\)/);
  assert.match(list, /Math\.min\(1000, Math\.max\(1, Math\.floor\(Number\(req\.query\.limit\)\) \|\| 500\)\)/);
  assert.match(list, /ORDER BY j\.created_at DESC, j\.id DESC LIMIT \$\{limit\} OFFSET \$\{offset\}/, 'a stable order, so pages do not repeat or skip');
  const counts = routes.slice(routes.indexOf("'/api/admin/join-us/counts'"), routes.indexOf("router.get('/api/admin/join-us', "));
  assert.match(counts, /joinUsWhere\(req\)/, 'a count is of exactly the rows the list would hold');
  assert.match(counts, /GROUP BY form, status/);
  assert.match(counts, /requireRecruiting\('view_join_us'\)/, 'behind the same permission as the list');
});

test('the admin loads every page and the tab shows the server\'s count, saying so when it holds fewer', () => {
  const api = read('admin/lib/mysqlapi.ts');
  assert.match(api, /listAllJoinUs:\s+\(\) => allPages\('\/admin\/join-us', 1000\)/);
  assert.match(api, /async function allPages[\s\S]*?if \(rows\.length < pageSize\) break;/);
  assert.match(api, /joinUsCounts:\s+\(\) => apiFetch<[\s\S]*?'\/admin\/join-us\/counts'/);
  // The applications page no longer holds the table to count it: the figures are the database's, by form and
  // status, over the page's own scope (the ones not yet moved to the interviews).
  assert.match(api, /joinUsInboxCounts:\s+\(form: 'staff' \| 'teaching'\) =>[\s\S]*?`\/admin\/join-us\/counts\?inbox=1&form=\$\{form\}`/);
  const tab = read('admin/pages/dashboard/tabs/JoinUsAdminTab.tsx');
  assert.match(tab, /mysqlAdmin\.joinUsInboxCounts\(group\)/);
  assert.match(tab, /counts\?\.byFormStatus\[group\]/);
  assert.doesNotMatch(tab, /joinUsApplications|reloadJoinUsApplications/, 'the page does not pull the whole table');
});
