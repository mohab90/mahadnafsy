'use strict';

// One «إعدادات» on a screen, and «إنشاء تاب» inside it.
//
// The staff-built tabs drew a gear of their own beside their strip, halfway
// down the page: العملاء المحتملين carried two settings buttons, and the one
// that creates a tab was the one nobody expects. Reported as «في 2 زر اعدادات
// ليه ؟؟ خلي زر انشاء تاب داخل الاعدادات الاصليه».
//
// So the page owns the dialog and offers it in the menu it already has, and
// the strip only draws the tabs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the tab strip draws no gear when the page owns the settings', () => {
  const strip = read('admin/pages/dashboard/tabs/SectionCustomTabs.tsx');
  assert.ok(strip.includes('pageOwnsSettings'), 'the strip must know when the page owns the dialog');
  assert.match(strip, /isAdmin && !pageOwnsSettings && \(/, 'its own gear must be conditional');
  assert.ok(strip.includes('settingsOpen') && strip.includes('onSettingsOpenChange'),
    'the page needs a way to open the dialog');
});

test('every screen that shows the strip passes its own settings through', () => {
  for (const [file, opener] of [
    ['admin/pages/dashboard/tabs/LeadsTab.tsx', 'onOpenSectionTabs'],
    ['admin/pages/dashboard/tabs/OnlineClientsTab.tsx', 'onOpenSectionTabs'],
  ]) {
    const source = read(file);
    assert.ok(source.includes('settingsOpen={showSectionTabs}'), `${file}: the strip still owns its own dialog`);
    assert.ok(source.includes(opener), `${file}: nothing in the screen's menu opens the tabs dialog`);
  }
});

test('the menus carry the entry', () => {
  const header = read('admin/pages/dashboard/tabs/leads/LeadsTabHeader.tsx');
  assert.ok(header.includes('تابات القسم'), 'the CRM settings menu lost the entry');
  assert.ok(header.includes('onOpenSectionTabs'), 'and the callback that opens it');
  const bar = read('admin/pages/dashboard/tabs/online-clients-sections/ViewTabsBar.tsx');
  assert.ok(bar.includes('تابات القسم'), 'the online/Dokki settings menu lost the entry');
});
