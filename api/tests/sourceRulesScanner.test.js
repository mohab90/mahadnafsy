'use strict';
/**
 * The scanner behind quality check 29 (tools/source-rules.mjs), run on text it is handed: it flags what a rule forbids, passes what is clean, and
 * the repository's own files hold every rule today.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'tools', 'source-rules.mjs')).href);

test('a forbidden pattern is reported with its rule and file, and clean text passes', async () => {
  const { checkRule } = await load();
  const rule = { id: 'no-x', files: ['a.ts', 'b.ts'], mustNot: [/forbidden\(/], must: [/needed/] };
  const files = { 'a.ts': 'needed; forbidden(1)', 'b.ts': 'needed' };
  const found = checkRule(rule, file => files[file]);
  assert.deepEqual(found.map(item => [item.rule, item.file]), [['no-x', 'a.ts']]);
  files['b.ts'] = 'nothing';
  assert.deepEqual(checkRule(rule, file => files[file]).map(item => [item.file, /does not match/.test(item.detail)]), [['a.ts', false], ['b.ts', true]]);
});

test('the sub-tab rule names a screen the strip never offers', async () => {
  const { RULES, checkRule } = await load();
  const rule = RULES.find(item => item.id === 'every-financial-subtab-can-be-opened');
  const union = `export type FinancialSubTab = ${Array.from({ length: 21 }, (_, i) => `'tab_${String.fromCharCode(97 + i)}'`).join(' | ')};`;
  const strip = Array.from({ length: 20 }, (_, i) => `['tab_${String.fromCharCode(97 + i)}', 'label', Icon]`).join(',\n');
  const found = checkRule(rule, file => (file.endsWith('Utils.ts') ? union : strip));
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /tab_u/);
});

test('every rule holds on the repository as it is', async () => {
  const { scanSourceRules } = await load();
  assert.deepEqual(scanSourceRules(), []);
});
