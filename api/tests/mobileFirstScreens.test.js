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

test('the pipeline is three columns across, one stage at a time on a phone', () => {
  const board = read(`${tabs}/leads/LeadPipelineBoard.tsx`);
  assert.match(board, /grid items-start gap-3 md:grid-cols-2 lg:grid-cols-3/);
  assert.match(board, /if \(mobile\) \{/);
  assert.match(board, /role="tablist"/);
  assert.doesNotMatch(board, /w-60 flex-shrink-0/, 'the six 240 px columns scrolled sideways are gone');
});

test('a lead\'s call and WhatsApp are real, full-size buttons, and the card writes its details out', () => {
  const card = read(`${tabs}/leads/LeadCard.tsx`);
  assert.match(card, /href=\{`tel:\$\{dialable \? `\+\$\{dialable\}` : lead\.phone\}`\}/);
  assert.match(card, /<WhatsAppLink leadId=\{lead\.id\} phone=\{lead\.phone\}/);
  assert.match(card, /h-10 flex-1/, 'a thumb wide');
  for (const detail of ['آخر تواصل', 'المسؤول', 'المصدر', 'أُضيف', 'ملاحظة']) assert.ok(card.includes(detail), detail);
  const clientCard = read(`${tabs}/online-clients-sections/ClientCard.tsx`);
  assert.match(clientCard, /href=\{`tel:\$\{row\.phone\}`\}/);
  assert.match(clientCard, /href=\{wa\}/);
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
