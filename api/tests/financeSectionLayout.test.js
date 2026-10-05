'use strict';
/**
 * قسم الحسابات: six headings instead of eleven buttons, every screen still one
 * level in and opened by its own address, and the period statement listed under
 * التقارير. Reads the admin sources.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const tabs = read('admin/pages/dashboard/tabs/financial/FinancialSubTabs.tsx');
const utils = read('admin/pages/dashboard/tabs/financial/financialTabUtils.ts');
const screen = read('admin/pages/dashboard/tabs/FinancialTab.tsx');

test('six headings, and every screen of FinancialSubTab sits under exactly one', () => {
  const headings = [...tabs.matchAll(/\n    id: '([a-z]+)',\n    label: '([^']+)'/g)].map(m => m[2]);
  assert.deepEqual(headings, ['الملخص', 'الفلوس الداخلة', 'الفلوس الخارجة', 'المديونيات', 'الخزائن والدفاتر', 'التقارير']);
  const declared = utils.match(/export type FinancialSubTab =([\s\S]*?);/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  const listed = [...tabs.matchAll(/\['([a-z_]+)', '[^']+', [A-Za-z0-9]+\]/g)].map(m => m[1]);
  assert.deepEqual([...listed].sort(), [...declared].sort());
  assert.equal(new Set(listed).size, listed.length);
});

test('the screen is in the address, and a branch cannot open a company screen by link', () => {
  assert.match(screen, /navigate\(`\/dashboard\/\$\{routeTab\}\/\$\{value\}`\)/);
  assert.match(screen, /\(!branchFilter \|\| BRANCH_SUB_TABS\.includes\(screen as FinancialSubTab\)\)/);
  assert.match(utils, /'statement', 'boxes', 'orders'/);
});

test('the statement is drawn, and a Tagamoa book is not labelled Dokki', () => {
  assert.match(screen, /financialSubTab === 'statement' && <FinancialStatementPanel/);
  assert.match(screen, /const branchName = branchFilter === 'tagamoa' \? 'التجمع' : 'الدقي'/);
  assert.doesNotMatch(screen, /محاسبة فرع الدقي فقط/);
  assert.match(read('admin/pages/dashboard/tabs/financial/FinancialStatementPanel.tsx'), /\/admin\/finance\/statement\?/);
});
