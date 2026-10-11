'use strict';

// «تقرير أسبوعي لكل فرع» (11 Oct 2026): for each branch, the week's money in
// and out and what is left, who still owes and for how long, and how many of
// the leads each sales rep was handed that week have paid. Saturday to Friday —
// the institute's week — and, once switched on, on WhatsApp to the numbers the
// daily report goes to on Saturday morning.
//
// Money is in EGP: each payment and expense at the rate stored with it
// (amount_egp), and a foreign row recorded without one at today's rate
// (lib/finance.js toEgp) — said so in the answer, never silently left out.
// Built on the same reads as «تقارير الإدارة» (lib/managementReport.js: a payment
// counts on its picked day, paid or legacy NULL) and «أرصدة مستحقة»
// (lib/outstandingBalances.js: what each course was agreed at, less what was
// paid for it, less what was paid before the system).

const { pool } = require('./db');
const { addDaysToDateOnly, cairoClock, cairoDayStartUtc, cairoToday, isValidDateOnly } = require('./dates');
const { branchForId, normalizeBranch } = require('./branches');
const { priorPaidTotal } = require('./agreedPrice');
const { getTenantSetting } = require('./tenantSettings');
const outbox = require('./outbox');

const BRANCHES = Object.freeze(['DAQQI', 'TAGAMOA', 'ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD']);
const BRANCH_LABELS = Object.freeze({
  DAQQI: 'فرع الدقي', TAGAMOA: 'فرع التجمع', ONLINE_EGYPT: 'أونلاين مصر',
  ONLINE_SAUDI: 'أونلاين السعودية', ONLINE_ABROAD: 'أونلاين دولي', OTHER: 'من غير فرع',
});
const AGING_BUCKETS = Object.freeze([
  ['0-30', 'من 0 لـ 30 يوم', 0, 30], ['31-60', 'من 31 لـ 60 يوم', 31, 60],
  ['61-90', 'من 61 لـ 90 يوم', 61, 90], ['90+', 'أكتر من 90 يوم', 91, Infinity],
]);
const SECTION = 'owner_weekly_report';
const SEND_FROM_MINUTES = 9 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const num = value => Number(value) || 0;
const branchOf = value => {
  const branch = normalizeBranch(value, null);
  return BRANCHES.includes(branch) ? branch : 'OTHER';
};
const ymd = value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10));

/** The Saturday that starts the week holding `day`. */
function weekStartOf(day = cairoToday()) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // Sunday 0 … Saturday 6
  return addDaysToDateOnly(day, -((weekday + 1) % 7));
}
/** Saturday to Friday. */
function weekOf(day) {
  const from = weekStartOf(isValidDateOnly(day) ? day : cairoToday());
  return { from, to: addDaysToDateOnly(from, 6) };
}
/** The last week that has ended: on a Saturday, the one that ended yesterday. */
function lastFullWeek(today = cairoToday()) {
  return weekOf(addDaysToDateOnly(weekStartOf(today), -1));
}

/**
 * EGP for rows grouped as { branch, currency, egp, foreign }: `egp` is what had a
 * stored rate (or was EGP), `foreign` the amount that had none. The latter is
 * converted at today's rate, once per currency; a currency with no fresh rate
 * is reported, not guessed.
 */
async function toEgpRows(rows, tenantId, convert) {
  const out = new Map();
  const unconverted = [];
  const rates = new Map();
  for (const row of rows) {
    const branch = row.branch;
    let egp = num(row.egp);
    const foreign = num(row.foreign);
    if (foreign) {
      const currency = String(row.currency || 'EGP').toUpperCase();
      if (!rates.has(currency)) rates.set(currency, await convert(1, currency, tenantId).catch(() => null));
      const rate = rates.get(currency);
      if (rate) egp += foreign * rate;
      else unconverted.push({ branch, currency, amount: Math.round(foreign) });
    }
    out.set(branch, num(out.get(branch)) + egp);
  }
  return { byBranch: out, unconverted };
}

async function buildWeeklyBranchReport({ tenantId, week, today = cairoToday() }, db = pool, { convert = require('./finance').toEgp } = {}) {
  const { from, to } = weekOf(week || lastFullWeek(today).from);
  const dayAfter = addDaysToDateOnly(to, 1);
  const startUtc = cairoDayStartUtc(from);
  const endUtc = cairoDayStartUtc(dayAfter);

  // A payment without a branch of its own is the client's branch's money.
  const [incomeRows] = await db.query(
    `SELECT COALESCE(p.branch, s.branch) AS branch, COALESCE(p.currency, 'EGP') AS currency, COUNT(*) AS payments,
            SUM(CASE WHEN p.amount_egp IS NOT NULL THEN p.amount_egp WHEN COALESCE(p.currency, 'EGP') = 'EGP' THEN p.amount ELSE 0 END) AS egp,
            SUM(CASE WHEN p.amount_egp IS NULL AND COALESCE(p.currency, 'EGP') <> 'EGP' THEN p.amount ELSE 0 END) AS \`foreign\`
       FROM payments p
       LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status = 'paid')
        AND p.date >= ? AND p.date < ?
      GROUP BY 1, 2`,
    [tenantId, from, dayAfter]);
  const [expenseRows] = await db.query(
    `SELECT e.branch_id, COALESCE(e.currency, 'EGP') AS currency, COUNT(*) AS expenses,
            SUM(CASE WHEN e.amount_egp IS NOT NULL THEN e.amount_egp WHEN COALESCE(e.currency, 'EGP') = 'EGP' THEN e.amount ELSE 0 END) AS egp,
            SUM(CASE WHEN e.amount_egp IS NULL AND COALESCE(e.currency, 'EGP') <> 'EGP' THEN e.amount ELSE 0 END) AS \`foreign\`
       FROM expenses e
      WHERE e.tenant_id = ? AND e.deleted_at IS NULL AND e.date >= ? AND e.date < ?
      GROUP BY 1, 2`,
    [tenantId, from, dayAfter]);

  // What each client was sold, by course or track, less what they had paid for
  // it by the end of the week — and since when they have owed it: the first
  // payment of that course, the day it was booked.
  const [debtRows] = await db.query(
    `SELECT s.id AS subscriber_id, s.branch, s.crm_json, b.expected, b.paid, b.since
       FROM subscribers s
       JOIN (
         SELECT subscriber_id, entitlement_key, MAX(expected) AS expected, SUM(paid) AS paid, MIN(first_at) AS since
           FROM (
             SELECT subscriber_id,
                    CASE
                      WHEN course_id IS NOT NULL THEN CONCAT(COALESCE(payment_type,'COURSE'), ':course:', course_id)
                      WHEN bundle_id IS NOT NULL THEN CONCAT(COALESCE(payment_type,'COURSE'), ':bundle:', bundle_id)
                      ELSE CONCAT(COALESCE(payment_type,'OTHER'), ':payment:', id)
                    END AS entitlement_key,
                    -- An EGP row saved before rates were stored has no rate; its rate is 1.
                    MAX(COALESCE(course_expected,0) * COALESCE(fx_rate_to_egp, CASE WHEN COALESCE(currency,'EGP')='EGP' THEN 1 ELSE 0 END)) AS expected,
                    SUM(CASE WHEN status='paid' THEN COALESCE(amount_egp, CASE WHEN COALESCE(currency,'EGP')='EGP' THEN amount ELSE 0 END) ELSE 0 END) AS paid,
                    MIN(date) AS first_at
               FROM payments
              WHERE tenant_id = ? AND deleted_at IS NULL AND date < ?
              GROUP BY subscriber_id, entitlement_key, currency
             HAVING expected > 0
           ) entitlements
          GROUP BY subscriber_id, entitlement_key
       ) b ON b.subscriber_id = s.id
      WHERE s.tenant_id = ? AND s.is_active = 1 AND s.deleted_at IS NULL AND b.expected > b.paid`,
    [tenantId, dayAfter, tenantId]);

  // The leads each rep was handed in the week, and how many of those are
  // paying clients by its end: a client made from the lead, with a paid payment.
  const [repRows] = await db.query(
    `SELECT COALESCE(l.branch, 'OTHER') AS branch, l.assigned_sales_id AS rep,
            COALESCE(st.name, MAX(l.assigned_sales_name)) AS name, COUNT(*) AS assigned,
            SUM(EXISTS (
              SELECT 1 FROM subscribers s JOIN payments p ON p.subscriber_id = s.id AND p.tenant_id = s.tenant_id
               WHERE s.tenant_id = l.tenant_id AND s.lead_id = l.id
                 AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status = 'paid') AND p.date < ?
            )) AS converted
       FROM leads l
       LEFT JOIN staff st ON st.id = l.assigned_sales_id AND st.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.hidden = 0 AND l.assigned_sales_id IS NOT NULL AND l.assigned_sales_id <> ''
        AND l.assigned_at >= ? AND l.assigned_at < ?
      GROUP BY 1, 2, st.name`,
    [dayAfter, tenantId, startUtc, endUtc]);

  const income = await toEgpRows(incomeRows.map(row => ({ ...row, branch: branchOf(row.branch) })), tenantId, convert);
  const expenses = await toEgpRows(expenseRows.map(row => ({
    ...row, branch: branchOf(branchForId(row.branch_id, null) || row.branch_id),
  })), tenantId, convert);
  const countBy = (rows, key, field) => rows.reduce((map, row) => map.set(key(row), num(map.get(key(row))) + num(row[field])), new Map());
  const paymentsBy = countBy(incomeRows, row => branchOf(row.branch), 'payments');
  const expensesBy = countBy(expenseRows, row => branchOf(branchForId(row.branch_id, null) || row.branch_id), 'expenses');

  // Aging, per client: the oldest debt is paid first — which is how the
  // pre-system money (crm_json priorPaid) is taken off, too.
  const asOf = Date.parse(`${to}T00:00:00Z`);
  const aging = new Map();
  const byClient = new Map();
  for (const row of debtRows) {
    const list = byClient.get(row.subscriber_id) || [];
    list.push(row);
    byClient.set(row.subscriber_id, list);
  }
  for (const debts of byClient.values()) {
    let prior = priorPaidTotal(debts[0].crm_json);
    debts.sort((a, b) => ymd(a.since).localeCompare(ymd(b.since)));
    const branch = branchOf(debts[0].branch);
    const buckets = aging.get(branch) || Object.fromEntries(AGING_BUCKETS.map(([key]) => [key, { amount: 0, clients: new Set() }]));
    for (const debt of debts) {
      let owed = num(debt.expected) - num(debt.paid);
      const covered = Math.min(prior, owed);
      owed -= covered;
      prior -= covered;
      if (owed <= 0.5) continue;
      const days = Math.max(0, Math.floor((asOf - Date.parse(`${ymd(debt.since)}T00:00:00Z`)) / DAY_MS));
      const [key] = AGING_BUCKETS.find(([, , min, max]) => days >= min && days <= max);
      buckets[key].amount += owed;
      buckets[key].clients.add(debt.subscriber_id);
    }
    aging.set(branch, buckets);
  }

  const branches = [...BRANCHES, 'OTHER'].map(branch => {
    const incomeEgp = Math.round(num(income.byBranch.get(branch)));
    const expensesEgp = Math.round(num(expenses.byBranch.get(branch)));
    const buckets = aging.get(branch);
    const agingOut = AGING_BUCKETS.map(([key, label]) => ({
      key, label, amountEgp: Math.round(buckets ? buckets[key].amount : 0), clients: buckets ? buckets[key].clients.size : 0,
    }));
    const reps = repRows.filter(row => branchOf(row.branch) === branch).map(row => ({
      id: row.rep, name: row.name || '—', assigned: num(row.assigned), converted: num(row.converted),
      rate: num(row.assigned) ? Math.round((num(row.converted) / num(row.assigned)) * 1000) / 10 : 0,
    })).sort((a, b) => b.converted - a.converted || b.assigned - a.assigned);
    return {
      branch, label: BRANCH_LABELS[branch],
      incomeEgp, payments: num(paymentsBy.get(branch)),
      expensesEgp, expenses: num(expensesBy.get(branch)),
      netEgp: incomeEgp - expensesEgp,
      aging: agingOut, owedEgp: agingOut.reduce((sum, bucket) => sum + bucket.amountEgp, 0),
      reps,
      leadsAssigned: reps.reduce((sum, rep) => sum + rep.assigned, 0),
      leadsConverted: reps.reduce((sum, rep) => sum + rep.converted, 0),
    };
  })
    // «من غير فرع» only when something is filed there.
    .filter(row => row.branch !== 'OTHER' || row.incomeEgp || row.expensesEgp || row.owedEgp || row.reps.length);

  const sum = field => branches.reduce((total, row) => total + num(row[field]), 0);
  return {
    from, to, today,
    branches,
    totals: {
      incomeEgp: sum('incomeEgp'), expensesEgp: sum('expensesEgp'), netEgp: sum('netEgp'), owedEgp: sum('owedEgp'),
      leadsAssigned: sum('leadsAssigned'), leadsConverted: sum('leadsConverted'),
    },
    agingBuckets: AGING_BUCKETS.map(([key, label]) => ({ key, label })),
    unconverted: [...income.unconverted.map(row => ({ ...row, kind: 'income' })), ...expenses.unconverted.map(row => ({ ...row, kind: 'expense' }))],
  };
}

const n = value => Math.round(Number(value) || 0).toLocaleString('en-US');

/** The week's report as one WhatsApp message. */
function composeWeeklyBranchReport(report) {
  const lines = [`📅 *التقرير الأسبوعي للفروع — ${report.from} → ${report.to}*`, ''];
  const { totals } = report;
  lines.push(`💰 الدخل ${n(totals.incomeEgp)} · المصروفات ${n(totals.expensesEgp)} · الصافي *${n(totals.netEgp)} ج.م*`);
  lines.push(`⏳ فلوس لسه على العملاء: ${n(totals.owedEgp)} ج.م`);
  if (totals.leadsAssigned) {
    lines.push(`🎯 ليدز اتوزعت ${n(totals.leadsAssigned)} · دفعوا ${n(totals.leadsConverted)} (${Math.round((totals.leadsConverted / totals.leadsAssigned) * 100)}%)`);
  }
  for (const row of report.branches) {
    if (!row.incomeEgp && !row.expensesEgp && !row.owedEgp && !row.leadsAssigned) continue;
    lines.push('', `*${row.label}*`);
    lines.push(`الدخل ${n(row.incomeEgp)} · المصروفات ${n(row.expensesEgp)} · الصافي ${n(row.netEgp)}`);
    const aged = row.aging.filter(bucket => bucket.amountEgp > 0).map(bucket => `${bucket.key}: ${n(bucket.amountEgp)}`);
    if (aged.length) lines.push(`المتأخرات (يوم): ${aged.join(' · ')}`);
    const best = row.reps.filter(rep => rep.assigned).slice(0, 3)
      .map(rep => `${rep.name} ${n(rep.converted)}/${n(rep.assigned)} (${rep.rate}%)`);
    if (best.length) lines.push(`السيلز: ${best.join(' · ')}`);
  }
  if (report.unconverted.length) lines.push('', `⚠️ مبالغ بعملة أجنبية من غير سعر صرف متسجل ومش محسوبة: ${report.unconverted.length}`);
  lines.push('', '🔗 التفاصيل: https://admin.mahadnafsy.com/dashboard/management_reports');
  return lines.join('\n').trim();
}

async function weeklyReportSettings(tenantId, db = pool) {
  const stored = await getTenantSetting(SECTION, { tenantId, fallback: {}, db }).catch(() => ({}));
  return { enabled: stored?.enabled === true };
}

/**
 * Saturday from 09:00 Cairo, when switched on: last week's report to the
 * numbers «التقرير اليومي على واتساب» goes to. One message per number per week
 * (the dedupe key), however often the scheduler asks.
 */
async function sendDueWeeklyBranchReports(db, { tenantId, now = new Date() }) {
  const settings = await weeklyReportSettings(tenantId, db);
  if (!settings.enabled) return 0;
  const clock = cairoClock(now);
  if (new Date(`${clock.date}T00:00:00Z`).getUTCDay() !== 6 || clock.minutes < SEND_FROM_MINUTES) return 0;
  const { phones } = await require('./ownerDailyReport').ownerReportSettings(tenantId, db);
  if (!phones.length) return 0;
  const week = lastFullWeek(clock.date);
  const report = await buildWeeklyBranchReport({ tenantId, week: week.from, today: clock.date }, db);
  const message = composeWeeklyBranchReport(report);
  let sent = 0;
  for (const phone of phones) {
    const queued = await outbox.enqueue({
      channel: 'whatsapp', recipient: phone, tenantId,
      dedupeKey: `owner-weekly:${tenantId}:${week.from}:${phone}`,
      refType: 'owner_weekly_report', refId: week.from,
      payload: { message, category: 'staff_alert' },
    }, db);
    if (queued) sent += 1;
  }
  return sent;
}

module.exports = {
  AGING_BUCKETS, BRANCHES, BRANCH_LABELS, SECTION,
  buildWeeklyBranchReport, composeWeeklyBranchReport, lastFullWeek, sendDueWeeklyBranchReports,
  weekOf, weekStartOf, weeklyReportSettings,
};
