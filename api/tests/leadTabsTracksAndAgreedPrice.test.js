'use strict';
// Four reports from the leads screens on 27 September:
//   «محلي جديد» and «دولي جديد» said «غير موزّع: 262» above an empty table;
//   a track (مسار) on a lead could not be removed;
//   adding «مسار المعالج» showed other tracks with it;
//   «لما بحدد سعر معين للكورس مش بيتثبت بعد كدا للعميل».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('a tab whose filters hide its pool says so, with a way to show it all', () => {
  const tab = read('admin/pages/dashboard/tabs/leads/ArchiveTab.tsx');
  assert.match(tab, /const hiddenByFilters = poolLeads\.length - archiveLeads\.length;/);
  assert.match(tab, /\{hiddenByFilters > 0 && \(/);
  assert.match(tab, /onClick=\{onShowAll\}/);
  // The leads screen clears the filter bar and the workspace branch for it.
  assert.match(read('admin/pages/dashboard/tabs/LeadsTab.tsx'),
    /onShowAll=\{\(\) => \{ clearLeadFilters\(\); setBranchFilter\(null\); \}\}/);
});

test('a track is kept as itself, one badge with its own ×, never guessed from its courses', () => {
  const table = read('admin/pages/dashboard/tabs/LeadTable.tsx');
  // The guess: every track whose courses happened to be in the list.
  assert.doesNotMatch(table, /completeBundles/);
  assert.doesNotMatch(table, /bnd\.courses\.map\(c => c\.id\)/);
  assert.match(table, /\{interestedCourseIds\.map\(cid => \{/);
  assert.match(table, /const next = \[\.\.\.new Set\(\[\.\.\.interestedCourseIds, e\.target\.value\]\)\];/);

  const quick = read('admin/pages/dashboard/tabs/leads/QuickEditPanel.tsx');
  assert.match(quick, /const keys = \[`bundle:\$\{b\.id\}`, b\.id\];/);
  assert.match(quick, /: \[\.\.\.\(d\.interestedCourseIds \|\| \[\]\), `bundle:\$\{b\.id\}`\],/);
});

test('a single-course payment records the price agreed, not the catalogue', () => {
  const handlers = read('admin/pages/dashboard/dashboardPaymentHandlers.ts');
  assert.match(handlers, /const _singleCustom = Number\(subPayDraft\.customExpected\) \|\| 0;/);
  assert.match(handlers, /const _singleExpected = _singleCustom > 0\n\s+\? _singleCustom/);
});

test('the payment dialog opens at the price this client agreed', () => {
  const modal = read('admin/components/PaymentModal.tsx');
  // The one rule every screen uses (admin/lib/agreedPrice.ts).
  assert.match(modal, /const _agreedPx = d\.courseId \? agreedPriceFor\(subject, d\.courseId, 0, d\.currency\) : 0;/);
  assert.match(read('admin/lib/agreedPrice.ts'), /subscriber\.customPrices\?\.\[item\]/);
  assert.match(modal, /const _basePx = _agreedPx > 0 \? _agreedPx : _sysPx;/);
  // A new course booking is priced by its branch tier instead (lib/catalogPricing.ts).
  assert.match(modal, /Math\.round\(_basePx \* \(1 - _discPct \/ 100\)\) : _basePx\)\);/);
});

test('the «المتابعات» badge counts follow-ups due by today, once, and fits its number', () => {
  const strip = read('admin/pages/dashboard/tabs/leads/LeadSubTabs.tsx');
  assert.match(strip, /const alertCount = overdueCount;/);
  assert.doesNotMatch(strip, /rottenCount|dueTodayCount/);
  assert.match(strip, /min-w-3\.5 items-center justify-center rounded-full bg-red-500 px-1/);
  assert.doesNotMatch(read('admin/pages/dashboard/tabs/LeadsTab.tsx'), /rottenCount=/);
});
