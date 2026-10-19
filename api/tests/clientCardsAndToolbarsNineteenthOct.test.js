'use strict';

// «تصميم كارت العميل ضعيف لازم نظهر اسماء الكورسات اللي حجزها ودفع كام في كل كورس وباقي كام … وزر اتصال بيفتح تواصل
// اتوماتك دا غلط … الفلاتر اتنظمت غلط … لما نفتح نسخه الموبايل اي ارقام او احصائيات بتظهر في اعلي الصفحه الغيها …
// الفلتر في طلبات الانضمام خليه كله في صف واحد … انا لا احب هدر المساحات» (19 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sections = 'admin/pages/dashboard/tabs/online-clients-sections';

test('the client card names each course with what was paid and what is left, and the round, certificate and follow-up under them', () => {
  const card = read(`${sections}/ClientCard.tsx`);
  // One line per course: its name, «باقي …» or «✓ مسدّد», a bar and «دفع X من Y».
  assert.match(card, /title=\{course\.label\}>\{course\.label\}<\/p>/);
  assert.match(card, /باقي \{money\(course\.remaining, course\.currency\)\}/);
  assert.match(card, /دفع \{money\(course\.paid, course\.currency\)\}/);
  assert.match(card, /COURSES_SHOWN = 3/);
  // The Dokki round, the follow-up date, the next instalment and the certificate are chips, not behind «⋯».
  assert.match(card, /\{housing && \(/);
  assert.match(card, /\{followUp && <span/);
  assert.match(card, /\{nextInstallment && <span/);
  assert.match(card, /\{certificates\}/);
  const table = read(`${sections}/ClientsTable.tsx`);
  assert.match(table, /housing=\{isDaqqiClientsTab \? \(rowHousing \?/);
  assert.match(table, /غير مسكّن/);
});

test('a call is a plain call: it does not open the contact log on its own', () => {
  const card = read(`${sections}/ClientCard.tsx`);
  assert.doesNotMatch(card, /onCall/);
  assert.match(card, /href=\{`tel:\$\{row\.phone\}`\} title="اتصال"/);
  assert.doesNotMatch(read(`${sections}/ClientsTable.tsx`), /onCall=/);
});

test('the toolbar: the filters, then the follow-ups, then — after a gap — the switch and the columns side by side', () => {
  const bar = read(`${sections}/FiltersToolbar.tsx`);
  const order = [
    bar.indexOf('placeholder="بحث اسم / هاتف..."'),
    bar.indexOf('aria-label="المتابعات"'),
    bar.indexOf('ms-auto flex flex-wrap items-center gap-1.5'),
  ];
  assert.ok(order.every(position => position > 0) && order[0] < order[1] && order[1] < order[2], order.join(' < '));
  assert.match(bar, /\{viewToggle\}\s*<ColumnsMenu/);
  // On a phone: the search and one «فلاتر» button, the dropdowns behind it, and no «متابعات» word on the chips.
  assert.match(bar, /<SlidersHorizontal size=\{13\} \/> فلاتر/);
  assert.match(bar, /hidden md:inline">متابعات /);
});

test('on a phone the numbers above the clients are not drawn', () => {
  assert.match(read('admin/pages/dashboard/tabs/OnlineClientsKpiStrip.tsx'), /className="mb-3 hidden flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-2\.5 md:flex xl:flex-row"/);
  assert.match(read('admin/pages/dashboard/tabs/daqqi/DaqqiOverviewStrip.tsx'), /className="hidden grid-cols-2 gap-2 md:grid sm:grid-cols-3 xl:grid-cols-6"/);
});

test('the join-request filters are one row, and the jobs card is one line until it is opened', () => {
  const board = read('admin/pages/dashboard/tabs/join-us/ApplicationsBoard.tsx');
  assert.match(board, /md:\[&_select\]:max-w-\[170px\] md:\[&_select\]:flex-1 md:\[&_select\]:shrink/);
  const jobs = read('admin/pages/dashboard/tabs/JobPostingsPanel.tsx');
  assert.match(jobs, /getItem\('joinus\.jobsOpen'\) === '1'/, 'folded by default, and remembered');
  assert.match(jobs, /\{open && \(loading \?/);
});

test('the clients of one scope are read once for a few seconds, not once per page and per summary', () => {
  const route = read('api/routes/admin/stafflists.js');
  assert.match(route, /cached\(`figures:staff-scope:\$\{tenantId\}:\$\{sc\.where\}:\$\{JSON\.stringify\(sc\.params\)\}`, 15 \* 1000, \(\) => readScopeClients\(tenantId, sc\)\)/);
});
