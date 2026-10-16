'use strict';
/**
 * «المتابعات محتاجة تكون أقوى … يظهر اشعار للمسئولين عنه سواء فى الدقى او الاونلاين او السيلز»
 * (14 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { summarize, ownerTitle, ownerMessage, teamMessage } = require('../lib/followUpDigest');
const { visibleBroadcastTypes } = require('../lib/notificationAudience');
const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

const rows = [
  { owner_id: 'a', owner_name: 'منى', section: 'online', due: '2026-10-12' },
  { owner_id: 'a', owner_name: 'منى', section: 'online', due: '2026-10-14' },
  { owner_id: 'a', owner_name: 'منى', section: 'leads', due: '2026-10-14' },
  { owner_id: 'b', owner_name: 'هنا', section: 'dokki', due: '2026-10-14' },
  { owner_id: null, owner_name: null, section: 'leads', due: '2026-10-10' },
];

test('each employee is told what is theirs, by kind, and how many are late', () => {
  const summary = summarize(rows, '2026-10-14');
  const mona = summary.owners.find(owner => owner.id === 'a');
  assert.deepEqual([mona.total, mona.overdue, mona.today], [3, 1, 2]);
  assert.equal(ownerTitle(mona), '🔴 عندك 3 متابعة النهاردة (1 متأخرة)');
  assert.equal(ownerMessage(mona), '💻 2 عملاء أونلاين · 🎯 1 ليدز — منها 1 متأخرة');
  assert.equal(summary.owners[0].id, 'a', 'the one furthest behind first');
  const hana = summary.owners.find(owner => owner.id === 'b');
  assert.equal(ownerTitle(hana), '📅 عندك 1 متابعة النهاردة');
});

test('the managers get the team\'s figures, and what has no owner', () => {
  const summary = summarize(rows, '2026-10-14');
  assert.deepEqual(summary.team, { overdue: 2, today: 3 });
  assert.deepEqual(summary.unowned, { overdue: 1, today: 0 });
  assert.equal(teamMessage(summary), '3 النهاردة · 2 متأخرة — الأكتر تأخيرا — منى: 1 — بدون مسئول: 1');
  assert.ok(visibleBroadcastTypes({ role: 'manager', permissions: ['manage_sales_team'] }).includes('followup_team'));
  assert.ok(!visibleBroadcastTypes({ role: 'reception_daqqi', permissions: [] }).includes('followup_team'));
});

test('the digest is scheduled, and made once a day then kept true', () => {
  assert.match(read('api/routes/misc/_shared.js'), /scheduleFollowUpDigest\(\)/);
  const job = read('api/lib/followUpDigest.js');
  assert.match(job, /recipient_staff_id <=> \?/);
  assert.match(job, /DELETE FROM notification_reads/);
});

test('the online clients table filters by follow-up with the rule the row shows', () => {
  const tab = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  assert.match(tab, /matchesFollowFilter\(followUpOf\(s\), collOnlineFollowFilter\)/);
  const table = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  assert.match(table, /followUpOf\(row\)/);
  const helper = read('admin/lib/clientFollowUp.ts');
  assert.match(helper, /installmentDate/);
  const bar = read('admin/pages/dashboard/tabs/online-clients-sections/FiltersToolbar.tsx');
  assert.match(bar, /متابعات النهاردة/);
});
