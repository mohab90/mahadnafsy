'use strict';
/**
 * Admin components drawn for real (31 Oct 2026 audit: «zero front-end tests»). Each case is something the audit found wrong on a
 * screen and that no API test could see.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderAdmin } = require('./_renderAdmin');

const header = () => renderAdmin('admin/pages/dashboard/tabs/leads/LeadsTabHeader.tsx');
const props = (over = {}) => ({
  isSalesOnly: false, canAdministerCrm: true, canManageLeads: true, canExportLeads: true, totalOfflineLeads: 0, overdueCount: 0,
  subTab: 'pipeline', setSubTab() {}, onAddLead() {}, showActionsMenu: false, actionsMenuRef: { current: null },
  onToggleActionsMenu() {}, onCloseActionsMenu() {}, onOpenSettings() {}, notify() {}, onMigrateBranches() {}, migratingBranches: false,
  onExportCsv() {}, ...over,
});

test('the CRM header says its count is the offline leads, not all of them', t => {
  const r = header();
  if (!r) return t.skip('admin dependencies are not installed here');
  const html = r.markup(r.React.createElement(r.module.LeadsTabHeader, props({ totalOfflineLeads: 8, overdueCount: 3 })));
  // «0 عميل محتمل» sat above 601,000 leads: the figure is only the leads of the offline sources.
  assert.match(html, /8 عميل محتمل أوفلاين/);
  assert.match(html, /3 يحتاج متابعة عاجلة/);
  assert.match(html, /CRM — إدارة المبيعات/);
});

test('a salesperson sees their own title and no count', t => {
  const r = header();
  if (!r) return t.skip('admin dependencies are not installed here');
  const html = r.markup(r.React.createElement(r.module.LeadsTabHeader, props({ isSalesOnly: true, canAdministerCrm: false, canExportLeads: false })));
  assert.match(html, /عملائي المحتملون/);
  assert.doesNotMatch(html, /أوفلاين/);
});

test('the add-lead action has a name a screen reader can read', t => {
  const r = header();
  if (!r) return t.skip('admin dependencies are not installed here');
  const html = r.markup(r.React.createElement(r.module.LeadsTabHeader, props()));
  assert.match(html, /إضافة ليد/);
});

// Every button a card draws has text or a label: the icon-only row was the audit's most common unnamed control.
const unnamedControls = html => (html.match(/<(button|a)\b[^>]*>[\s\S]*?<\/\1>/g) || []).filter(tag => {
  const open = tag.slice(0, tag.indexOf('>') + 1);
  const inner = tag.slice(open.length).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
  return !inner && !/aria-label="[^"]+"/.test(open) && !/title="[^"]+"/.test(open);
});

test('a lead card has no control without a name', t => {
  const r = renderAdmin('admin/pages/dashboard/tabs/leads/LeadCard.tsx');
  if (!r) return t.skip('admin dependencies are not installed here');
  const lead = { id: 'l1', name: 'منى أحمد', phone: '01012345678', status: 'new', source: 'website', createdAt: '2026-10-30T10:00:00Z', communications: [] };
  const html = r.markup(r.React.createElement(r.module.LeadCard, {
    lead, score: 40, onSelect() {}, onStatusChange() {}, canManageLeads: true, instituteBranches: [], courses: [], bundles: [],
  }));
  assert.match(html, /منى أحمد/);
  assert.deepEqual(unnamedControls(html), []);
});

test('the unnamed-control check does see an unnamed button', () => {
  assert.equal(unnamedControls('<button class="x"><svg></svg></button>').length, 1);
  assert.equal(unnamedControls('<button aria-label="تحديث"><svg></svg></button>').length, 0);
  assert.equal(unnamedControls('<button>إضافة</button>').length, 0);
});
