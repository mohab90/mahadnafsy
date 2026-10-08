'use strict';

// «إحصائياتي» for a sales rep (8 Oct 2026): «صفحه تفاعليه … تفرح مع كل حجز
// السيلز بيعمله وتزعل لما التارجيت يكون بعيد … وتتفاعل معاه في كل حجز وكل
// عميل جديد». The figures are the managers' own (lib/teamDailyReport.js, the
// rep's row), so what cheers the rep is what their manager reads. Around them:
// the month's target, the run of days with a booking, the best day, and the
// latest bookings and clients — the events the page celebrates.

const { pool } = require('./db');
const { addDaysToDateOnly, cairoDayStartUtc, cairoToday } = require('./dates');
const { PAYMENT_EGP_SQL, PAYMENT_REP_SQL, buildTeamDailyReport } = require('./teamDailyReport');

const num = value => Number(value) || 0;
const daysInMonth = ymd => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).getUTCDate();
const asDay = value => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  : String(value || '').slice(0, 10));

const PAID_BY_REP = `FROM payments p
       LEFT JOIN subscribers sub ON sub.id=p.subscriber_id AND sub.tenant_id=p.tenant_id
       LEFT JOIN leads l ON l.id=sub.lead_id AND l.tenant_id=sub.tenant_id
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status='paid')
        AND ${PAYMENT_REP_SQL}=?`;

/** Days in a row, back from today (or from yesterday, while today is still open), with a booking. */
function streakOf(bookingDays, today) {
  let day = bookingDays.has(today) ? today : addDaysToDateOnly(today, -1);
  let streak = 0;
  while (bookingDays.has(day)) { streak += 1; day = addDaysToDateOnly(day, -1); }
  return streak;
}

async function buildSalesPulse({ tenantId, staffId, today = cairoToday() }, db = pool) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const [monthReport, todayReport] = await Promise.all([
    buildTeamDailyReport({ tenantId, from: monthStart, to: today, today, onlyRepId: staffId }, db),
    buildTeamDailyReport({ tenantId, from: today, to: today, today, onlyRepId: staffId }, db),
  ]);
  const pick = report => {
    const row = report.reps[0] || {};
    return {
      bookings: num(row.bookings), installments: num(row.installments), moneyEgp: num(row.moneyEgp),
      newLeads: num(row.newLeads), contacts: num(row.contacts), calls: num(row.calls), whatsapp: num(row.whatsapp),
      followUpsDue: num(row.followUpsDue), followUpsOverdue: num(row.followUpsOverdue),
    };
  };

  const since = addDaysToDateOnly(today, -60);
  const [[target], [days], [recentPaid], [recentLeads]] = await Promise.all([
    db.query(
      'SELECT revenue_target AS revenueTarget, leads_target AS leadsTarget FROM sales_targets WHERE tenant_id=? AND staff_id=? AND period=? LIMIT 1',
      [tenantId, staffId, today.slice(0, 7)]),
    db.query(
      `SELECT p.date AS day, SUM(p.is_installment=0) AS bookings, SUM(${PAYMENT_EGP_SQL}) AS moneyEgp
       ${PAID_BY_REP} AND p.date >= ?
       GROUP BY p.date`,
      [tenantId, staffId, since]),
    db.query(
      `SELECT p.id, p.date AS day, p.created_at AS at, p.is_installment AS installment, ${PAYMENT_EGP_SQL} AS amountEgp,
              COALESCE(NULLIF(p.item_title, ''), '') AS item, COALESCE(sub.name, '') AS name
       ${PAID_BY_REP} AND p.date >= ?
       ORDER BY p.created_at DESC LIMIT 15`,
      [tenantId, staffId, addDaysToDateOnly(today, -2)]),
    db.query(
      `SELECT id, name, assigned_at AS at FROM leads
        WHERE tenant_id=? AND hidden=0 AND assigned_sales_id=? AND assigned_at >= ?
        ORDER BY assigned_at DESC LIMIT 15`,
      [tenantId, staffId, cairoDayStartUtc(addDaysToDateOnly(today, -2))]),
  ]);

  const perDay = days.map(row => ({ day: asDay(row.day), bookings: num(row.bookings), moneyEgp: Math.round(num(row.moneyEgp)) }));
  const thisMonth = perDay.filter(row => row.day >= monthStart);
  const best = thisMonth.reduce((top, row) => (row.moneyEgp > (top?.moneyEgp || 0) ? row : top), null);

  const recent = [
    ...recentPaid.map(row => ({
      kind: row.installment ? 'installment' : 'booking', id: `pay:${row.id}`, at: row.at, day: asDay(row.day),
      name: row.name, item: row.item, amountEgp: Math.round(num(row.amountEgp)),
    })),
    ...recentLeads.map(row => ({ kind: 'lead', id: `lead:${row.id}`, at: row.at, name: row.name || '' })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 20);

  return {
    today, monthStart, dayOfMonth: Number(today.slice(8, 10)), daysInMonth: daysInMonth(today),
    month: pick(monthReport), todayFigures: pick(todayReport),
    target: { revenue: num(target[0]?.revenueTarget), leads: num(target[0]?.leadsTarget) },
    streak: streakOf(new Set(perDay.filter(row => row.bookings > 0).map(row => row.day)), today),
    bestDay: best && best.moneyEgp > 0 ? best : null,
    recent,
  };
}

module.exports = { buildSalesPulse, streakOf };
