'use strict';
/**
 * «فى حسابات الموظفين زى خدمة العملاء ونشوى الايقونات كتير محتاجين نرتبهم داخل قوائم فى المنيو
 * الاساسى» (15 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nav = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'DashboardNavigation.tsx'), 'utf8');
const bar = key => {
  const start = nav.indexOf(key);
  return nav.slice(start, nav.indexOf('activeTab={activeTab} setActiveTab={setActiveTab}', start));
};

test('a role bar can hold named menus, on the desktop bar and in the phone menu', () => {
  assert.match(nav, /type CompactGroup = \{ group: string; label: string;/);
  assert.match(nav, /function BarGroup\(/);
  assert.match(nav, /<BarGroup key=\{tab\.group\}/);
  assert.match(nav, /tab\.items\.map\(item =>/, 'the phone menu lists a group under its heading');
});

test('customer service, the Dokki manager and the sales & collection manager keep their main tabs and fold the rest', () => {
  const countTop = chunk => (chunk.match(/^ {18}\{ (key|group):/gm) || []).length;
  const support = bar('isSupport && (');
  assert.ok(countTop(support) <= 7, `customer service shows ${countTop(support)} entries on the bar`);
  assert.match(support, /group: 'clients'[\s\S]*group: 'services'[\s\S]*group: 'quality'/);
  const dokki = bar('isDaqqiManager && !isAdmin && (');
  assert.ok(countTop(dokki) <= 7, `the Dokki manager shows ${countTop(dokki)} entries`);
  assert.match(dokki, /group: 'branch'[\s\S]*group: 'people'/);
  const sales = bar('isSalesCollectionManager && !isAdmin && (');
  assert.ok(countTop(sales) <= 7, `the sales & collection manager shows ${countTop(sales)} entries`);
});
