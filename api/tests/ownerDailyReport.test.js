'use strict';

// «يبعتي تقرير يومي علي الواتس اب بتاعي 00201277207720 باداء الفريق كله».

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { composeOwnerReport } = require('../lib/ownerDailyReport');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

const report = {
  to: '2026-09-30',
  income: { totalEgp: 12500, payments: 8, byBranch: [{ label: 'أونلاين مصر', moneyEgp: 9000, payments: 6 }], byDepartment: [], byType: [], byDay: [] },
  counts: { newLeads: 35, newClients: 6, pendingPayments: 2 },
  leaders: {
    salesByMoney: [{ id: 's1', name: 'Shimaa Abid', value: 1200 }], salesByCalls: [{ id: 's2', name: 'DoniaRashed', value: 25 }],
    collectionByMoney: [{ id: 'c1', name: 'Doaa Awny', value: 2000 }], supportByResolved: [], daqqiByMoney: [],
  },
  topCourses: [{ title: 'دبلومة علم النفس المتكامل', bookings: 3 }],
  teams: {
    sales: { team: { calls: 50, bookings: 3, moneyEgp: 2500, followUpsOverdue: 30 } },
    online: { totals: { collectedEgp: 4000 } },
    support: { totals: { problemsOpened: 3, problemsResolved: 1, problemsOpen: 14, certificatesRequested: 2, certificatesIssued: 0, certificatesWaiting: 254 } },
    daqqi: { totals: { newClients: 2, payments: 0, moneyEgp: 0 } },
  },
};

test('the day\'s report is one message about every team', () => {
  const text = composeOwnerReport(report);
  assert.match(text, /تقرير المعهد — الأربع 2026-09-30/);
  assert.match(text, /الدخل:\* 12,500 ج\.م \(8 دفعة\)/);
  assert.match(text, /أونلاين مصر 9,000/);
  assert.match(text, /المبيعات:\* 50 مكالمة · 3 حجز · 2,500 ج\.م/);
  assert.match(text, /أكتر سيلز فلوس: Shimaa Abid \(1,200 ج\.م\)/);
  assert.match(text, /أكتر تحصيل: Doaa Awny/);
  assert.match(text, /خدمة العملاء:\* 3 مشكلة جديدة · 1 اتحلت · 14 مفتوحة/);
  assert.match(text, /254 مستنية/);
  assert.ok(!/\n{3,}/.test(text), 'no runs of blank lines where a figure was left out');
});

test('it is sent once a day, to the saved numbers only, through its own category', () => {
  const lib = read('api/lib/ownerDailyReport.js');
  assert.match(lib, /dedupeKey: `owner_report:\$\{clock\.date\}`/, 'one a day however often the scheduler asks');
  assert.match(lib, /sendWhatsApp\(phone, text, \{ tenantId, category: 'owner_report' \}\)/);
  assert.match(lib, /if \(!settings\.phones\.length\) return \{ sent: 0, reason: 'no_numbers' \};/, 'nothing goes out before a number is saved');
  const gate = read('api/lib/whatsapp.js');
  assert.match(gate, /const ALWAYS_ALLOWED = new Set\(\['owner_report'\]\);/);
  const users = ['lib', 'routes'].flatMap(dir => fs.readdirSync(path.join(__dirname, '..', dir), { recursive: true })
    .filter(file => String(file).endsWith('.js') && read(`api/${dir}/${file}`).includes("category: 'owner_report'"))
    .map(file => `${dir}/${String(file).split(path.sep).join('/')}`));
  assert.deepEqual(users, ['lib/ownerDailyReport.js'], 'the always-open category carries the owner\'s report and nothing else');
  assert.match(read('api/lib/backgroundScheduler.js'), /owner_daily_report: async \(\{ tenantId, date \}\) =>/);
  assert.match(read('api/routes/management-reports.js'), /router\.post\('\/api\/admin\/reports\/whatsapp\/send-now', requireAuth, requireAdmin,/);
});
