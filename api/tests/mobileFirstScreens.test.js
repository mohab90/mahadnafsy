'use strict';
/**
 * «ريسبونسيف للموبايل بشكل قوي جدا … عرض العملاء على الموبايل بنظام البايبلان هو الأساسي مش الجدول … كل صفحات
 * الجداول على الموبايل مش ريسبونسيف ابدا» (17 Oct 2026).
 *
 * The layouts are decided in the browser, so what is pinned here is the wiring: which screen is the default on a
 * phone, that the card shows real call / WhatsApp buttons, and that the tables have their phone rules.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const tabs = 'admin/pages/dashboard/tabs';

test('a phone is told apart by the media query the md: classes use', () => {
  const hook = read('admin/hooks/useIsMobile.ts');
  assert.match(hook, /\(max-width: 767px\)/);
  assert.match(hook, /useSyncExternalStore\(subscribe, isMobileNow, \(\) => false\)/);
});

test('on a phone the leads open on the pipeline, the clients on cards; a link that names a tab still wins', () => {
  const subTab = read(`${tabs}/leads/useLeadSubTab.ts`);
  assert.match(subTab, /searchParams\.get\('tab'\) as SubTabKey\) \|\| \(isMobileNow\(\) \? 'pipeline' : 'table'\)/);
  const clients = read(`${tabs}/OnlineClientsTab.tsx`);
  assert.match(clients, /return isMobileNow\(\) \? 'cards' : 'table';/);
  assert.match(clients, /<ClientsTable\s+layout=\{layout\}/);
  assert.match(clients, /COLL_PAGE_SIZE = layout === 'cards' \? 24 : 100/, 'a page of cards is lighter than a page of rows');
  // The Dokki clients are the same screen, so they get it too.
  assert.match(read('admin/pages/dashboard/DashboardClientTabs.tsx'), /daqqi_clients/);
});

test('the pipeline is four calm cards across, in order, not a column per status', () => {
  const grid = read(`${tabs}/leads/LeadCardsGrid.tsx`);
  assert.ok(grid.includes('sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'));
  const leads = read(`${tabs}/LeadsTab.tsx`);
  assert.ok(leads.includes("useServerLeadTable(subTab === 'table' || subTab === 'pipeline'"));
  assert.ok(leads.includes('<LeadCardsGrid'));
  assert.ok(!fs.existsSync(path.join(__dirname, '..', '..', tabs, 'leads', 'LeadPipelineBoard.tsx')), 'the per-status board is gone');
  // The panel opens for a lead that is not among the 500 held in memory, and the contact log is a dialog.
  assert.ok(leads.includes('const openLead = activeLead ?? (selectedId && pickedLead?.id === selectedId ? pickedLead : null)'));
  assert.ok(read(`${tabs}/leads/QuickLogContactPanel.tsx`).includes('<Modal open onClose={() => setShowAddComm(false)}'));
});

test('a lead call and WhatsApp are real buttons, icon-only, and every icon has a label', () => {
  const card = read(`${tabs}/leads/LeadCard.tsx`);
  assert.ok(card.includes('href={`tel:${dialable ? `+${dialable}` : lead.phone}`}'));
  assert.ok(card.includes('<WhatsAppLink leadId={lead.id} phone={lead.phone}'));
  for (const label of ['اتصال', 'تسجيل تواصل', 'تفاصيل وتعديل', 'حجز ودفع']) assert.ok(card.includes(`aria-label="${label}"`), label);
  assert.ok(read(`${tabs}/leads/WhatsAppLink.tsx`).includes('aria-label={title}'));
  const clientCard = read(`${tabs}/online-clients-sections/ClientCard.tsx`);
  assert.ok(clientCard.includes('href={`tel:${row.phone}`}') && clientCard.includes('href={wa}'));
  assert.ok(read(`${tabs}/online-clients-sections/ClientsTable.tsx`).includes('sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'));
});

test('every plain table is a stack of cards on a phone, and no table pushes the page sideways', () => {
  const css = read('admin/index.css');
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*table\.rt-stack td::before \{ content: attr\(data-label\)/);
  assert.match(css, /table:not\(\.rt-stack\) \{ display: block; max-width: 100%; overflow-x: auto;/);
  assert.match(css, /\.grid-cols-3, \.grid-cols-4, \.grid-cols-5, \.grid-cols-6 \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important; \}/);
  const script = read('admin/lib/mobileTables.ts');
  assert.match(script, /cell\.colSpan > 1 \|\| cell\.rowSpan > 1/, 'a spanning table is left to scroll');
  assert.match(script, /data-no-stack/);
  assert.match(read('admin/index.tsx'), /installMobileTables\(\);/);
});

test('the filter bars are one row that scrolls sideways, not a wall of selects', () => {
  for (const file of ['join-us/ApplicationsBoard.tsx', 'interviews-sections/InterviewFilters.tsx']) {
    const source = read(`${tabs}/${file}`);
    assert.match(source, /no-scrollbar flex flex-nowrap items-center gap-1\.5 overflow-x-auto/, file);
  }
  assert.match(read('admin/index.css'), /\.no-scrollbar \{ scrollbar-width: none;/);
  // The lecturers' page header scrolls its sub-tabs the same way.
  assert.match(read(`${tabs}/leads/LeadsTabHeader.tsx`), /flex-nowrap items-center gap-1\.5 overflow-x-auto px-1 md:flex-wrap/);
});

test('the public site\'s footer links can be pressed', () => {
  assert.match(read('client/index.css'), /footer a:not\(\[class\*="rounded-full"\]\) \{ display: inline-flex; align-items: center; min-height: 36px; \}/);
});
