'use strict';

// «البحث في السيستم كله … بيطلع نتايج مختلفة في العملاء المحتملين وقاعده العملاء
// والاونلاين والدقي … لما اكتب اول حرفين يظهر» (7 Oct 2026). Measured on
// production the same day: «احمد» found 577 leads and «أحمد» 205 — 786 people
// either way; «01012» found 107 of 263, the rest stored without the 0.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { foldText, searchNumber } = require('../lib/searchText');
const { leadTableSearch } = require('../lib/leadTableFilter');

const ROOT = path.join(__dirname, '..', '..');
function load(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const panel = load('admin/lib/clientSearch.ts');

const person = { name: 'أسماء أحمد', phone: '1012345678', email: 'asmaa@x.test', code: 'C141762', nationalId: '29801011234567' };

test('the panel finds a person by any spelling of the name, the code, and the number with or without its 0', { skip: !panel }, () => {
  for (const query of ['احمد', 'أحمد', 'اسماء', 'C1417', '141762', '0101234', '101234', '٠١٠١٢٣', 'asmaa']) {
    assert.ok(panel.matchesSearch(query, person), query);
  }
  for (const query of ['محمود', '0109', 'zzz']) assert.ok(!panel.matchesSearch(query, person), query);
  assert.ok(panel.matchesSearch('ا', { name: 'x' }), 'under two characters nothing is filtered');
});

test('the server reads the box the same way', () => {
  assert.equal(foldText('أحمد'), 'احمد');
  assert.equal(foldText('هالة  مُصطفى'), 'هاله مصطفي');
  assert.deepEqual(searchNumber('0101234'), { digits: '0101234', core: '101234' });
  assert.equal(searchNumber('احمد 12'), null, 'a name with digits is not a number');
  assert.equal(leadTableSearch('ا'), null);
  const search = leadTableSearch('أحمد');
  assert.ok(search.params.every(param => param === '%احمد%'));
  assert.match(search.sql, /client_code/);
  assert.deepEqual(leadTableSearch('0101234').params.slice(-1), ['%101234%']);
});

test('the panel and the server fold alike', { skip: !panel }, () => {
  for (const text of ['أحمد', 'هالة مُصطفى', 'إسراء ٠١٠', 'آية', 'مؤمن', 'فائزة']) {
    assert.equal(panel.foldText(text), foldText(text), text);
  }
});
