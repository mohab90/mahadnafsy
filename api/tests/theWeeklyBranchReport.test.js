'use strict';

// «تقرير أسبوعي لكل فرع» (11 Oct 2026): per branch, the week's income, expenses
// and net in EGP, what is still owed by how long, each rep's lead-to-paid
// conversion — and, switched on, a Saturday-morning WhatsApp to the owner's
// numbers through the outbox as a staff alert, once a week.

const test = require('node:test');
const assert = require('node:assert/strict');

const outboxed = [];
let weeklySetting = {};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/outbox', { enqueue: async message => { outboxed.push(message); return 'id'; } });
stub('../lib/tenantSettings', { getTenantSetting: async () => weeklySetting, setTenantSetting: async () => {} });
stub('../lib/ownerDailyReport', { ownerReportSettings: async () => ({ phones: ['01000000009'], enabled: false }) });

const report = require('../lib/weeklyBranchReport');

const db = {
  query: async (sql) => {
    const flat = String(sql).replace(/\s+/g, ' ');
    if (/FROM payments p LEFT JOIN subscribers s/.test(flat) && /GROUP BY 1, 2/.test(flat)) {
      return [[
        { branch: 'DAQQI', currency: 'EGP', payments: 3, egp: 9000, foreign: 0 },
        // An online-Saudi payment with no stored rate: converted at today's.
        { branch: 'ONLINE_SAUDI', currency: 'SAR', payments: 1, egp: 0, foreign: 100 },
        // No branch on the payment or the client.
        { branch: null, currency: 'EGP', payments: 1, egp: 500, foreign: 0 },
      ]];
    }
    if (/FROM expenses e/.test(flat)) {
      return [[{ branch_id: 'branch-daqqi', currency: 'EGP', expenses: 2, egp: 2500, foreign: 0 }]];
    }
    if (/FROM subscribers s JOIN \( SELECT subscriber_id, entitlement_key/.test(flat)) {
      return [[
        // Fridays: the week ends 2026-10-09. Booked 10 days before → 0–30.
        { subscriber_id: 's1', branch: 'DAQQI', crm_json: null, expected: 4000, paid: 1000, since: '2026-09-29' },
        // Booked 100 days before → 90+; 500 of it paid before the system.
        { subscriber_id: 's2', branch: 'DAQQI', crm_json: JSON.stringify({ priorPaid: { x: 500 } }), expected: 3000, paid: 0, since: '2026-07-01' },
        { subscriber_id: 's3', branch: 'ONLINE_EGYPT', crm_json: null, expected: 2000, paid: 0, since: '2026-08-20' },
      ]];
    }
    if (/FROM leads l/.test(flat)) {
      return [[
        { branch: 'DAQQI', rep: 'rep-1', name: 'منى', assigned: 10, converted: 3 },
        { branch: 'ONLINE_EGYPT', rep: 'rep-2', name: 'سارة', assigned: 4, converted: 0 },
      ]];
    }
    return [[]];
  },
};
const convert = async (amount, currency) => (currency === 'SAR' ? amount * 13 : Promise.reject(new Error('no rate')));

test('the week is Saturday to Friday, and the last full one is the one that ended', () => {
  assert.deepEqual(report.weekOf('2026-10-07'), { from: '2026-10-03', to: '2026-10-09' });
  assert.equal(report.weekStartOf('2026-10-10'), '2026-10-10', 'a Saturday starts its own week');
  assert.deepEqual(report.lastFullWeek('2026-10-10'), { from: '2026-10-03', to: '2026-10-09' });
  assert.deepEqual(report.lastFullWeek('2026-10-11'), { from: '2026-10-03', to: '2026-10-09' });
});

test('per branch: income, expenses and net in EGP, aging buckets, and each rep\'s conversion', async () => {
  const out = await report.buildWeeklyBranchReport({ tenantId: 't', week: '2026-10-05' }, db, { convert });
  assert.equal(out.from, '2026-10-03');
  const daqqi = out.branches.find(row => row.branch === 'DAQQI');
  assert.equal(daqqi.incomeEgp, 9000);
  assert.equal(daqqi.expensesEgp, 2500, 'the expense\'s branch_id is the branch');
  assert.equal(daqqi.netEgp, 6500);
  assert.deepEqual(daqqi.aging.map(bucket => [bucket.key, bucket.amountEgp, bucket.clients]),
    [['0-30', 3000, 1], ['31-60', 0, 0], ['61-90', 0, 0], ['90+', 2500, 1]]);
  assert.deepEqual(daqqi.reps, [{ id: 'rep-1', name: 'منى', assigned: 10, converted: 3, rate: 30 }]);
  assert.equal(out.branches.find(row => row.branch === 'ONLINE_SAUDI').incomeEgp, 1300, 'SAR at today\'s rate');
  assert.equal(out.branches.find(row => row.branch === 'ONLINE_EGYPT').aging[1].amountEgp, 2000, '50 days: 31–60');
  assert.equal(out.branches.find(row => row.branch === 'OTHER').incomeEgp, 500, 'money with no branch is shown, not dropped');
  assert.equal(out.totals.incomeEgp, 10800);
  assert.equal(out.totals.leadsAssigned, 14);
  const text = report.composeWeeklyBranchReport(out);
  assert.match(text, /التقرير الأسبوعي للفروع — 2026-10-03 → 2026-10-09/);
  assert.match(text, /\*فرع الدقي\*\nالدخل 9,000 · المصروفات 2,500 · الصافي 6,500/);
  assert.match(text, /المتأخرات \(يوم\): 0-30: 3,000 · 90\+: 2,500/);
  assert.match(text, /منى 3\/10 \(30%\)/);
});

test('a foreign amount with no rate at all is reported, not counted as zero in silence', async () => {
  const out = await report.buildWeeklyBranchReport({ tenantId: 't', week: '2026-10-05' }, db, { convert: async () => { throw new Error('stale'); } });
  assert.deepEqual(out.unconverted, [{ branch: 'ONLINE_SAUDI', currency: 'SAR', amount: 100, kind: 'income' }]);
});

test('Saturday from 9, switched on, once a week per number, as a staff alert', async () => {
  weeklySetting = {};
  outboxed.length = 0;
  const saturdayMorning = new Date('2026-10-10T07:10:00Z'); // 10:10 Cairo
  assert.equal(await report.sendDueWeeklyBranchReports(db, { tenantId: 't', now: saturdayMorning }), 0, 'off until switched on');
  weeklySetting = { enabled: true };
  assert.equal(await report.sendDueWeeklyBranchReports(db, { tenantId: 't', now: new Date('2026-10-10T05:00:00Z') }), 0, '08:00: not yet');
  assert.equal(await report.sendDueWeeklyBranchReports(db, { tenantId: 't', now: new Date('2026-10-11T07:10:00Z') }), 0, 'Sunday: no');
  assert.equal(await report.sendDueWeeklyBranchReports(db, { tenantId: 't', now: saturdayMorning }), 1);
  const [message] = outboxed;
  assert.equal(message.recipient, '01000000009');
  assert.equal(message.payload.category, 'staff_alert', 'owner_report is the daily report\'s alone');
  assert.equal(message.dedupeKey, 'owner-weekly:t:2026-10-03:01000000009');
  assert.match(message.payload.message, /2026-10-03 → 2026-10-09/);
  weeklySetting = {};
});
