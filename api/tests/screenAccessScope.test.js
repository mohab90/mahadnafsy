'use strict';
// The panel's gate for a screen (admin/lib/access.ts canOpenTab) reads the account's permissions AND the scope the server will answer it in. The lab's role sweep
// (tools/lab/sweep-roles.cjs, 7 Nov 2026) found screens the gate opened for accounts whose data the server then refused; each is held here, with the gate bundled by esbuild.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
let gate = null;
try {
  const esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild'));
  const out = esbuild.buildSync({
    stdin: { contents: "export { viewerOf, canOpenTab, can } from './lib/access';", resolveDir: path.join(ROOT, 'admin'), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  gate = module.exports;
} catch { /* the admin's dependencies are not installed here */ }
const skip = gate ? false : 'the admin\'s dependencies are not installed';
const viewer = (role, extra = {}) => gate.viewerOf({ isAdmin: false, role, ...extra });

test('a Dokki employee is not offered Tagamoa\'s screens, and the manager of both is', { skip }, () => {
  for (const tab of ['tagamoa_schedule', 'tagamoa_clients', 'tagamoa_team', 'tagamoa_stats', 'tagamoa_accounting']) {
    assert.equal(gate.canOpenTab(viewer('reception_daqqi'), tab), false, `reception_daqqi / ${tab}`);
    assert.equal(gate.canOpenTab(viewer('daqqi_manager'), tab), false, `daqqi_manager / ${tab}`);
  }
  assert.equal(gate.canOpenTab(viewer('reception_daqqi'), 'daqqi_schedule'), true, 'their own branch stays open');
  assert.equal(gate.canOpenTab(viewer('reception_tagamoa'), 'tagamoa_schedule'), true);
  assert.equal(gate.canOpenTab(gate.viewerOf({ isAdmin: true, role: 'admin' }), 'tagamoa_stats'), true);
});

test('the recurring expenses are the books\' screen: an account that sees only its own clients is not offered it', { skip }, () => {
  assert.equal(gate.canOpenTab(viewer('collection'), 'recurring_expenses'), false, 'collection sees its own clients\' money');
  assert.equal(gate.canOpenTab(viewer('accountant'), 'recurring_expenses'), true, 'the accountant reads the company\'s books');
  assert.equal(gate.canOpenTab(viewer('collection', { dataScope: 'all' }), 'recurring_expenses'), true, 'a grid that gives it the whole scope opens it');
  assert.equal(gate.canOpenTab(gate.viewerOf({ isAdmin: true, role: 'admin' }), 'recurring_expenses'), true);
});
