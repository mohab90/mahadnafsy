'use strict';

// «صفحه في قسم الادارة تجمع فيها كل التقارير دي واكتر مع تقارير محاسبيه عن
// الدخل اليوم لكل قسم وكل فرع في صفحة واحدة … ويبقي فيها اكتر الكورسات مبيعا
// 10 بالترتيب واكتر مصدر جاب عملاء واكتر سيلز حقق واكتر تحصيل حصل وكل شئ عن
// الاداء في تقرير واحد».
//
// Money is what was paid in the range (payments.date, a picked day, compared
// as days), in EGP at the rate stored with each payment. The team sections are
// the team reports themselves, so a figure here and on the team's own page are
// one figure.

const { pool } = require('./db');
const { addDaysToDateOnly, cairoDayStartUtc } = require('./dates');
const { buildTeamDailyReport } = require('./teamDailyReport');
const { buildDaqqiTeamReport, buildTagamoaTeamReport, buildOnlineTeamReport, buildSupportTeamReport, MONEY_EGP } = require('./teamReports');

const num = value => Number(value) || 0;

const BRANCH_LABELS = {
  DAQQI: 'فرع الدقي', TAGAMOA: 'فرع التجمع', ONLINE_EGYPT: 'أونلاين مصر',
  ONLINE_SAUDI: 'أونلاين السعودية', ONLINE_ABROAD: 'أونلاين دولي', OTHER: 'أخرى',
};
const DEPARTMENT_OF = {
  DAQQI: 'الدقي', TAGAMOA: 'التجمع', ONLINE_EGYPT: 'الأونلاين', ONLINE_SAUDI: 'الأونلاين', ONLINE_ABROAD: 'الأونلاين',
};
const TYPE_LABELS = {
  COURSE: 'كورسات ومسارات', BUNDLE: 'كورسات ومسارات', CERTIFICATE: 'شهادات', CONSULTATION: 'استشارات',
  BOOK: 'كتب', CARNEH: 'كارنيهات', OTHER: 'أخرى',
};

function groupInto(rows, labelOf) {
  const out = new Map();
  for (const row of rows) {
    const label = labelOf(row);
    const entry = out.get(label) || { label, payments: 0, moneyEgp: 0 };
    entry.payments += num(row.payments);
    entry.moneyEgp += num(row.moneyEgp);
    out.set(label, entry);
  }
  return [...out.values()]
    .map(entry => ({ ...entry, moneyEgp: Math.round(entry.moneyEgp) }))
    .sort((a, b) => b.moneyEgp - a.moneyEgp);
}

async function buildManagementReport({ tenantId, from, to, today }, db = pool) {
  const startUtc = cairoDayStartUtc(from);
  const endUtc = cairoDayStartUtc(addDaysToDateOnly(to, 1));
  const dayAfter = addDaysToDateOnly(to, 1);

  const [byBranchType] = await db.query(
    `SELECT COALESCE(p.branch,'OTHER') AS branch, COALESCE(p.payment_type,'OTHER') AS type,
            COUNT(*) AS payments, SUM(${MONEY_EGP}) AS moneyEgp
       FROM payments p
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status='paid') AND p.date >= ? AND p.date < ?
      GROUP BY 1, 2`,
    [tenantId, from, dayAfter]
  );
  const [byDay] = await db.query(
    `SELECT DATE_FORMAT(p.date, '%Y-%m-%d') AS day, COUNT(*) AS payments, SUM(${MONEY_EGP}) AS moneyEgp
       FROM payments p
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status='paid') AND p.date >= ? AND p.date < ?
      GROUP BY 1 ORDER BY 1`,
    [tenantId, from, dayAfter]
  );
  // «اكتر الكورسات مبيعا»: bookings are the first payment for an item (not an
  // installment); money is everything paid for it in the range.
  const [topCourses] = await db.query(
    `SELECT COALESCE(p.bundle_id, p.course_id) AS item,
            COALESCE(b.title, c.title_ar, c.title, p.item_title) AS title, IF(p.bundle_id IS NULL, 'course', 'bundle') AS kind,
            SUM(p.is_installment=0) AS bookings, COUNT(DISTINCT p.subscriber_id) AS clients, SUM(${MONEY_EGP}) AS moneyEgp
       FROM payments p
       LEFT JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id
       LEFT JOIN bundles b ON b.id=p.bundle_id AND b.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status='paid') AND p.date >= ? AND p.date < ? AND (p.course_id IS NOT NULL OR p.bundle_id IS NOT NULL)
      GROUP BY 1, 2, 3
      ORDER BY bookings DESC, moneyEgp DESC
      LIMIT 10`,
    [tenantId, from, dayAfter]
  );
  // «اكتر مصدر جاب عملاء»: the leads each source brought in the range, and how
  // many of them are clients now.
  const [sources] = await db.query(
    `SELECT COALESCE(NULLIF(TRIM(source),''), 'بدون مصدر') AS source, COUNT(*) AS leads, SUM(status='converted') AS converted
       FROM leads
      WHERE tenant_id=? AND hidden=0 AND created_at >= ? AND created_at < ?
      GROUP BY 1 ORDER BY leads DESC LIMIT 10`,
    [tenantId, startUtc, endUtc]
  );
  const [[counts]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM leads WHERE tenant_id=? AND hidden=0 AND created_at >= ? AND created_at < ?) AS newLeads,
       (SELECT COUNT(*) FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND created_at >= ? AND created_at < ?) AS newClients,
       (SELECT COUNT(*) FROM payments p WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status='pending') AS pendingPayments`,
    [tenantId, startUtc, endUtc, tenantId, startUtc, endUtc, tenantId]
  );

  const range = { tenantId, from, to, today };
  const [sales, online, support, daqqi, tagamoa] = await Promise.all([
    buildTeamDailyReport(range, db),
    buildOnlineTeamReport(range, db),
    buildSupportTeamReport(range, db),
    buildDaqqiTeamReport(range, db),
    buildTagamoaTeamReport(range, db),
  ]);

  const totalEgp = Math.round(byBranchType.reduce((total, row) => total + num(row.moneyEgp), 0));
  const top = (rows, key) => [...rows].filter(row => num(row[key]) > 0).sort((a, b) => num(b[key]) - num(a[key])).slice(0, 5)
    .map(row => ({ id: row.id, name: row.name, value: num(row[key]) }));

  return {
    from, to, today,
    income: {
      totalEgp,
      payments: byBranchType.reduce((total, row) => total + num(row.payments), 0),
      byBranch: groupInto(byBranchType, row => BRANCH_LABELS[row.branch] || row.branch),
      byDepartment: groupInto(byBranchType, row => DEPARTMENT_OF[row.branch] || 'أخرى'),
      byType: groupInto(byBranchType, row => TYPE_LABELS[row.type] || row.type),
      byDay: byDay.map(row => ({ day: row.day, payments: num(row.payments), moneyEgp: Math.round(num(row.moneyEgp)) })),
    },
    topCourses: topCourses.map(row => ({
      item: row.item, title: row.title || '—', kind: row.kind,
      bookings: num(row.bookings), clients: num(row.clients), moneyEgp: Math.round(num(row.moneyEgp)),
    })),
    topSources: sources.map(row => ({
      source: row.source, leads: num(row.leads), converted: num(row.converted),
      rate: num(row.leads) ? Math.round((num(row.converted) / num(row.leads)) * 1000) / 10 : 0,
    })),
    leaders: {
      salesByMoney: top(sales.reps, 'moneyEgp'),
      salesByCalls: top(sales.reps, 'calls'),
      collectionByMoney: top(online.rows, 'collectedEgp'),
      supportByResolved: top(support.rows, 'problemsResolved'),
      daqqiByMoney: top(daqqi.rows, 'moneyEgp'),
      tagamoaByMoney: top(tagamoa.rows, 'moneyEgp'),
    },
    counts: {
      newLeads: num(counts?.newLeads), newClients: num(counts?.newClients), pendingPayments: num(counts?.pendingPayments),
    },
    teams: { sales, online, support, daqqi, tagamoa },
  };
}

module.exports = { buildManagementReport };
