'use strict';

// «يبعتي تقرير يومي علي الواتس اب بتاعي باداء الفريق كله».
//
// Once a Cairo day, at the hour set in «تقارير الإدارة ← التقرير اليومي على
// واتساب», the day's management report (lib/managementReport.js) goes as one
// WhatsApp message to the numbers set there. Nothing is sent until a number is
// saved. The job queue's dedupe key holds it to one report a day however many
// times the scheduler asks, and staging, on its own database, has no numbers.

const { pool } = require('./db');
const { cairoClock, cairoToday } = require('./dates');
const { getTenantSetting } = require('./tenantSettings');
const { buildManagementReport } = require('./managementReport');
const { toDialable } = require('./phoneNumber');

const SECTION = 'owner_reports';
const DEFAULTS = { enabled: false, phones: [], hour: 21 };
const DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

async function ownerReportSettings(tenantId, db = pool) {
  const stored = await getTenantSetting(SECTION, { tenantId, fallback: {}, db }).catch(() => ({}));
  const hour = Number(stored?.hour);
  return {
    enabled: stored?.enabled === true,
    phones: (Array.isArray(stored?.phones) ? stored.phones : []).map(String).filter(phone => toDialable(phone)).slice(0, 5),
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULTS.hour,
  };
}

const n = value => Math.round(Number(value) || 0).toLocaleString('en-US');
const topLine = (label, rows, money) => (rows?.length
  ? `${label}: ${rows[0].name} (${money ? `${n(rows[0].value)} ج.م` : n(rows[0].value)})`
  : null);

/** The day's report as one WhatsApp message. */
function composeOwnerReport(report) {
  const day = DAYS[new Date(`${report.to}T12:00:00Z`).getUTCDay()];
  const { income, counts, leaders, teams, topCourses } = report;
  const sales = teams.sales.team || {};
  const online = teams.online.totals || {};
  const support = teams.support.totals || {};
  const daqqi = teams.daqqi.totals || {};
  const tagamoa = teams.tagamoa?.totals || {};
  const branches = income.byBranch.slice(0, 4).map(row => `${row.label} ${n(row.moneyEgp)}`).join(' · ');
  return [
    `📊 *تقرير المعهد — ${day} ${report.to}*`,
    '',
    `💰 *الدخل:* ${n(income.totalEgp)} ج.م (${n(income.payments)} دفعة)`,
    branches ? `• ${branches}` : null,
    `📥 ليدز جديدة: ${n(counts.newLeads)} · 👥 عملاء جدد: ${n(counts.newClients)}`,
    counts.pendingPayments ? `⏳ دفعات مستنية مراجعة: ${n(counts.pendingPayments)}` : null,
    '',
    `*المبيعات:* ${n(sales.calls)} مكالمة · ${n(sales.bookings)} حجز · ${n(sales.moneyEgp)} ج.م`,
    topLine('🏆 أكتر سيلز فلوس', leaders.salesByMoney, true),
    topLine('📞 أكتر مكالمات', leaders.salesByCalls, false),
    sales.followUpsOverdue ? `⚠️ متابعات متأخرة: ${n(sales.followUpsOverdue)}` : null,
    '',
    `*التحصيل (الأونلاين):* ${n(online.collectedEgp)} ج.م من عملاء الفريق`,
    topLine('🏆 أكتر تحصيل', leaders.collectionByMoney, true),
    '',
    `*خدمة العملاء:* ${n(support.problemsOpened)} مشكلة جديدة · ${n(support.problemsResolved)} اتحلت · ${n(support.problemsOpen)} مفتوحة`,
    `شهادات: ${n(support.certificatesRequested)} اتطلبت · ${n(support.certificatesIssued)} اتصدرت · ${n(support.certificatesWaiting)} مستنية`,
    support.consultationsRequested ? `استشارات جديدة: ${n(support.consultationsRequested)}` : null,
    '',
    `*الدقي:* ${n(daqqi.newClients)} عميل جديد · ${n(daqqi.payments)} دفعة · ${n(daqqi.moneyEgp)} ج.م`,
    // Tagamoa only once it has something to say — it opens hidden.
    tagamoa.payments || tagamoa.newClients
      ? `*التجمع:* ${n(tagamoa.newClients)} عميل جديد · ${n(tagamoa.payments)} دفعة · ${n(tagamoa.moneyEgp)} ج.م` : null,
    topCourses.length ? `\n📚 *الأكتر مبيعاً:* ${topCourses.slice(0, 3).map(course => `${course.title} (${n(course.bookings)})`).join(' · ')}` : null,
    '',
    '🔗 التفاصيل: https://admin.mahadnafsy.com/dashboard/management_reports',
  ].filter(line => line !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Build and send today's report (or the day given) to the saved numbers.
 * `force` sends even when the daily report is switched off — the «ابعت
 * دلوقتي» button, which still needs a number.
 */
async function sendOwnerDailyReport({ tenantId, date = cairoToday(), force = false }, db = pool) {
  const settings = await ownerReportSettings(tenantId, db);
  if (!settings.phones.length) return { sent: 0, reason: 'no_numbers' };
  if (!settings.enabled && !force) return { sent: 0, reason: 'disabled' };
  const report = await buildManagementReport({ tenantId, from: date, to: date, today: cairoToday() }, db);
  const text = composeOwnerReport(report);
  const { sendWhatsApp } = require('./whatsapp');
  const results = [];
  for (const phone of settings.phones) {
    results.push({ phone, ...(await sendWhatsApp(phone, text, { tenantId, category: 'owner_report' })) });
  }
  return { sent: results.filter(result => result.ok).length, results: results.map(({ phone, ok, reason }) => ({ phone, ok, reason: ok ? undefined : String(reason || '') })) };
}

/** Called by the scheduler every few minutes: queue today's report once its hour has come. */
async function queueDueOwnerReports({ queue, logger }, db = pool) {
  const [rows] = await db.query('SELECT tenant_id FROM tenant_settings WHERE section=?', [SECTION]);
  const clock = cairoClock();
  for (const { tenant_id: tenantId } of rows) {
    const settings = await ownerReportSettings(tenantId, db);
    if (!settings.enabled || !settings.phones.length || clock.minutes < settings.hour * 60) continue;
    await queue.enqueue('owner_daily_report', { tenantId, date: clock.date }, {
      tenantId, maxAttempts: 3, dedupeKey: `owner_report:${clock.date}`,
    }).catch(error => logger.warn('[owner-report] could not queue', { tenantId, error: error.message }));
  }
}

module.exports = { SECTION, composeOwnerReport, ownerReportSettings, queueDueOwnerReports, sendOwnerDailyReport };
