'use strict';
// «لوحة KPI للمدير» — one request, one answer, the numbers a manager opens the panel for: the money (against the same days of last month, not the whole of it),
// the leads and what became of them, the clients, who is at work today, what waits for a decision, who collected most, and the last thirty days.
//
// 5 Nov 2026: it was fourteen queries one after the other (and the page asked again on every visit); they run together now, the answer is held for 30 s under
// «figures:» (dropped by the first write after it, lib/httpApp.js dropFiguresAfterWrites), course money no longer includes certificates, and the series fill the days
// with no payment. Gated like the page: view_financial.

const logger = require('../../lib/logger');
const express = require('express');
const router = express.Router();

const { pool, cached } = require('../../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { dateOnlyInTimeZone, addDaysToDateOnly, cairoDayBoundsUtc, cairoDayStartUtc, cairoToday, sqlCairoWall } = require('../../lib/dates');
const { resolveFinancialScope, financialScopeClause } = require('../../lib/financialScope');
const { CONVERTED_SQL } = require('../../lib/leadStatuses');
const { hasPermission } = require('../../constants/permissions');
const { cachedBoard } = require('../../lib/overviewBoard');

// Certificate money is not course money (every course-money query says so).
const COURSE_MONEY = "(p.payment_type IS NULL OR UPPER(p.payment_type) <> 'CERTIFICATE')";

const monthStartOf = day => `${day.slice(0, 7)}-01`;
function previousMonthStart(day) {
  const [year, month] = day.split('-').map(Number);
  return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}-01`;
}
const days = (from, count) => Array.from({ length: count }, (_, i) => addDaysToDateOnly(from, i));
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const num = value => Number(value) || 0;

async function build(tenantId) {
  const today = dateOnlyInTimeZone();
  const weekStart = addDaysToDateOnly(today, -6);              // today and the six days before
  const trendStart = addDaysToDateOnly(today, -29);
  const monthStart = monthStartOf(today);
  const prevStart = previousMonthStart(today);
  const dayOfMonth = Number(today.slice(8, 10));
  const prevSameEnd = addDaysToDateOnly(prevStart, dayOfMonth);  // the first `dayOfMonth` days of last month, exclusive end
  const tomorrow = addDaysToDateOnly(today, 1);
  const [todayStartUtc] = cairoDayBoundsUtc(today);
  const weekStartUtc = cairoDayStartUtc(weekStart);
  const monthStartUtc = cairoDayStartUtc(monthStart);
  const prevStartUtc = cairoDayStartUtc(prevStart);
  const prevSameEndUtc = cairoDayStartUtc(prevSameEnd);
  const trendStartUtc = cairoDayStartUtc(trendStart);
  const in30Days = addDaysToDateOnly(today, 30);

  const [[[money]], [[certificates]], [[expenses]], [sellers], [revenueByDay], [[leads]], [leadsByDay], [[clients]], [[expiring]],
    [attendance], [[staff]], [[tickets]], [[refunds]], [[leaves]], [[bonuses]]] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(CASE WHEN p.date >= ? AND p.date < ? THEN p.amount_egp END), 0) AS today,
              COALESCE(SUM(CASE WHEN p.date >= ? THEN p.amount_egp END), 0) AS week,
              COALESCE(SUM(CASE WHEN p.date >= ? THEN p.amount_egp END), 0) AS month,
              COALESCE(SUM(CASE WHEN p.date >= ? AND p.date < ? THEN p.amount_egp END), 0) AS prev_month,
              COALESCE(SUM(CASE WHEN p.date >= ? AND p.date < ? THEN p.amount_egp END), 0) AS prev_same_days,
              COALESCE(SUM(CASE WHEN p.date >= ? THEN 1 END), 0) AS month_payments
         FROM payments p
        WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND ${COURSE_MONEY} AND p.date >= ?`,
      [today, tomorrow, weekStart, monthStart, prevStart, monthStart, prevStart, prevSameEnd, monthStart, tenantId, prevStart]).then(rows => [rows[0]]),
    pool.query(
      `SELECT COALESCE(SUM(p.amount_egp), 0) AS month FROM payments p
        WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND UPPER(p.payment_type) = 'CERTIFICATE' AND p.date >= ?`, [tenantId, monthStart]),
    pool.query(
      `SELECT COALESCE(SUM(COALESCE(e.amount_egp, IF(e.currency = 'EGP', e.amount, 0))), 0) AS month FROM expenses e
        WHERE e.tenant_id = ? AND e.deleted_at IS NULL AND e.date >= ?`, [tenantId, monthStart]),
    pool.query(
      `SELECT p.staff_id, MAX(COALESCE(NULLIF(p.staff_name, ''), st.name)) AS name, MAX(st.role) AS role, SUM(p.amount_egp) AS revenue, COUNT(*) AS payments
         FROM payments p LEFT JOIN staff st ON st.id = p.staff_id AND st.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND ${COURSE_MONEY} AND p.date >= ? AND p.staff_id IS NOT NULL
        GROUP BY p.staff_id ORDER BY revenue DESC LIMIT 5`, [tenantId, monthStart]),
    pool.query(
      `SELECT DATE_FORMAT(p.date, '%Y-%m-%d') AS day, SUM(p.amount_egp) AS revenue FROM payments p
        WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND ${COURSE_MONEY} AND p.date >= ? GROUP BY 1`, [tenantId, trendStart]),
    pool.query(
      `SELECT COALESCE(SUM(l.created_at >= ? AND l.created_at < ?), 0) AS today,
              COALESCE(SUM(l.created_at >= ?), 0) AS week,
              COALESCE(SUM(l.created_at >= ?), 0) AS month,
              COALESCE(SUM(l.created_at >= ? AND l.created_at < ?), 0) AS prev_same_days,
              COALESCE(SUM(l.created_at >= ? AND l.status IN ${CONVERTED_SQL}), 0) AS converted_month
         FROM leads l WHERE l.tenant_id = ? AND l.deleted_at IS NULL AND l.hidden = 0 AND l.created_at >= ?`,
      [todayStartUtc, cairoDayStartUtc(tomorrow), weekStartUtc, monthStartUtc, prevStartUtc, prevSameEndUtc, monthStartUtc, tenantId, prevStartUtc]),
    pool.query(
      `SELECT DATE_FORMAT(${sqlCairoWall('l.created_at')}, '%Y-%m-%d') AS day, COUNT(*) AS count FROM leads l
        WHERE l.tenant_id = ? AND l.deleted_at IS NULL AND l.hidden = 0 AND l.created_at >= ? GROUP BY 1`, [tenantId, trendStartUtc]),
    pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(s.is_active = 1), 0) AS active, COALESCE(SUM(s.created_at >= ?), 0) AS new_7, COALESCE(SUM(s.created_at >= ?), 0) AS new_30
         FROM subscribers s WHERE s.tenant_id = ? AND s.deleted_at IS NULL`, [weekStartUtc, trendStartUtc, tenantId]),
    pool.query(
      `SELECT COUNT(DISTINCT e.subscriber_id) AS n FROM enrollments e
        WHERE e.tenant_id = ? AND e.status = 'active' AND e.expiry_date >= ? AND e.expiry_date < ?`, [tenantId, today, in30Days]),
    pool.query(`SELECT a.status, COUNT(*) AS n FROM attendance_logs a WHERE a.tenant_id = ? AND a.date = ? GROUP BY a.status`, [tenantId, today]),
    pool.query(`SELECT COUNT(*) AS n FROM staff WHERE tenant_id = ? AND is_active = 1 AND deleted_at IS NULL`, [tenantId]),
    pool.query(`SELECT COUNT(*) AS n FROM support_tickets WHERE tenant_id = ? AND status IN ('open', 'in_progress')`, [tenantId]),
    pool.query(`SELECT COUNT(*) AS n FROM refund_requests WHERE tenant_id = ? AND status = 'PENDING' AND deleted_at IS NULL`, [tenantId]),
    pool.query(`SELECT COUNT(*) AS n FROM leaves WHERE tenant_id = ? AND status = 'PENDING'`, [tenantId]),
    pool.query(`SELECT COUNT(*) AS n FROM employee_bonuses WHERE tenant_id = ? AND status = 'PENDING'`, [tenantId]),
  ]);

  const byDay = new Map(revenueByDay.map(row => [row.day, num(row.revenue)]));
  const leadDay = new Map(leadsByDay.map(row => [row.day, num(row.count)]));
  const status = Object.fromEntries(attendance.map(row => [row.status, num(row.n)]));
  const present = num(status.PRESENT) + num(status.LATE) + num(status.HALF_DAY) + num(status.REMOTE);
  const month = num(money.month);
  const monthLeads = num(leads.month);
  return {
    generatedAt: new Date().toISOString(),
    money: {
      today: num(money.today), week: num(money.week), month, prevMonth: num(money.prev_month),
      prevSameDays: num(money.prev_same_days), changeVsSameDays: pct(month, num(money.prev_same_days)),
      payments: num(money.month_payments), average: num(money.month_payments) ? Math.round(month / num(money.month_payments)) : 0,
      certificates: num(certificates.month), expenses: num(expenses.month), net: month - num(expenses.month),
    },
    leads: {
      today: num(leads.today), week: num(leads.week), month: monthLeads, prevSameDays: num(leads.prev_same_days),
      changeVsSameDays: pct(monthLeads, num(leads.prev_same_days)), converted: num(leads.converted_month),
      conversionRate: monthLeads ? Math.round((num(leads.converted_month) / monthLeads) * 100) : 0,
    },
    clients: { total: num(clients.total), active: num(clients.active), new7: num(clients.new_7), new30: num(clients.new_30), expiringIn30Days: num(expiring.n) },
    team: { staff: num(staff.n), present, late: num(status.LATE), absent: num(status.ABSENT), onLeave: num(status.LEAVE), recorded: attendance.reduce((sum, row) => sum + num(row.n), 0) },
    waiting: { tickets: num(tickets.n), refunds: num(refunds.n), leaves: num(leaves.n), bonuses: num(bonuses.n) },
    topCollectors: sellers.map(row => ({ id: row.staff_id, name: row.name || 'غير معروف', role: row.role || '', revenue: num(row.revenue), payments: num(row.payments) })),
    revenueByDay: days(trendStart, 30).map(day => ({ day, revenue: byDay.get(day) || 0 })),
    leadsByDay: days(trendStart, 30).map(day => ({ day, count: leadDay.get(day) || 0 })),
  };
}

router.get('/api/admin/kpi/summary', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const kpi = await cached(`figures:kpi:${req.tenantId}`, 30 * 1000, () => build(req.tenantId));
    // The page opens for view_financial (the accountant, the collection desk too); who is at work today and the leaves and bonuses waiting for approval are HR's.
    const hr = Boolean(req.isSuperAdmin) || hasPermission(req.staffRecord, 'view_hr');
    res.json(hr ? kpi : { ...kpi, team: null, waiting: { ...kpi.waiting, leaves: null, bonuses: null } });
  } catch (e) { logger.error('[kpi/summary]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


// GET /api/admin/overview/revenue — the money figures on the overview screen, from
// the books.
//
// The screen added them up in the browser from the 500 newest orders and payments
// it had loaded (both lists are capped), converted at the settings' rates rather
// than each payment's own EGP snapshot, and counted nothing that a refund took
// back (the negative rows are left out of the orders list). Right while the
// institute had a few hundred payments, wrong as soon as it had more, and never
// equal to the accounting screen. This sums payments.amount_egp — refund rows
// included, being negative — in the Cairo day and month, for whatever the caller
// is allowed to see.
router.get('/api/admin/overview/revenue', requireAuth, requireAdminOrStaff, requirePermission('view_dashboard'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { allowAssigned: true });
    const clause = financialScopeClause(scope, { branchColumn: 'p.branch_id', subscriberAlias: 's' });
    const today = cairoToday();
    const monthStart = cairoDayStartUtc(`${today.slice(0, 7)}-01`);
    const dayStart = cairoDayStartUtc(today);
    // The first figure of the landing screen: an all-time sum over every payment, 0.13 s at 40,000 and growing.
    // Held for 15 s, dropped by the next successful write (dropFiguresAfterWrites in lib/httpApp.js).
    const [[row]] = await cached(`figures:revenue:${req.tenantId}:${today}:${clause.sql}:${JSON.stringify(clause.params)}`, 15 * 1000, () => pool.query(
      `SELECT COALESCE(SUM(p.amount_egp),0) AS total,
              COALESCE(SUM(CASE WHEN p.date >= ? THEN p.amount_egp END),0) AS this_month,
              COALESCE(SUM(CASE WHEN p.date >= ? THEN p.amount_egp END),0) AS today,
              COUNT(*) AS payments
         FROM payments p
         LEFT JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
        WHERE p.tenant_id=? AND p.status IN ('paid','confirmed') AND p.deleted_at IS NULL${clause.sql}`,
      [monthStart, dayStart, req.tenantId, ...clause.params]
    ));
    res.json({
      totalEgp: Number(row.total) || 0,
      monthEgp: Number(row.this_month) || 0,
      todayEgp: Number(row.today) || 0,
      payments: Number(row.payments) || 0,
      asOf: today,
    });
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message, code: e.code });
    logger.error('[overview-revenue]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/overview/board — «نظرة عامة»'s top board (lib/overviewBoard.js): today against yesterday and last week, the alerts, who is in now. Money, so it is
// view_financial and the whole institute's: an account whose financial reach is a branch or its own clients is refused rather than shown the institute's total.
router.get('/api/admin/overview/board', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    if (resolveFinancialScope(req).kind !== 'all') return res.status(403).json({ error: 'The overview board needs the whole institute\'s financial reach' });
    const can = permission => Boolean(req.isSuperAdmin) || hasPermission(req.staffRecord, permission);
    res.json(await cachedBoard(req.tenantId, { canSeeMonitor: can('view_security'), canSeePresence: can('view_presence') }));
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message, code: e.code });
    logger.error('[overview-board]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
