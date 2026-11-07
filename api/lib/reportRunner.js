'use strict';

/**
 * «تقارير الإدارة», organised (7 Nov 2026): every report is one entry — a group (sales, finance, collections, HR, marketing, operations), a one-line description and a
 * run(range) that answers { columns, rows, notes } — so the page lists them the same way, and exports (CSV, fetched on click) and prints any of them the same way.
 *
 * The existing figures (income by branch, department, type and day, the best-selling courses, the sources, the leaders) come from buildManagementReport, unchanged:
 * the numbers here and on the team pages are one number. The new ones — the daily digest, staff productivity, client retention by cohort, the branch comparison and the
 * instalment ageing — are computed here from the database.
 */

const { pool, cached } = require('./db');
const { addDaysToDateOnly, cairoDayStartUtc, cairoToday } = require('./dates');
const { buildManagementReport } = require('./managementReport');
const { buildPerformance } = require('./performanceBoard');
const { buildOverviewBoard } = require('./overviewBoard');
const { listPresence } = require('./staffPresence');

const num = value => Number(value) || 0;
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

const GROUPS = {
  sales: 'المبيعات', finance: 'المالية', collections: 'التحصيل', hr: 'الموارد البشرية', marketing: 'التسويق', operations: 'العمليات',
};
const col = (key, label, kind = 'text') => ({ key, label, kind });
const MONEY_COLS = [col('label', 'البند'), col('payments', 'عدد الدفعات', 'number'), col('moneyEgp', 'المبلغ (ج.م)', 'money')];

// The management report of a range, built once and shared by the reports that read it (30 s, dropped by the next write like every figure).
const managementOf = (tenantId, range) => cached(`figures:mgmt:${tenantId}:${range.from}:${range.to}`, 30 * 1000, () => buildManagementReport({ tenantId, ...range }));
const leadersRows = rows => rows.map((row, i) => ({ rank: i + 1, name: row.name, value: row.value }));
const LEADER_COLS = valueLabel => [col('rank', '#', 'number'), col('name', 'الاسم'), col('value', valueLabel, 'number')];

async function dailyDigest(tenantId, range) {
  const board = await buildOverviewBoard(tenantId, { today: range.to });
  const { today, yesterday, lastWeek } = board.periods;
  const rows = [['leads', 'ليدات جديدة'], ['bookings', 'حجوزات'], ['courseMoney', 'تحصيل الكورسات (ج)'], ['certificateMoney', 'تحصيل الشهادات (ج)'], ['expenses', 'مصروفات (ج)'], ['net', 'الصافي (ج)']]
    .map(([key, label]) => ({ label, today: today[key], yesterday: yesterday[key], lastWeek: lastWeek[key], change: pct(today[key], yesterday[key]) }));
  const { alerts } = board;
  const notes = [];
  if (alerts.overdueInstallments.count) notes.push(`${alerts.overdueInstallments.count} قسط متأخر عند ${alerts.overdueInstallments.clients} عميل`);
  if (alerts.leadsWithoutFollowUp.count) notes.push(`${alerts.leadsWithoutFollowUp.count} ليد مفتوح من غير موعد متابعة`);
  if (alerts.collection.belowTarget) notes.push(`التحصيل ${alerts.collection.pctOfPace}٪ من المفروض لحد النهارده (${alerts.collection.collected} من ${alerts.collection.target})`);
  return {
    columns: [col('label', 'المؤشر'), col('today', range.to === cairoToday() ? 'النهارده' : range.to, 'number'), col('yesterday', 'اليوم اللي قبله', 'number'), col('lastWeek', 'نفس اليوم الأسبوع اللي فات', 'number'), col('change', 'التغيير ٪', 'number')],
    rows, notes,
  };
}

// «إنتاجية الموظفين»: what each member of staff did in the system — actions from the activity log, the hours in which they did anything (a distinct hour with at least
// one action counts as an active hour), and so the actions per active hour; and, for today, when they first appeared and were last seen (staff_presence).
async function staffProductivity(tenantId, range) {
  const [[rows], presence] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, s.role, COUNT(*) AS actions, COUNT(DISTINCT DATE_FORMAT(a.at, '%Y-%m-%d %H')) AS active_hours, COUNT(DISTINCT DATE(a.at)) AS active_days
         FROM activity_logs a JOIN staff s ON s.tenant_id = a.tenant_id AND s.email = a.actor
        WHERE a.tenant_id = ? AND a.at >= ? AND a.at < ? AND s.is_active = 1 AND s.deleted_at IS NULL GROUP BY s.id, s.name, s.role`,
      [tenantId, cairoDayStartUtc(range.from), cairoDayStartUtc(addDaysToDateOnly(range.to, 1))]),
    listPresence(tenantId),
  ]);
  const seen = new Map(presence.map(p => [p.staffKey, p]));
  const clock = ms => (ms ? new Date(ms).toISOString().slice(11, 16) : '—');
  return {
    columns: [col('name', 'الموظف'), col('role', 'الوظيفة'), col('actions', 'عدد الإجراءات', 'number'), col('activeHours', 'ساعات النشاط', 'number'), col('perHour', 'إجراء في الساعة', 'number'),
      col('activeDays', 'أيام النشاط', 'number'), col('firstSeenToday', 'أول ظهور النهارده (UTC)'), col('lastSeen', 'آخر ظهور (UTC)')],
    rows: rows.map(row => ({
      name: row.name, role: row.role, actions: num(row.actions), activeHours: num(row.active_hours), perHour: num(row.active_hours) ? Math.round((num(row.actions) / num(row.active_hours)) * 10) / 10 : 0,
      activeDays: num(row.active_days), firstSeenToday: clock(seen.get(String(row.id))?.firstSeenToday), lastSeen: clock(seen.get(String(row.id))?.lastSeenAt),
    })).sort((a, b) => b.actions - a.actions),
    notes: ['الأوقات بتوقيت UTC (القاهرة = +2 أو +3). ساعة النشاط = ساعة فيها إجراء واحد على الأقل في سجل النشاط.'],
  };
}

// «الاحتفاظ بالعملاء»: each signup month's clients and the share of them that paid for a course in the month of signing up and in the three after it.
async function cohortRetention(tenantId, range) {
  const first = `${addDaysToDateOnly(range.to, -150).slice(0, 7)}-01`;
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(s.created_at, '%Y-%m') AS cohort, TIMESTAMPDIFF(MONTH, DATE_FORMAT(s.created_at, '%Y-%m-01'), DATE_FORMAT(p.date, '%Y-%m-01')) AS k, COUNT(DISTINCT s.id) AS paid
       FROM subscribers s JOIN payments p ON p.tenant_id = s.tenant_id AND p.subscriber_id = s.id AND p.status = 'paid' AND p.deleted_at IS NULL
        AND (p.payment_type IS NULL OR UPPER(p.payment_type) <> 'CERTIFICATE') AND p.date >= s.created_at
      WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND s.created_at >= ? AND s.created_at < ? GROUP BY 1, 2`,
    [tenantId, cairoDayStartUtc(first), cairoDayStartUtc(addDaysToDateOnly(range.to, 1))]);
  const [sizes] = await pool.query(
    "SELECT DATE_FORMAT(created_at, '%Y-%m') AS cohort, COUNT(*) AS n FROM subscribers WHERE tenant_id = ? AND deleted_at IS NULL AND created_at >= ? AND created_at < ? GROUP BY 1 ORDER BY 1",
    [tenantId, cairoDayStartUtc(first), cairoDayStartUtc(addDaysToDateOnly(range.to, 1))]);
  const paid = new Map(rows.map(row => [`${row.cohort}:${num(row.k)}`, num(row.paid)]));
  const share = (cohort, k, size) => (size ? Math.round((num(paid.get(`${cohort}:${k}`)) / size) * 100) : 0);
  return {
    columns: [col('cohort', 'شهر التسجيل'), col('size', 'عدد العملاء', 'number'), col('m0', 'دفع في نفس الشهر ٪', 'number'), col('m1', 'بعد شهر ٪', 'number'), col('m2', 'بعد شهرين ٪', 'number'), col('m3', 'بعد 3 شهور ٪', 'number')],
    rows: sizes.map(size => ({ cohort: size.cohort, size: num(size.n), m0: share(size.cohort, 0, num(size.n)), m1: share(size.cohort, 1, num(size.n)), m2: share(size.cohort, 2, num(size.n)), m3: share(size.cohort, 3, num(size.n)) })),
    notes: ['النسبة = عملاء الشهر ده اللي دفعوا فلوس كورسات (من غير الشهادات) في الشهر المذكور ÷ كل عملاء الشهر.'],
  };
}

async function branchComparison(tenantId, range) {
  const [performance, [expenses], [clients]] = await Promise.all([
    buildPerformance(tenantId, range),
    pool.query("SELECT COALESCE(NULLIF(b.branch_key, ''), e.branch_id) AS branch, COALESCE(SUM(COALESCE(e.amount_egp, IF(e.currency = 'EGP', e.amount, 0))), 0) AS expenses FROM expenses e LEFT JOIN branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id WHERE e.tenant_id = ? AND e.deleted_at IS NULL AND e.date >= ? AND e.date < ? GROUP BY 1",
      [tenantId, cairoDayStartUtc(range.from), cairoDayStartUtc(addDaysToDateOnly(range.to, 1))]),
    pool.query("SELECT COALESCE(branch, 'OTHER') AS branch, COUNT(*) AS n FROM subscribers WHERE tenant_id = ? AND deleted_at IS NULL AND created_at >= ? AND created_at < ? GROUP BY 1",
      [tenantId, cairoDayStartUtc(range.from), cairoDayStartUtc(addDaysToDateOnly(range.to, 1))]),
  ]);
  const spent = new Map(expenses.map(row => [String(row.branch).toUpperCase(), num(row.expenses)]));
  const clientsBy = new Map(clients.map(row => [row.branch, num(row.n)]));
  return {
    columns: [col('branch', 'الفرع'), col('received', 'ليدات', 'number'), col('converted', 'اتحول', 'number'), col('rate', 'التحويل ٪', 'number'), col('newClients', 'عملاء جدد', 'number'),
      col('revenue', 'مبيعات (ج)', 'money'), col('collections', 'تحصيل (ج)', 'money'), col('certificates', 'شهادات (ج)', 'money'), col('expenses', 'مصروفات (ج)', 'money'), col('net', 'الصافي (ج)', 'money')],
    rows: performance.branches.map(b => {
      const expense = Math.round(num(spent.get(b.branch)));
      return { branch: b.branch, received: b.received, converted: b.converted, rate: b.rate, newClients: num(clientsBy.get(b.branch)), revenue: b.revenue, collections: b.collections, certificates: b.certificates, expenses: expense, net: b.total - expense };
    }),
    notes: ['الصافي = مبيعات + تحصيل الكورسات − مصروفات الفرع (الشهادات منفصلة).'],
  };
}

async function instalmentAgeing(tenantId, range) {
  const today = range.to;
  const buckets = [['1–7 أيام', 1, 7], ['8–30 يوم', 8, 30], ['31–90 يوم', 31, 90], ['أكتر من 90 يوم', 91, 100000]];
  const sums = buckets.map(([, from, to]) => `SUM(DATEDIFF(?, e.due_date) BETWEEN ${from} AND ${to}) AS b${from}`).join(', ');
  const [[row]] = await pool.query(`SELECT ${sums}, COUNT(DISTINCT e.subscriber_id) AS clients FROM installment_entries e WHERE e.tenant_id = ? AND e.paid = 0 AND e.due_date < ?`, [...buckets.map(() => today), tenantId, today]);
  return {
    columns: [col('label', 'مدة التأخير'), col('count', 'عدد الأقساط', 'number')],
    rows: buckets.map(([label, from]) => ({ label, count: num(row[`b${from}`]) })),
    notes: [`${num(row.clients)} عميل عليه قسط متأخر.`],
  };
}

const income = key => async (tenantId, range) => ({ columns: MONEY_COLS, rows: (await managementOf(tenantId, range)).income[key] });
const REPORTS = [
  { key: 'daily-digest', group: 'operations', title: 'الملخص اليومي للإدارة', description: 'إيه اللي اتغير النهارده عن إمبارح وعن نفس اليوم الأسبوع اللي فات، وأي حاجة محتاجة تدخل.', run: dailyDigest },
  { key: 'branch-comparison', group: 'operations', title: 'مقارنة الفروع', description: 'كل فرع جنب التاني: ليدات، تحويل، عملاء جدد، مبيعات، تحصيل، مصروفات وصافي.', run: branchComparison },
  { key: 'cohort-retention', group: 'operations', title: 'احتفاظ العملاء بالشهور', description: 'من كل شهر تسجيل، كام في المية دفعوا في نفس الشهر وبعده بشهر وشهرين و3.', run: cohortRetention },
  { key: 'income-by-branch', group: 'finance', title: 'الدخل حسب الفرع', description: 'اللي اتدفع في الفترة لكل فرع، بالجنيه وقت الدفع.', run: income('byBranch') },
  { key: 'income-by-department', group: 'finance', title: 'الدخل حسب القسم', description: 'الدقي والتجمع والأونلاين كل واحد لوحده.', run: income('byDepartment') },
  { key: 'income-by-type', group: 'finance', title: 'الدخل حسب النوع', description: 'كورسات، شهادات، استشارات، كتب، كارنيهات — كل نوع لوحده.', run: income('byType') },
  { key: 'income-by-day', group: 'finance', title: 'الدخل يوم بيوم', description: 'مجموع كل يوم في الفترة.', run: async (tenantId, range) => ({
    columns: [col('day', 'اليوم'), col('payments', 'عدد الدفعات', 'number'), col('moneyEgp', 'المبلغ (ج.م)', 'money')], rows: (await managementOf(tenantId, range)).income.byDay }) },
  { key: 'installment-ageing', group: 'collections', title: 'تأخر الأقساط', description: 'الأقساط المتأخرة موزعة على مدة التأخير، لحد آخر يوم في الفترة.', run: instalmentAgeing },
  { key: 'collection-leaders', group: 'collections', title: 'أكتر تحصيل', description: 'مسؤولو التحصيل حسب الفلوس اللي حصّلوها في الفترة.', run: async (tenantId, range) => ({ columns: LEADER_COLS('المبلغ (ج.م)'), rows: leadersRows((await managementOf(tenantId, range)).leaders.collectionByMoney) }) },
  { key: 'sales-by-money', group: 'sales', title: 'أكتر سيلز حقق فلوس', description: 'ترتيب السيلز بالفلوس اللي اتسجلت باسمهم في الفترة.', run: async (tenantId, range) => ({ columns: LEADER_COLS('المبلغ (ج.م)'), rows: leadersRows((await managementOf(tenantId, range)).leaders.salesByMoney) }) },
  { key: 'sales-by-calls', group: 'sales', title: 'أكتر سيلز مكالمات', description: 'ترتيب السيلز بعدد المكالمات في الفترة.', run: async (tenantId, range) => ({ columns: LEADER_COLS('المكالمات'), rows: leadersRows((await managementOf(tenantId, range)).leaders.salesByCalls) }) },
  { key: 'top-courses', group: 'sales', title: 'أكتر 10 كورسات مبيعاً', description: 'الحجوزات والعملاء والفلوس لكل كورس أو مسار.', run: async (tenantId, range) => ({
    columns: [col('title', 'الكورس / المسار'), col('bookings', 'حجوزات', 'number'), col('clients', 'عملاء', 'number'), col('moneyEgp', 'المبلغ (ج.م)', 'money')], rows: (await managementOf(tenantId, range)).topCourses }) },
  { key: 'top-sources', group: 'marketing', title: 'أكتر مصادر جابت عملاء', description: 'الليدات من كل مصدر وكام منهم بقى عميل.', run: async (tenantId, range) => ({
    columns: [col('source', 'المصدر'), col('leads', 'ليدات', 'number'), col('converted', 'اتحولوا عملاء', 'number'), col('rate', 'النسبة ٪', 'number')], rows: (await managementOf(tenantId, range)).topSources }) },
  { key: 'staff-productivity', group: 'hr', title: 'إنتاجية الموظفين', description: 'إجراءات كل موظف في السيستم، ساعات نشاطه، والإجراءات في الساعة.', run: staffProductivity },
  { key: 'support-resolved', group: 'hr', title: 'خدمة العملاء — مشاكل اتحلت', description: 'ترتيب فريق الخدمة بعدد المشاكل اللي اتحلت في الفترة.', run: async (tenantId, range) => ({ columns: LEADER_COLS('مشاكل اتحلت'), rows: leadersRows((await managementOf(tenantId, range)).leaders.supportByResolved) }) },
];
const byKey = new Map(REPORTS.map(report => [report.key, report]));

const catalog = () => REPORTS.map(({ key, group, title, description }) => ({ key, group, groupLabel: GROUPS[group], title, description }));

/** One report over a range: { key, group, title, description, from, to, columns, rows, notes }; null for a key that is no report. */
async function runReport(key, tenantId, range) {
  const report = byKey.get(key);
  if (!report) return null;
  const { columns, rows, notes = [] } = await report.run(tenantId, range);
  return { key, group: report.group, groupLabel: GROUPS[report.group], title: report.title, description: report.description, from: range.from, to: range.to, columns, rows, notes };
}

module.exports = { GROUPS, REPORTS, catalog, runReport };
