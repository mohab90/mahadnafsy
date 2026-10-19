'use strict';

// GET /api/admin/analytics-summary?range=all|today|yesterday|7d|30d — the figures «تقارير وإحصاءات تفصيلية» draws
// (lib/analyticsSummary.js). Each section is counted over what the person may see and left null for a role that may not
// see it: the screen read the context's orders, leads and clients, which came back empty from a refused list.

const express = require('express');
const router = express.Router();

const { pool, cached } = require('../../lib/db');
const logger = require('../../lib/logger');
const { sendRouteError } = require('../../lib/helpers');
const { requireAuth, requireAdminOrStaff, requireAnyPermission } = require('../../middleware/auth');
const { hasPermission } = require('../../constants/permissions');
const { financialScopeClause, resolveFinancialScope } = require('../../lib/financialScope');
const { leadScope } = require('../../lib/leadAccess');
const { sqlCairoWall, cairoToday, cairoDayStartUtc, addDaysToDateOnly } = require('../../lib/dates');
const { RANGES, rangeDays, lastSixMonths, combineOrders, summarizeOrders } = require('../../lib/analyticsSummary');
const { staffClientTools } = require('./stafflists');

async function ordersSection(req, days, months) {
  let scope;
  try { scope = resolveFinancialScope(req, { requestedBranch: null, allowAssigned: true }); } catch { return null; }
  const forOrders = financialScopeClause(scope, { branchColumn: 'o.branch_id', subscriberAlias: 's' });
  const forPayments = financialScopeClause(scope, { branchColumn: 'p.branch_id', subscriberAlias: 's' });
  const [[orderRows], [payRows]] = await Promise.all([
    pool.query(
      `SELECT o.id, o.transaction_id, o.type, o.item_id, o.amount, o.currency, o.status, o.coupon_code,
              COALESCE(DATE_FORMAT(${sqlCairoWall('o.paid_at')}, '%Y-%m-%d'), DATE_FORMAT(${sqlCairoWall('o.created_at')}, '%Y-%m-%d')) AS day
         FROM orders o LEFT JOIN subscribers s ON s.id = o.subscriber_id AND s.tenant_id = o.tenant_id
        WHERE o.tenant_id = ? AND o.deleted_at IS NULL${forOrders.sql}`,
      [req.tenantId, ...forOrders.params]),
    pool.query(
      `SELECT p.id, p.transaction_id, p.payment_type, p.course_id, p.bundle_id, p.amount, p.currency, p.status, DATE_FORMAT(p.date, '%Y-%m-%d') AS day
         FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND p.amount > 0${forPayments.sql}`,
      [req.tenantId, ...forPayments.params]),
  ]);
  return summarizeOrders(combineOrders(orderRows, payRows), days, months);
}

async function leadsSection(req, days) {
  const scope = leadScope(req, 'l');
  if (scope.none) return null;
  const range = [];
  const params = [req.tenantId, ...scope.params];
  if (days.from) { range.push('l.created_at >= ?'); params.push(cairoDayStartUtc(days.from)); }
  if (days.to) { range.push('l.created_at < ?'); params.push(cairoDayStartUtc(addDaysToDateOnly(days.to, 1))); }
  const [rows] = await pool.query(
    `SELECT LOWER(COALESCE(NULLIF(l.status, ''), 'new')) AS status, COALESCE(NULLIF(l.source, ''), 'غير محدد') AS source, COUNT(*) AS n
       FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${scope.sql}${range.map(clause => ` AND ${clause}`).join('')}
      GROUP BY 1, 2`,
    params);
  return { rows: rows.map(row => ({ status: row.status, source: row.source, n: Number(row.n) })) };
}

async function clientsSection(req, days, months) {
  const base = staffClientTools.activeClientsBase(req);
  if (!base) return null;
  const range = [];
  const rangeParams = [];
  if (days.from) { range.push('s.created_at >= ?'); rangeParams.push(cairoDayStartUtc(days.from)); }
  if (days.to) { range.push('s.created_at < ?'); rangeParams.push(cairoDayStartUtc(addDaysToDateOnly(days.to, 1))); }
  const [[branchRows], [[inRange]], [monthRows], [courseRows], [bundleRows]] = await Promise.all([
    pool.query(
      `SELECT COALESCE(NULLIF(s.branch, ''), 'غير محدد') AS branch, COUNT(*) AS n FROM subscribers s
        WHERE s.tenant_id = ? AND ${base.where} GROUP BY 1`, [req.tenantId, ...base.params]),
    pool.query(
      `SELECT COUNT(*) AS n FROM subscribers s WHERE s.tenant_id = ? AND ${base.where}${range.map(clause => ` AND ${clause}`).join('')}`,
      [req.tenantId, ...base.params, ...rangeParams]),
    pool.query(
      `SELECT DATE_FORMAT(${sqlCairoWall('s.created_at')}, '%Y-%m') AS month, COUNT(*) AS n FROM subscribers s
        WHERE s.tenant_id = ? AND ${base.where} AND s.created_at >= ? GROUP BY 1`,
      [req.tenantId, ...base.params, cairoDayStartUtc(`${months[0]}-01`)]),
    pool.query(
      `SELECT e.course_id, COUNT(DISTINCT e.subscriber_id) AS n FROM enrollments e
         JOIN subscribers s ON s.id = e.subscriber_id AND s.tenant_id = e.tenant_id
        WHERE e.tenant_id = ? AND e.status = 'active' AND e.course_id IS NOT NULL AND ${base.where} GROUP BY e.course_id`,
      [req.tenantId, ...base.params]),
    pool.query(
      `SELECT bc.bundle_id, COUNT(DISTINCT e.subscriber_id) AS n FROM enrollments e
         JOIN bundle_courses bc ON bc.course_id = e.course_id AND bc.tenant_id = e.tenant_id
         JOIN subscribers s ON s.id = e.subscriber_id AND s.tenant_id = e.tenant_id
        WHERE e.tenant_id = ? AND e.status = 'active' AND ${base.where} GROUP BY bc.bundle_id`,
      [req.tenantId, ...base.params]),
  ]);
  const byBranch = {};
  let total = 0;
  for (const row of branchRows) { byBranch[row.branch] = Number(row.n); total += Number(row.n); }
  const byMonth = Object.fromEntries(monthRows.map(row => [row.month, Number(row.n)]));
  return {
    total, inRange: Number(inRange.n), byBranch,
    monthly: months.map(month => ({ month, n: byMonth[month] || 0 })),
    perCourse: Object.fromEntries(courseRows.map(row => [row.course_id, Number(row.n)])),
    perBundle: Object.fromEntries(bundleRows.map(row => [row.bundle_id, Number(row.n)])),
  };
}

// The screens that draw it — «الرئيسية» and «إحصائيات الدقي» — open on any of these; each section then needs its own.
router.get('/api/admin/analytics-summary', requireAuth, requireAdminOrStaff, requireAnyPermission('manage_daqqi', 'view_reports', 'view_orders', 'view_leads', 'view_subscribers'), async (req, res) => {
  try {
    const range = RANGES.includes(String(req.query.range)) ? String(req.query.range) : 'all';
    const today = cairoToday();
    const months = lastSixMonths(today);
    const days = rangeDays(range, today);
    const may = permission => !!req.isSuperAdmin || (req.staffRecord && hasPermission(req.staffRecord, permission));
    const who = req.staffRecord?.id || req.user?.uid || 'admin';
    const payload = await cached(`figures:analytics:${req.tenantId}:${who}:${range}:${today}`, 15 * 1000, async () => ({
      range, months,
      orders: may('view_orders') ? await ordersSection(req, days, months) : null,
      leads: may('view_leads') ? await leadsSection(req, days) : null,
      subscribers: may('view_subscribers') ? await clientsSection(req, days, months) : null,
    }));
    res.json(payload);
  } catch (e) { if (!e.statusCode) logger.error('[/api/admin/analytics-summary]', e.message); sendRouteError(res, e); }
});

module.exports = router;
