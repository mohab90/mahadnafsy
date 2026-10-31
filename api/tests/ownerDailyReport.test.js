'use strict';

// «يبعتي تقرير يومي علي الواتس اب بتاعي باداء الفريق كله».
// 31 Oct 2026: «نطوره ونختصره … اجمالي الدخل اليوم، اليوم نهايته الساعه 7 … اتقبل وكام تحت المراجعة … كل فريق دخل كام … كام ليد وكام حجز
// وكام شهاده … بتصميم مميز».

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { composeOwnerReport, REPORT_PARTS, hourOf, partsOf } = require('../lib/ownerDailyReport');
const { businessDayBounds } = require('../lib/dailyIncomeReport');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

const team = (totalEgp, payments = 1) => ({ totalEgp, payments, acceptedEgp: totalEgp, acceptedN: payments, reviewEgp: 0, reviewN: 0 });
const report = {
  date: '2026-10-31', open: false,
  income: { totalEgp: 12500, payments: 8, acceptedEgp: 10000, acceptedN: 6, reviewEgp: 2500, reviewN: 2, failedN: 1 },
  teams: { collection: team(5000), daqqi: team(2500), sales: team(5000), tagamoa: team(0, 0), other: team(0, 0) },
  counts: { newLeads: 35, newBookings: 6, certificatesRequested: 4, certificatesIssued: 2 },
};

test('the day\'s report: the total first, accepted against waiting for review, each team\'s share, and the day\'s counts', () => {
  const text = composeOwnerReport(report);
  assert.match(text, /تقرير المعهد اليومي/);
  assert.match(text, /السبت 31 أكتوبر 2026/);
  assert.match(text, /\*12,500 ج\.م\* · 8 دفعة/);
  assert.match(text, /✅ اتقبل: \*10,000\* ج\.م \(6\)/);
  assert.match(text, /⏳ تحت المراجعة: \*2,500\* ج\.م \(2\)/);
  assert.match(text, /❌ مرفوض: 1/);
  assert.match(text, /🌐 \*تحصيل الأونلاين\* — 5,000 ج\.م · 40%\n▰▰▰▰▱▱▱▱▱▱/);
  assert.match(text, /🏢 \*فريق الدقي\* — 2,500 ج\.م · 20%\n▰▰▱▱▱▱▱▱▱▱/);
  assert.match(text, /🎯 \*فريق المبيعات\* — 5,000 ج\.م · 40%/);
  assert.match(text, /ليدز جديدة: \*35\*/);
  assert.match(text, /حجوزات كورسات جديدة: \*6\*/);
  assert.match(text, /شهادات: \*4\* اتطلبت · \*2\* اتصدرت/);
  // The order: money, then teams, then counts.
  assert.ok(text.indexOf('إجمالي الدخل') < text.indexOf('اتقبل') && text.indexOf('اتقبل') < text.indexOf('الدخل لكل فريق') && text.indexOf('الدخل لكل فريق') < text.indexOf('اليوم في أرقام'));
  assert.ok(!/\n{3,}/.test(text), 'no runs of blank lines');
  assert.ok(text.split('\n').length < 32, 'short');
  assert.doesNotMatch(text, /لسه مفتوح/, 'a closed day is not called open');
});

test('Tagamoa, «no team» and rejected payments show only when they have something to say; a day still running says so', () => {
  const quiet = composeOwnerReport({ ...report, income: { ...report.income, failedN: 0 } });
  assert.doesNotMatch(quiet, /التجمع|بدون فريق|مرفوض/);
  const busy = composeOwnerReport({ ...report, open: true, teams: { ...report.teams, tagamoa: team(1000), other: team(500) } });
  assert.match(busy, /فريق التجمع/);
  assert.match(busy, /بدون فريق/);
  assert.match(busy, /لسه مفتوح/);
  const empty = composeOwnerReport({ ...report, income: { totalEgp: 0, payments: 0, acceptedEgp: 0, acceptedN: 0, reviewEgp: 0, reviewN: 0, failedN: 0 }, teams: Object.fromEntries(Object.keys(report.teams).map(key => [key, team(0, 0)])) });
  assert.match(empty, /\*0 ج\.م\* · 0 دفعة/);
  assert.match(empty, /0%/, 'no division by zero on a day with no money');
});

test('the business day runs from 19:00 yesterday to 19:00, in Cairo\'s own clock, summer and winter', () => {
  assert.deepEqual(businessDayBounds('2026-10-31'), { startUtc: '2026-10-30 17:00:00', endUtc: '2026-10-31 17:00:00' });
  assert.deepEqual(businessDayBounds('2026-07-15'), { startUtc: '2026-07-14 16:00:00', endUtc: '2026-07-15 16:00:00' });
  // The night the clocks go back (Egypt, 30 Oct 2026): 19:00 on the 29th is still summer time, 19:00 on the 30th is not.
  assert.deepEqual(businessDayBounds('2026-10-30'), { startUtc: '2026-10-29 16:00:00', endUtc: '2026-10-30 17:00:00' });
});

test('money belongs to the day it was recorded, by who brought it in, and the total is everything entered but not what was rejected', () => {
  const lib = read('api/lib/dailyIncomeReport.js');
  assert.match(lib, /p\.created_at >= \? AND p\.created_at < \?/);
  assert.doesNotMatch(lib, /p\.date >=/, 'the date typed on a payment does not decide the day');
  assert.match(lib, /p\.status IN \('paid','pending','failed'\)/);
  assert.match(lib, /if \(row\.status === 'failed'\) \{ failedN \+= num\(row\.n\); continue; \}/);
  assert.match(lib, /WHEN p\.branch='DAQQI' THEN 'daqqi'/);
  assert.match(lib, /WHEN UPPER\(st\.role\)='COLLECTION' THEN 'collection'/);
  assert.match(lib, /WHEN UPPER\(st\.role\) IN \('SALES','SALES_COLLECTION_MANAGER','ONLINE_MANAGER'\) THEN 'sales'/);
  assert.ok(lib.indexOf("p.branch='DAQQI'") < lib.indexOf("UPPER(st.role)='COLLECTION'") && lib.indexOf("UPPER(st.role)='COLLECTION'") < lib.indexOf('sub.assigned_cs_id IS NOT NULL'));
  assert.match(lib, /AND \$\{ITEM_PAYMENT_SQL\}/, 'a booking is the course\'s own first payment, not a certificate\'s');
});

test('it is sent once a day, to the saved numbers only, through its own category, and never before the day closes', () => {
  const lib = read('api/lib/ownerDailyReport.js');
  assert.match(lib, /dedupeKey: `owner_report:\$\{clock\.date\}`/, 'one a day however often the scheduler asks');
  assert.match(lib, /sendWhatsApp\(phone, text, \{ tenantId, category: 'owner_report' \}\)/);
  assert.match(lib, /if \(!settings\.phones\.length\) return \{ sent: 0, reason: 'no_numbers' \};/, 'nothing goes out before a number is saved');
  assert.match(lib, /hour >= DAY_ENDS_AT_HOUR && hour <= 23/, 'the hour cannot be earlier than 19:00');
  const gate = read('api/lib/whatsapp.js');
  // Open beside it: alerts to the institute's own staff, never a customer.
  assert.match(gate, /const ALWAYS_ALLOWED = new Set\(\['owner_report', 'staff_alert'\]\);/);
  const users = ['lib', 'routes'].flatMap(dir => fs.readdirSync(path.join(__dirname, '..', dir), { recursive: true })
    .filter(file => String(file).endsWith('.js') && read(`api/${dir}/${file}`).includes("category: 'owner_report'"))
    .map(file => `${dir}/${String(file).split(path.sep).join('/')}`));
  assert.deepEqual(users, ['lib/ownerDailyReport.js'], 'the always-open category carries the owner\'s report and nothing else');
  assert.match(read('api/lib/backgroundScheduler.js'), /owner_daily_report: async \(\{ tenantId, date \}\) =>/);
  assert.match(read('api/routes/management-reports.js'), /router\.post\('\/api\/admin\/reports\/whatsapp\/send-now', requireAuth, requireAdmin,/);
});

// «محتاج اقدر اغير فيه يبعتلي ايه واحدد عناصر معينه» (8 Oct 2026).
test('the owner picks what the message carries, and the picks saved for the longer report still mean something', () => {
  const text = composeOwnerReport(report, ['income', 'counts']);
  assert.match(text, /إجمالي الدخل/);
  assert.match(text, /اليوم في أرقام/);
  for (const gone of [/اتقبل/, /تحت المراجعة/, /الدخل لكل فريق/, /التفاصيل/, /https:/]) assert.doesNotMatch(text, gone);
  assert.ok(!/\n{3,}/.test(text));
  assert.equal(composeOwnerReport(report), composeOwnerReport(report, REPORT_PARTS.map(([key]) => key)), 'all of it until a choice is saved');
  assert.match(read('api/routes/management-reports.js'), /parts: Array\.isArray\(req\.body\?\.parts\)/);
  assert.match(read('admin/pages/dashboard/tabs/reports/OwnerWhatsappReportCard.tsx'), /يبعتلك إيه في الرسالة/);

  // What the owner had saved for the longer report: its keys land on the ones that replaced them; a list with none of them is all of it.
  assert.deepEqual(partsOf(['income', 'sales', 'link']), ['income', 'teams', 'link']);
  assert.deepEqual(partsOf(['pending', 'leads']), ['review', 'counts']);
  assert.deepEqual(partsOf(['nothing-known']), REPORT_PARTS.map(([key]) => key));
  assert.deepEqual(partsOf(undefined), REPORT_PARTS.map(([key]) => key));
  assert.equal(hourOf(22), 22);
  assert.equal(hourOf(9), 21, 'a report set for the morning goes out at the default hour, after the day closes');
  assert.equal(hourOf(undefined), 21);
});
