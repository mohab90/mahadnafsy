'use strict';

// «يبعتي تقرير يومي علي الواتس اب بتاعي باداء الفريق كله».
//
// Once a Cairo day, at the hour set in «تقارير الإدارة ← التقرير اليومي على
// واتساب», the day's report goes as one WhatsApp message to the numbers set
// there. Nothing is sent until a number is saved. The job queue's dedupe key
// holds it to one report a day however many times the scheduler asks, and
// staging, on its own database, has no numbers.
//
// 31 Oct 2026: shorter, and about money first (lib/dailyIncomeReport.js): the
// day closes at 19:00 and what is entered after it is the next day's; the
// total counts everything entered, accepted or not, then how much was
// accepted and how much waits for review; what each team brought in; and the
// day's leads, bookings and certificates. The report goes out once the day
// has closed, so the hour cannot be earlier than 19:00.

const { pool } = require('./db');
const { cairoClock, cairoToday } = require('./dates');
const { getTenantSetting } = require('./tenantSettings');
const { buildDailyIncomeReport, DAY_ENDS_AT_HOUR } = require('./dailyIncomeReport');
const { toDialable } = require('./phoneNumber');

const SECTION = 'owner_reports';
// «محتاج اقدر اغير فيه يبعتلي ايه واحدد عناصر معينه» (8 Oct 2026): the parts of
// the message, in its order; the owner ticks which go. All of them until then.
const REPORT_PARTS = Object.freeze([
  ['income', 'إجمالي الدخل'], ['review', 'المقبول وتحت المراجعة'], ['teams', 'الدخل لكل فريق'],
  ['counts', 'الليدز والحجوزات والشهادات'], ['link', 'رابط التفاصيل'],
]);
const PART_KEYS = REPORT_PARTS.map(([key]) => key);
// The parts of the longer report this replaced, onto the ones that carry what they showed: an owner who had unticked some keeps the rest.
const OLD_PART = {
  branches: 'teams', sales: 'teams', salesLeaders: 'teams', collection: 'teams', daqqi: 'teams', tagamoa: 'teams',
  pending: 'review', leads: 'counts', certificates: 'counts', support: 'counts', consultations: 'counts', topCourses: 'counts',
};
const DEFAULTS = { enabled: false, phones: [], hour: DAY_ENDS_AT_HOUR + 2, parts: PART_KEYS };
const DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function partsOf(stored) {
  if (!Array.isArray(stored)) return DEFAULTS.parts;
  const kept = [...new Set(stored.map(part => (PART_KEYS.includes(part) ? part : OLD_PART[part])).filter(Boolean))];
  return kept.length ? PART_KEYS.filter(key => kept.includes(key)) : DEFAULTS.parts;
}

// Not before the day closes: a report set for the morning goes out at the default hour, after 19:00.
function hourOf(value) {
  const hour = Number(value);
  return Number.isInteger(hour) && hour >= DAY_ENDS_AT_HOUR && hour <= 23 ? hour : DEFAULTS.hour;
}

async function ownerReportSettings(tenantId, db = pool) {
  const stored = await getTenantSetting(SECTION, { tenantId, fallback: {}, db }).catch(() => ({}));
  return {
    enabled: stored?.enabled === true,
    phones: (Array.isArray(stored?.phones) ? stored.phones : []).map(String).filter(phone => toDialable(phone)).slice(0, 5),
    hour: hourOf(stored?.hour),
    parts: partsOf(stored?.parts),
  };
}

const n = value => Math.round(Number(value) || 0).toLocaleString('en-US');
const bar = share => {
  const filled = Math.max(0, Math.min(10, Math.round(share * 10)));
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
};
const RULE = '━━━━━━━━━━━━━━━';

const TEAM_LINES = [
  ['collection', '🌐', 'تحصيل الأونلاين'],
  ['daqqi', '🏢', 'فريق الدقي'],
  ['sales', '🎯', 'فريق المبيعات'],
  ['tagamoa', '🏛', 'فريق التجمع'],
  ['other', '▫️', 'بدون فريق'],
];

/** The day's report as one WhatsApp message, with the parts chosen (all when none was saved). */
function composeOwnerReport(report, parts = PART_KEYS) {
  const want = new Set(parts);
  const { income, counts, teams } = report;
  const [y, m, d] = report.date.split('-').map(Number);
  const day = DAYS[new Date(`${report.date}T12:00:00Z`).getUTCDay()];
  const lines = [
    RULE,
    '📊 *تقرير المعهد اليومي*',
    `🗓 ${day} ${d} ${MONTHS[m - 1]} ${y}`,
    `⏱ من 7 م امبارح لحد 7 م${report.open ? ' · *لسه مفتوح*' : ''}`,
    RULE,
  ];
  if (want.has('income')) {
    lines.push('', '💰 *إجمالي الدخل*', `*${n(income.totalEgp)} ج.م* · ${n(income.payments)} دفعة`);
  }
  if (want.has('review')) {
    lines.push(
      '',
      `✅ اتقبل: *${n(income.acceptedEgp)}* ج.م (${n(income.acceptedN)})`,
      `⏳ تحت المراجعة: *${n(income.reviewEgp)}* ج.م (${n(income.reviewN)})`,
    );
    if (income.failedN) lines.push(`❌ مرفوض: ${n(income.failedN)}`);
  }
  if (want.has('teams')) {
    lines.push('', `${RULE.slice(0, 5)} 👥 *الدخل لكل فريق* ${RULE.slice(0, 5)}`);
    for (const [key, icon, label] of TEAM_LINES) {
      const team = teams[key];
      // Tagamoa and «no team» only once they have something to say.
      if ((key === 'tagamoa' || key === 'other') && !team.totalEgp) continue;
      const share = income.totalEgp ? team.totalEgp / income.totalEgp : 0;
      lines.push(`${icon} *${label}* — ${n(team.totalEgp)} ج.م · ${Math.round(share * 100)}%`, bar(share));
    }
  }
  if (want.has('counts')) {
    lines.push(
      '',
      `${RULE.slice(0, 5)} 📈 *اليوم في أرقام* ${RULE.slice(0, 5)}`,
      `📥 ليدز جديدة: *${n(counts.newLeads)}*`,
      `🛒 حجوزات كورسات جديدة: *${n(counts.newBookings)}*`,
      `🎓 شهادات: *${n(counts.certificatesRequested)}* اتطلبت · *${n(counts.certificatesIssued)}* اتصدرت`,
    );
  }
  if (want.has('link')) lines.push('', '🔗 https://admin.mahadnafsy.com/dashboard/management_reports');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Build and send the report of the day given (today's, by default: the day that closes at 19:00 today).
 * `force` sends even when the daily report is switched off — the «ابعت
 * دلوقتي» button, which still needs a number. Before 19:00 it sends the day
 * so far, and says it is still open.
 *
 * `queue`: the scheduled report goes through the outbox like every other
 * message the system sends on its own — one per number per day by its key,
 * retried there, and visible in «رسايل العملاء» when it dies. The button
 * sends directly: the owner pressed it and is waiting to hear whether it
 * arrived, and only the provider's own answer says that.
 */
async function sendOwnerDailyReport({ tenantId, date = cairoToday(), force = false, queue = false }, db = pool) {
  const settings = await ownerReportSettings(tenantId, db);
  if (!settings.phones.length) return { sent: 0, reason: 'no_numbers' };
  if (!settings.enabled && !force) return { sent: 0, reason: 'disabled' };
  const report = await buildDailyIncomeReport({ tenantId, date }, db);
  const text = composeOwnerReport(report, settings.parts);
  if (queue) {
    const outbox = require('./outbox');
    let queued = 0;
    for (const phone of settings.phones) {
      const id = await outbox.enqueue({
        channel: 'whatsapp', recipient: toDialable(phone), tenantId, refType: 'owner_report', refId: date,
        dedupeKey: `owner-report:${date}:${toDialable(phone)}`,
        payload: { message: text, category: 'owner_report' },
      }, db);
      if (id) queued += 1;
    }
    return { sent: 0, queued };
  }
  const { sendWhatsApp } = require('./whatsapp');
  const results = [];
  for (const phone of settings.phones) {
    results.push({ phone, ...(await sendWhatsApp(phone, text, { tenantId, category: 'owner_report' })) });
  }
  return { sent: results.filter(result => result.ok).length, results: results.map(({ phone, ok, reason }) => ({ phone, ok, reason: ok ? undefined : String(reason || '') })) };
}

/** Called by the scheduler every few minutes: queue today's report once its hour has come (never before the day closes at 19:00). */
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

module.exports = { REPORT_PARTS, SECTION, composeOwnerReport, hourOf, ownerReportSettings, partsOf, queueDueOwnerReports, sendOwnerDailyReport };
