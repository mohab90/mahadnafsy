'use strict';

/**
 * «نظرة عامة» — the board at the top (7 Nov 2026): today against yesterday and against the same weekday last week, for the leads, the bookings, the money
 * collected (course money and certificate money apart, as every course-money query keeps them) and the expenses with the net; the alerts that want an action;
 * and who is in the system now. One answer, all from the database.
 *
 * A «day» is a Cairo day (its UTC bounds, as overview/revenue reads it). Money is payments.amount_egp of paid, undeleted payments by payments.date; a booking is the first payment for an item (not an
 * instalment). Net is course money less the day's expenses, as the KPI board counts it.
 */

const { pool, cached } = require('./db');
const { addDaysToDateOnly, cairoDayStartUtc, cairoToday } = require('./dates');
const { FOLLOW_UP_OPEN } = require('./leadFollowUps');
const perfMonitor = require('./performanceMonitor');
const { listOnlineUsers } = require('./onlineUsers');
const { listPresence, notePresence, statusOf } = require('./staffPresence');
const { detectAnomalies } = require('./anomalies');

const COURSE_MONEY = "(p.payment_type IS NULL OR UPPER(p.payment_type) <> 'CERTIFICATE')";
const num = value => Number(value) || 0;
const DEFAULT_COLLECTION_TARGET = 160000;
// An endpoint is «slow» for the board when its 95th percentile passes this over at least this many requests since the server started.
const SLOW_P95_MS = 1500;
const SLOW_MIN_REQUESTS = 5;

/** The three days compared, oldest first in the query and named in the answer. */
const daysOf = today => ({ today, yesterday: addDaysToDateOnly(today, -1), lastWeek: addDaysToDateOnly(today, -7) });

async function periods(tenantId, today) {
  const days = daysOf(today);
  const oldest = days.lastWeek;
  const tomorrow = addDaysToDateOnly(today, 1);
  // One pass per table over the eight days; each figure is the sum of the rows of its own day.
  const onDay = column => `(${column} >= ? AND ${column} < ?)`;
  const money = Object.keys(days).map(key => `
      COALESCE(SUM(CASE WHEN ${onDay('p.date')} AND ${COURSE_MONEY} THEN p.amount_egp END), 0) AS ${key}_course,
      COALESCE(SUM(CASE WHEN ${onDay('p.date')} AND UPPER(p.payment_type) = 'CERTIFICATE' THEN p.amount_egp END), 0) AS ${key}_cert,
      COALESCE(SUM(CASE WHEN ${onDay('p.date')} AND ${COURSE_MONEY} AND p.is_installment = 0 THEN 1 END), 0) AS ${key}_bookings`).join(',');
  const leadSums = Object.keys(days).map(key => `COALESCE(SUM(l.created_at >= ? AND l.created_at < ?), 0) AS ${key}`).join(', ');
  const expenseSums = Object.keys(days).map(key => `COALESCE(SUM(CASE WHEN ${onDay('e.date')} THEN COALESCE(e.amount_egp, IF(e.currency = 'EGP', e.amount, 0)) END), 0) AS ${key}`).join(', ');
  const moneyParams = Object.keys(days).flatMap(key => {
    const from = cairoDayStartUtc(days[key]); const to = cairoDayStartUtc(addDaysToDateOnly(days[key], 1));
    return [from, to, from, to, from, to];
  });
  const leadParams = Object.values(days).flatMap(day => [cairoDayStartUtc(day), cairoDayStartUtc(addDaysToDateOnly(day, 1))]);
  const expenseParams = leadParams;
  const [[[m]], [[l]], [[e]]] = await Promise.all([
    pool.query(`SELECT ${money} FROM payments p WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND p.date >= ? AND p.date < ?`,
      [...moneyParams, tenantId, cairoDayStartUtc(oldest), cairoDayStartUtc(tomorrow)]),
    pool.query(`SELECT ${leadSums} FROM leads l WHERE l.tenant_id = ? AND l.deleted_at IS NULL AND l.hidden = 0 AND l.created_at >= ? AND l.created_at < ?`,
      [...leadParams, tenantId, cairoDayStartUtc(oldest), cairoDayStartUtc(tomorrow)]),
    pool.query(`SELECT ${expenseSums} FROM expenses e WHERE e.tenant_id = ? AND e.deleted_at IS NULL AND e.date >= ? AND e.date < ?`,
      [...expenseParams, tenantId, cairoDayStartUtc(oldest), cairoDayStartUtc(tomorrow)]),
  ]);
  const out = {};
  for (const key of Object.keys(days)) {
    const course = num(m[`${key}_course`]); const expenses = num(e[key]);
    out[key] = { day: days[key], leads: num(l[key]), bookings: num(m[`${key}_bookings`]), courseMoney: Math.round(course), certificateMoney: Math.round(num(m[`${key}_cert`])), expenses: Math.round(expenses), net: Math.round(course - expenses) };
  }
  return out;
}

async function collectionPace(tenantId, today) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const [year, month] = today.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dayOfMonth = Number(today.slice(8, 10));
  const [[[sum]], [[target]]] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(p.amount_egp), 0) AS month FROM payments p WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND ${COURSE_MONEY} AND p.date >= ? AND p.date < ?`,
      [tenantId, cairoDayStartUtc(monthStart), cairoDayStartUtc(addDaysToDateOnly(today, 1))]),
    pool.query("SELECT revenue_target FROM sales_targets WHERE tenant_id = ? AND staff_id = '__collection__' AND period = ?", [tenantId, today.slice(0, 7)]),
  ]);
  const goal = num(target?.revenue_target) || DEFAULT_COLLECTION_TARGET;
  const collected = Math.round(num(sum.month));
  const expected = Math.round((goal * dayOfMonth) / daysInMonth);
  return { collected, target: goal, expectedByToday: expected, belowTarget: collected < expected, pctOfPace: expected ? Math.round((collected / expected) * 100) : 100 };
}

// The two counts over the backlogs (150,000 undated leads: 0.8 s; 90,000 overdue instalments: 0.3 s on the lab) are held five minutes, not dropped by writes: a backlog
// that size moves by a few percent in a day, and the board is opened all day by several people.
const backlogs = (tenantId, today) => cached(`overview-board-backlogs:${tenantId}:${today}`, 5 * 60 * 1000, async () => {
  const [[[late]], [[noFollow]]] = await Promise.all([
    pool.query('SELECT COUNT(*) AS n, COUNT(DISTINCT e.subscriber_id) AS clients FROM installment_entries e WHERE e.tenant_id = ? AND e.paid = 0 AND e.due_date < ?', [tenantId, today]),
    pool.query(`SELECT COUNT(*) AS n FROM leads l WHERE l.tenant_id = ? AND l.deleted_at IS NULL AND ${FOLLOW_UP_OPEN} AND l.next_follow_up_date IS NULL AND l.status IN ('new','contacted','interested')`, [tenantId]),
  ]);
  return { late: { count: num(late.n), clients: num(late.clients) }, noFollow: { count: num(noFollow.n) } };
});

async function alertsOf(tenantId, today, { canSeeMonitor }) {
  const [{ late, noFollow }, pace] = await Promise.all([backlogs(tenantId, today), collectionPace(tenantId, today)]);
  const slow = canSeeMonitor
    ? perfMonitor.snapshot({ limit: 50 }).slowest.filter(row => row.p95 >= SLOW_P95_MS && row.count >= SLOW_MIN_REQUESTS).slice(0, 3)
      .map(row => ({ route: row.route, p95: row.p95, count: row.count }))
    : null;
  return {
    overdueInstallments: late,
    leadsWithoutFollowUp: noFollow,
    collection: pace,
    slowEndpoints: slow,
  };
}

// Who is in now, read at every opening (never from the held board): the one asking is in by definition, so they are noted first — their own first beat can
// reach the server after this request and the strip said «0 موظف أونلاين» to the one person looking at it.
async function liveOf(tenantId, now, who = null) {
  if (who) await notePresence(who, { screen: 'overview', now });
  const [presence, clients] = await Promise.all([listPresence(tenantId, { now }), listOnlineUsers(tenantId)]);
  return { staffOnline: presence.filter(row => statusOf(row.lastSeenAt, now) === 'online').length, clientsOnline: clients.length };
}

/** The whole board. `canSeeMonitor` and `canSeePresence` follow the caller's permissions (the answer leaves out what they may not read). */
async function buildOverviewBoard(tenantId, { today = cairoToday(), now = Date.now(), canSeeMonitor = false, canSeePresence = false, withLive = true } = {}) {
  const [periodFigures, alerts, live, anomalies] = await Promise.all([
    periods(tenantId, today), alertsOf(tenantId, today, { canSeeMonitor }), canSeePresence && withLive ? liveOf(tenantId, now) : null,
    detectAnomalies(tenantId, { today, now, canSeeMonitor, canSeePresence }),
  ]);
  return { asOf: new Date(now).toISOString(), today, periods: periodFigures, alerts, live, anomalies };
}

/** The figures held 20 s per tenant and flavour, dropped by the next write like every figure (lib/httpApp.js dropFiguresAfterWrites); who is in, fresh. */
async function cachedBoard(tenantId, options, who = null) {
  const board = await cached(`figures:overview-board:${tenantId}:${cairoToday()}:${options.canSeeMonitor}:${options.canSeePresence}`, 20 * 1000,
    () => buildOverviewBoard(tenantId, { ...options, withLive: false }));
  return options.canSeePresence ? { ...board, live: await liveOf(tenantId, Date.now(), who) } : board;
}

module.exports = { buildOverviewBoard, cachedBoard, SLOW_P95_MS };
