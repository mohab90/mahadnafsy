'use strict';

// «الداشبورد بيحمل ٢٧ ألف ليد» (21 Oct 2026): every save called reloadLeads(), which downloaded the whole lead table
// (27k rows, six pages) whatever the session held — usually the 500-row page, or nothing at all once the leads screen
// stopped holding a list. A reload now fetches what is held: the whole table only after a screen pulled the whole
// table, the first page when one asked for a page, and nothing (just the announcement the server-paged screens answer)
// when no screen holds the list. The same for the clients.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function bundle(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const rows = bundle('admin/context/site-data-hooks/crmRows.ts');
const skip = rows ? false : 'admin dependencies (esbuild) not installed';

test('a reload fetches the whole table, a page or nothing, by what is held', { skip }, () => {
  assert.equal(rows.heldRowsOf(true, 27000), 'whole');
  assert.equal(rows.heldRowsOf(true, 0), 'whole', 'a whole table that came back empty is still the whole table');
  assert.equal(rows.heldRowsOf(false, 500), 'page');
  assert.equal(rows.heldRowsOf(false, 0), 'none');
});

test('a page of clients is laid over the clients held, newest first', { skip }, () => {
  const held = [{ id: 'branch-old', createdAt: '2024-01-01' }, { id: 'a', createdAt: '2026-01-01', name: 'old' }];
  const merged = rows.mergeSubscribers(held, [{ id: 'a', createdAt: '2026-01-01', name: 'new' }, { id: 'b', createdAt: '2026-05-01' }]);
  assert.deepEqual(merged.map(row => row.id), ['b', 'a', 'branch-old']);
  assert.equal(merged.find(row => row.id === 'a').name, 'new');
  assert.deepEqual(rows.normalizeLeads([{ id: 'x', status: 'NEW' }, { id: 'y' }]).map(lead => lead.status), ['new', 'new']);
});

test('the reloads ask what is held before they fetch, and the full loads say when they hold the table', () => {
  const core = read('admin/context/site-data-hooks/useCrmCoreState.ts');
  assert.match(core, /const held = heldRowsOf\(wholeTablesRef\.current\.leads, leadsRef\.current\.length\);/);
  assert.match(core, /held === 'whole' \? await mysqlAdmin\.listAllLeads\(\) : await mysqlAdmin\.listLeadsPage\(500, 0\)/);
  assert.match(core, /const held = heldRowsOf\(wholeTablesRef\.current\.subscribers, subscribersRef\.current\.length\);/);
  assert.match(core, /held === 'whole' \? await mysqlAdmin\.listAllSubscribers\(\) : await mysqlAdmin\.listSubscribersPage\(500, 0\)/);
  // Nothing in the hook downloads a whole table without asking first.
  assert.equal((core.match(/listAllLeads\(/g) || []).length, 1);
  assert.equal((core.match(/listAllSubscribers\(/g) || []).length, 1);
  const runtime = read('admin/context/site-data-hooks/useAdminDataRuntime.ts');
  assert.match(runtime, /wholeTablesRef\.current\.leads = true;/);
  assert.match(runtime, /wholeTablesRef\.current\.subscribers = true;/);
  const context = read('admin/context/SiteDataContext.tsx');
  assert.match(context, /const wholeTablesRef = useRef<WholeTables>\(\{ leads: false, subscribers: false \}\);/);
});
