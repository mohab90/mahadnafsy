'use strict';

// The owner's WhatsApp report (lib/ownerDailyReport.js): the day's income, how much of it is accepted and how much waits for review, what
// each of the three teams brought in, and how many leads, bookings and certificates the day had.
//
// «اليوم نهايته الساعه 7 … فاي دخل جديد من بعد 7 يتحسب في اليوم الجديد» (31 Oct 2026): the day named D runs from 19:00 Cairo on the day
// before to 19:00 on D. Money belongs to the day it was RECORDED (payments.created_at), not to the date typed on it, so a payment entered
// at 19:30 is tomorrow's even when it carries today's date.
//
// The total is everything entered, accepted or not («اجمالي الدخل سواء اتقبل او لاء»): paid plus pending. A rejected payment is not income;
// it is counted on its own line.
//
// Who «brought in» a payment, in the order the system can tell:
//   1. a payment of the Dokki branch is the Dokki team's (Tagamoa's: its own line, shown when it has money);
//   2. otherwise the employee who recorded it: a collection officer → التحصيل, a sales rep or sales manager → المبيعات;
//   3. otherwise the client's owner: the collection officer the client is handed to, else the sales rep.
// 90 of 97 payments of September 2026 named no recorder, which is why the client's owner is the fallback.

const { pool } = require('./db');
const { cairoWallUtc, addDaysToDateOnly } = require('./dates');
const { ITEM_PAYMENT_SQL } = require('./agreedPrice');

const num = value => Number(value) || 0;
const MONEY_EGP = "COALESCE(p.amount_egp, CASE WHEN p.currency='EGP' THEN p.amount ELSE 0 END)";
const DAY_ENDS_AT_HOUR = 19;

const TEAM_OF = `CASE
    WHEN p.branch='DAQQI' THEN 'daqqi'
    WHEN p.branch='TAGAMOA' THEN 'tagamoa'
    WHEN UPPER(st.role)='COLLECTION' THEN 'collection'
    WHEN UPPER(st.role) IN ('SALES','SALES_COLLECTION_MANAGER','ONLINE_MANAGER') THEN 'sales'
    WHEN sub.assigned_cs_id IS NOT NULL AND sub.assigned_cs_id<>'' THEN 'collection'
    WHEN sub.assigned_sales_id IS NOT NULL AND sub.assigned_sales_id<>'' THEN 'sales'
    ELSE 'other'
  END`;

/** [start, end) in UTC of the business day named `date`: 19:00 the day before to 19:00 that day. */
function businessDayBounds(date) {
  return {
    startUtc: cairoWallUtc(addDaysToDateOnly(date, -1), DAY_ENDS_AT_HOUR),
    endUtc: cairoWallUtc(date, DAY_ENDS_AT_HOUR),
  };
}

async function buildDailyIncomeReport({ tenantId, date, now = new Date() }, db = pool) {
  const { startUtc, endUtc } = businessDayBounds(date);
  const [byTeam] = await db.query(
    `SELECT ${TEAM_OF} AS team, p.status AS status, COUNT(*) AS n, SUM(${MONEY_EGP}) AS money
       FROM payments p
       LEFT JOIN staff st ON st.id=p.staff_id AND st.tenant_id=p.tenant_id
       LEFT JOIN subscribers sub ON sub.id=p.subscriber_id AND sub.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status IN ('paid','pending','failed')
        AND p.created_at >= ? AND p.created_at < ?
      GROUP BY 1, 2`,
    [tenantId, startUtc, endUtc]
  );
  const [[counts]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM leads WHERE tenant_id=? AND hidden=0 AND created_at >= ? AND created_at < ?) AS newLeads,
       (SELECT COUNT(DISTINCT CONCAT(p.subscriber_id, '|', COALESCE(p.bundle_id, p.course_id))) FROM payments p
         WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status IN ('paid','pending') AND p.is_installment=0
           AND (p.course_id IS NOT NULL OR p.bundle_id IS NOT NULL) AND ${ITEM_PAYMENT_SQL}
           AND p.created_at >= ? AND p.created_at < ?) AS newBookings,
       (SELECT COUNT(*) FROM certificate_requests WHERE tenant_id=? AND requested_at >= ? AND requested_at < ?) AS certificatesRequested,
       (SELECT COUNT(*) FROM certificate_requests WHERE tenant_id=? AND issued_at >= ? AND issued_at < ?) AS certificatesIssued`,
    [tenantId, startUtc, endUtc, tenantId, startUtc, endUtc, tenantId, startUtc, endUtc, tenantId, startUtc, endUtc]
  );

  const empty = () => ({ acceptedEgp: 0, acceptedN: 0, reviewEgp: 0, reviewN: 0 });
  const teams = { collection: empty(), daqqi: empty(), sales: empty(), tagamoa: empty(), other: empty() };
  let failedN = 0;
  for (const row of byTeam) {
    if (row.status === 'failed') { failedN += num(row.n); continue; }
    const team = teams[row.team] || teams.other;
    if (row.status === 'paid') { team.acceptedEgp += num(row.money); team.acceptedN += num(row.n); }
    else { team.reviewEgp += num(row.money); team.reviewN += num(row.n); }
  }
  const sum = key => Object.values(teams).reduce((total, team) => total + team[key], 0);
  const withTotals = Object.fromEntries(Object.entries(teams).map(([key, team]) => [key, {
    ...team,
    totalEgp: Math.round(team.acceptedEgp + team.reviewEgp),
    payments: team.acceptedN + team.reviewN,
  }]));
  return {
    date, startUtc, endUtc,
    // The day is still running when its end is ahead of the clock.
    open: new Date(`${endUtc.replace(' ', 'T')}Z`).getTime() > now.getTime(),
    income: {
      totalEgp: Math.round(sum('acceptedEgp') + sum('reviewEgp')),
      payments: sum('acceptedN') + sum('reviewN'),
      acceptedEgp: Math.round(sum('acceptedEgp')), acceptedN: sum('acceptedN'),
      reviewEgp: Math.round(sum('reviewEgp')), reviewN: sum('reviewN'),
      failedN,
    },
    teams: withTotals,
    counts: {
      newLeads: num(counts?.newLeads), newBookings: num(counts?.newBookings),
      certificatesRequested: num(counts?.certificatesRequested), certificatesIssued: num(counts?.certificatesIssued),
    },
  };
}

module.exports = { buildDailyIncomeReport, businessDayBounds, DAY_ENDS_AT_HOUR, TEAM_OF };
