'use strict';
// «أداء الفريق»: «تقرير يومي في أول الصفحة» — per rep, calls, bookings, money,
// new leads and follow-ups for the day, with yesterday / 7 / 15 / 30 days — and
// «مراجعة جودة المحادثات» as a button, not the top of the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildTeamDailyReport, reportRange, MAX_DAYS } = require('../lib/teamDailyReport');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the range is Cairo days, defaults to today, and is bounded', () => {
  const today = reportRange({}).today;
  assert.deepEqual(reportRange({}), { from: today, to: today, today });
  assert.deepEqual(reportRange({ from: '2026-09-21', to: '2026-09-27' }).from, '2026-09-21');
  // Reversed or junk input cannot widen the read.
  assert.equal(reportRange({ from: '2026-09-28', to: '2026-09-27' }).from, '2026-09-27');
  assert.equal(reportRange({ from: 'x', to: '2026-09-27' }).from, '2026-09-27');
  assert.equal(reportRange({ from: '2020-01-01', to: '2026-09-27' }).from, '2026-06-27');
  assert.equal(MAX_DAYS, 93);
});

test('each column is compared the way it is stored', async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/FROM staff/.test(sql)) return [[{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }]];
      if (/FROM communications/.test(sql)) return [[{ rep: 's1', calls: 4, whatsapp: 1, meetings: 0, contacts: 5, leadsContacted: 4 }]];
      if (/COUNT\(\*\) AS newLeads/.test(sql)) return [[{ rep: 's2', newLeads: 5 }]];
      if (/AS unassigned/.test(sql)) return [[{ total: 59, unassigned: 7 }]];
      if (/followUpsDue/.test(sql)) return [[{ rep: 's1', followUpsDue: 2, followUpsOverdue: 3 }]];
      if (/FROM payments/.test(sql)) return [[{ rep: 's2', bookings: 1, installments: 0, moneyEgp: 900 }, { rep: null, bookings: 8, installments: 0, moneyEgp: 11591 }]];
      return [[]];
    },
  };
  const report = await buildTeamDailyReport({ tenantId: 't', from: '2026-09-27', to: '2026-09-27', today: '2026-09-27' }, db);
  const q = pattern => seen.find(entry => pattern.test(entry.sql));
  // UTC instants: Cairo's midnight, 21:00 the evening before in September.
  assert.deepEqual(q(/FROM communications/).params, ['t', '2026-09-26 21:00:00', '2026-09-27 21:00:00']);
  assert.deepEqual(q(/COUNT\(\*\) AS newLeads/).params, ['t', '2026-09-26 21:00:00', '2026-09-27 21:00:00']);
  // Calendar days: payments.date and next_follow_up_date hold a picked day.
  assert.deepEqual(q(/FROM payments/).params, ['t', '2026-09-27', '2026-09-28']);
  assert.deepEqual(q(/followUpsDue/).params.slice(0, 4), ['2026-09-27', '2026-09-28', '2026-09-27', 't']);
  // The rep a payment counts for is the client's, not whoever typed it in.
  assert.match(q(/FROM payments/).sql, /JSON_EXTRACT\(sub\.crm_json, '\$\.assignedSalesId'\)/);

  assert.deepEqual(report.reps.map(rep => [rep.name, rep.calls, rep.newLeads, rep.followUpsOverdue, rep.moneyEgp]),
    [['A', 4, 0, 3, 0], ['B', 0, 5, 0, 900]]);
  assert.deepEqual(report.unattributed, { bookings: 8, installments: 0, moneyEgp: 11591 });
  // The headline is all the money that came in; the table says whose.
  assert.equal(report.team.moneyEgp, 12491);
  assert.equal(report.team.newLeads, 59);
});

test('a rep asking sees their own row and no one else\'s money', async () => {
  const db = { async query(sql) {
    if (/FROM staff/.test(sql)) return [[{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }]];
    if (/AS unassigned/.test(sql)) return [[{ total: 0, unassigned: 0 }]];
    if (/FROM payments/.test(sql)) return [[{ rep: null, bookings: 8, installments: 0, moneyEgp: 11591 }]];
    return [[]];
  } };
  const report = await buildTeamDailyReport({ tenantId: 't', from: '2026-09-27', to: '2026-09-27', today: '2026-09-27', onlyRepId: 's2' }, db);
  assert.deepEqual(report.reps.map(rep => rep.id), ['s2']);
  assert.equal(report.unattributed, null);
  assert.equal(report.team.moneyEgp, 0);
  assert.match(read('api/routes/crm-advanced.js'), /onlyRepId: isSales \? req\.staffRecord\.id : null/);
});

test('«أداء الفريق» opens on the report; the quality review is a button', () => {
  const tab = read('admin/pages/dashboard/tabs/LeadsTab.tsx');
  const performance = tab.slice(tab.indexOf("{subTab === 'performance' && ("));
  assert.ok(performance.indexOf('<TeamDailyReport') < performance.indexOf('<LeadPerformanceOverview'));
  assert.match(performance, /<CrmCoachingButton notify=\{notify\} \/>/);
  assert.doesNotMatch(tab, /<CrmCoachingPanel/);
  const report = read('admin/pages/dashboard/tabs/leads/TeamDailyReport.tsx');
  for (const label of ['النهارده', 'أمس', '7 أيام', '15 يوم', '30 يوم']) assert.ok(report.includes(`'${label}'`), label);
});

test('«مصادر الليدز» lists its sources beside the pie instead of on it', () => {
  const panel = read('admin/pages/dashboard/tabs/leads/LeadPerformancePanel.tsx');
  assert.doesNotMatch(panel, /label=\{\(\{ name, percent \}\)/);
  assert.match(panel, /const grouped = groupSources\(sourcesData\);/);
});
