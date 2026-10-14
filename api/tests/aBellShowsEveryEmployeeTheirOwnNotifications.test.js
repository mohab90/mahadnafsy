'use strict';
/**
 * «زر الاشعارات نفسه فى حساب كل موظف لازم يكون اقوى … وغير تصميم القايمة خليها افضل وبتقرا وبتشوف
 * كل حاجة» (14 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

test('every role bar carries the real notifications bell, with the follow-up drawer beside it', () => {
  const nav = read('admin/pages/dashboard/DashboardNavigation.tsx');
  const roleNav = nav.slice(nav.indexOf('function CompactRoleNav'), nav.indexOf('export function DashboardNavigation'));
  assert.match(roleNav, /<RoleBell \/>/, 'the role bars drew a Bell that opened the sales drawer instead');
  assert.match(roleNav, /setSalesNotifOpen\(true\)[\s\S]*AlarmClock/);
  assert.match(nav, /<BellContext\.Provider value=\{bellProps\}>/);
});

test('the list is grouped by day, sets the escalations and follow-ups apart, reads in full and opens the page', () => {
  const bell = read('admin/pages/dashboard/NotificationsBell.tsx');
  for (const type of ['escalation_critical', 'escalation_repeated', 'followup', 'followup_team']) assert.match(bell, new RegExp(`${type}:`));
  assert.match(bell, /النهاردة/);
  assert.match(bell, /امبارح/);
  assert.match(bell, /whitespace-pre-wrap/);
  assert.match(bell, /focus=\$\{encodeURIComponent\(data\.ticketId\)\}/);
  assert.match(bell, /follow=due/);
  // Opening the panel never marks anything read.
  assert.doesNotMatch(bell, /useEffect\(\(\) => \{[^}]*markAll/);
});

test('a link from a notification opens the clients table already filtered by follow-up', () => {
  const tab = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  assert.match(tab, /searchParams\.get\('follow'\)/);
  const hook = read('admin/pages/dashboard/useNotificationsBell.ts');
  assert.match(hook, /data_json\?: string \| null/);
});
