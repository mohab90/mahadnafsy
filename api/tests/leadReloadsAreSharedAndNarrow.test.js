'use strict';

// The dashboard downloaded every lead (27k rows) after every payment, and the
// same save often asked for it two or three times at once (21 Oct 2026). The
// reloads now share one download, and a payment or a conversion fetches only
// the lead it changed (GET /api/admin/leads?ids=…).

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
const lib = bundle('admin/lib/reloadCoalescing.ts');
const skip = lib ? false : 'admin dependencies (esbuild) not installed';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('calls during a download share one follow-up; a quiet call runs at once', { skip }, async () => {
  const runs = [];
  const reload = lib.coalesce(() => { const d = deferred(); runs.push(d); return d.promise; });
  const first = reload();
  const others = [reload(), reload(), reload()];
  assert.equal(runs.length, 1, 'one download while the first runs');
  assert.equal(others[0], others[2], 'every caller meanwhile shares the follow-up');
  runs[0].resolve();
  await first;
  await new Promise(r => setImmediate(r));
  assert.equal(runs.length, 2, 'exactly one follow-up, started after the first ended');
  runs[1].resolve();
  await Promise.all(others);
  reload();
  assert.equal(runs.length, 3, 'nothing running: a new call starts straight away');
  runs[2].resolve();
});

test('a failed download does not wedge the next one', { skip }, async () => {
  let n = 0;
  const reload = lib.coalesce(async () => { n += 1; if (n === 1) throw new Error('offline'); });
  await assert.rejects(reload());
  await reload();
  assert.equal(n, 2);
});

test('fetched rows replace theirs, new ones go on top, vanished ones leave', { skip }, () => {
  const current = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }];
  const next = lib.patchRowsById(current, [{ id: 'b', v: 2 }, { id: 'n', v: 2 }], ['b', 'c', 'n']);
  assert.deepEqual(next, [{ id: 'n', v: 2 }, { id: 'a', v: 1 }, { id: 'b', v: 2 }]);
});

test('a payment and a conversion refresh their own lead, not the table', () => {
  const handler = read('admin/pages/dashboard/dashboardPaymentHandlers.ts');
  assert.match(handler, /reloadLeads\(\{ only: \[freshLead\.id\] \}\)/);
  assert.doesNotMatch(handler, /reloadLeads\(\)/);
  assert.match(read('admin/pages/unified-client/useUnifiedClientPayments.ts'), /await reloadLeads\(\{ only: \[lead\.id\] \}\);/);
  assert.match(read('admin/pages/unified-client/useUnifiedClientLifecycleActions.ts'), /reloadLeads\(\{ only: \[lead\.id\] \}\)/);
  assert.match(read('admin/pages/dashboard/tabs/leads/useLeadActions.ts'), /reloadLeads\(\{ only: \[lead\.id\] \}\)/);
  assert.match(read('admin/lib/mysqlapi.ts'), /listLeadsByIds: .*\/admin\/leads\?limit=100&ids=/s);
  const route = read('api/routes/admin/leads/lists.js');
  assert.match(route, /sql \+= ' AND l\.id IN \(\?\)'/);
});
