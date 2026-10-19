'use strict';

// The figures four admin-only analysis screens draw, counted by the database (lib/analyticsScreens.js):
//   GET /api/admin/analytics-hub/retention                      «الاستبقاء»
//   GET /api/admin/analytics-hub/revenue-sources?from=YYYY-MM-DD «مصادر الإيراد»
//   GET /api/admin/analytics-hub/expense-analysis?from=         «تحليل المصروفات»
//   GET /api/admin/analytics-hub/month-revenue?month=YYYY-MM    «متابعة الميزانية»
// They held the context's orders, expenses and clients — the 500 newest orders, the clients of the list — and added
// them up in the browser; these cover the whole tables. Each is gated like the screens: view_financial, and the
// clients' figures also need view_subscribers, inside the same client scope the list had.

const express = require('express');
const router = express.Router();

const { pool, cached } = require('../../lib/db');
const logger = require('../../lib/logger');
const { sendRouteError } = require('../../lib/helpers');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { hasPermission } = require('../../constants/permissions');
const { financialScopeClause, resolveFinancialScope } = require('../../lib/financialScope');
const { sqlCairoWall, cairoToday, cairoDayStartUtc, safeDateOnly, isValidDateOnly } = require('../../lib/dates');
const { loadExpenseCategories, expenseCategoryLabel } = require('../../lib/expenseCategories');
const {
  lastMonths, rangeFrom, revenueGroups, revenueSources, expenseAnalysis, monthRevenue, retentionFigures,
} = require('../../lib/analyticsScreens');
const { staffClientTools } = require('./stafflists');

const dayOf = column => `DATE_FORMAT(${sqlCairoWall(column)}, '%Y-%m-%d')`;
const isPaid = column => `LOWER(COALESCE(NULLIF(${column}, ''), 'paid')) = 'paid'`;
const whoAsks = req => req.staffRecord?.id || req.user?.uid || 'admin';

function financialScope(req) {
  try { return resolveFinancialScope(req, { requestedBranch: null, allowAssigned: true }); } catch { return null; }
}

/**
 * What was paid, as GET /api/admin/orders lists it — the orders table, then every desk payment no order covers (by id
 * or by transaction) — grouped by the day the money counts on, type, course, bundle, currency and lead source.
 */
async function paidGroups(req) {
  return cached(`figures:paid-groups:${req.tenantId}:${whoAsks(req)}`, 15 * 1000, async () => {
    const scope = financialScope(req);
    const forOrders = financialScopeClause(scope, { branchColumn: 'o.branch_id', subscriberAlias: 's' });
    const forPayments = financialScopeClause(scope, { branchColumn: 'p.branch_id', subscriberAlias: 's' });
    const [[orderRows], [payRows]] = await Promise.all([
      pool.query(
        `SELECT COALESCE(${dayOf('o.paid_at')}, ${dayOf('o.created_at')}) AS day,
                LOWER(COALESCE(NULLIF(o.type, ''), 'course')) AS type, o.course_id, o.bundle_id,
                COALESCE(NULLIF(o.currency, ''), 'EGP') AS currency, COALESCE(NULLIF(ol.source, ''), '') AS lead_source,
                SUM(o.amount) AS amount, COUNT(*) AS n
           FROM orders o
           LEFT JOIN subscribers s ON s.id = o.subscriber_id AND s.tenant_id = o.tenant_id
           LEFT JOIN leads ol ON ol.id = s.lead_id AND ol.tenant_id = o.tenant_id
          WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND ${isPaid('o.status')}${forOrders.sql}
          GROUP BY 1, 2, 3, 4, 5, 6`,
        [req.tenantId, ...forOrders.params]),
      pool.query(
        `SELECT DATE_FORMAT(p.date, '%Y-%m-%d') AS day, LOWER(COALESCE(NULLIF(p.payment_type, ''), 'course')) AS type,
                p.course_id, p.bundle_id, COALESCE(NULLIF(p.currency, ''), 'EGP') AS currency, SUM(p.amount) AS amount, COUNT(*) AS n
           FROM payments p
           LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
           LEFT JOIN orders x ON x.id = p.id AND x.tenant_id = p.tenant_id AND x.deleted_at IS NULL
          WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND p.amount > 0 AND ${isPaid('p.status')}${forPayments.sql}
            AND x.id IS NULL
            AND (p.transaction_id IS NULL OR p.transaction_id = '' OR p.transaction_id NOT IN (
                  SELECT y.transaction_id FROM orders y
                   WHERE y.tenant_id = ? AND y.deleted_at IS NULL AND y.transaction_id IS NOT NULL AND y.transaction_id <> ''))
          GROUP BY 1, 2, 3, 4, 5`,
        [req.tenantId, ...forPayments.params, req.tenantId]),
    ]);
    return revenueGroups(orderRows, payRows);
  });
}

async function expenseRows(req, from) {
  const scope = financialScope(req);
  // Staff who see their own clients' money see no expenses — none is a client's (GET /api/admin/expenses).
  if (!scope || scope.kind === 'assigned_cs' || scope.kind === 'assigned_sales') return { groups: [], list: [] };
  const branchSql = scope.branchId ? ' AND e.branch_id = ?' : '';
  const branchParams = scope.branchId ? [scope.branchId] : [];
  const day = `COALESCE(DATE_FORMAT(e.date, '%Y-%m-%d'), ${dayOf('e.created_at')})`;
  const [[groups], [list], categories] = await Promise.all([
    pool.query(
      `SELECT ${day} AS day, e.category, COALESCE(NULLIF(e.currency, ''), 'EGP') AS currency, SUM(e.amount) AS amount, COUNT(*) AS n
         FROM expenses e WHERE e.tenant_id = ? AND e.deleted_at IS NULL${branchSql} GROUP BY 1, 2, 3`,
      [req.tenantId, ...branchParams]),
    // «سجل المصروفات»: the screen lists the 30 newest in the period.
    pool.query(
      `SELECT e.id, e.description, e.category, e.amount, COALESCE(NULLIF(e.currency, ''), 'EGP') AS currency, e.date, e.created_at
         FROM expenses e WHERE e.tenant_id = ? AND e.deleted_at IS NULL${branchSql} AND ${day} >= ?
        ORDER BY e.date DESC, e.created_at DESC LIMIT 30`,
      [req.tenantId, ...branchParams, from]),
    loadExpenseCategories(req.tenantId),
  ]);
  const labelOf = code => expenseCategoryLabel(code, categories);
  return {
    groups, labelOf,
    list: list.map(row => ({
      id: row.id, description: row.description || '', category: labelOf(row.category), amount: Number(row.amount) || 0,
      currency: row.currency, date: safeDateOnly(row.date) || '',
    })),
  };
}

router.get('/api/admin/analytics-hub/revenue-sources', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const from = rangeFrom(req.query.from);
    const today = cairoToday();
    res.json(revenueSources(await paidGroups(req), from, lastMonths(today, 6)));
  } catch (e) { if (!e.statusCode) logger.error('[/api/admin/analytics-hub/revenue-sources]', e.message); sendRouteError(res, e); }
});

router.get('/api/admin/analytics-hub/expense-analysis', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const from = rangeFrom(req.query.from);
    const months = lastMonths(cairoToday(), 6);
    const payload = await cached(`figures:expenses:${req.tenantId}:${whoAsks(req)}:${from}`, 15 * 1000, async () => {
      const [groups, expenses] = await Promise.all([paidGroups(req), expenseRows(req, from)]);
      return { ...expenseAnalysis(expenses.groups, groups, from, months, expenses.labelOf), list: expenses.list };
    });
    res.json(payload);
  } catch (e) { if (!e.statusCode) logger.error('[/api/admin/analytics-hub/expense-analysis]', e.message); sendRouteError(res, e); }
});

router.get('/api/admin/analytics-hub/month-revenue', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const month = String(req.query.month || cairoToday().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(month) || !isValidDateOnly(`${month}-01`)) return res.status(400).json({ error: 'Valid month is required' });
    res.json({ month, amounts: monthRevenue(await paidGroups(req), month) });
  } catch (e) { if (!e.statusCode) logger.error('[/api/admin/analytics-hub/month-revenue]', e.message); sendRouteError(res, e); }
});

// The stored status of a client, 'active' for none (the screen read `clientStatus || 'active'`).
const STATUS_SQL = `COALESCE(NULLIF(NULLIF(CASE WHEN JSON_VALID(s.crm_json) THEN JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.clientStatus')) END, ''), 'null'), 'active')`;

router.get('/api/admin/analytics-hub/retention', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const months = lastMonths(cairoToday(), 12);
    const may = !!req.isSuperAdmin || (req.staffRecord && hasPermission(req.staffRecord, 'view_subscribers'));
    const base = may ? staffClientTools.activeClientsBase(req) : null;
    if (!base) return res.json(retentionFigures({ statusRows: [], createdRows: [], finishedRows: [], courseRows: [], paidEgp: 0 }, months));
    const payload = await cached(`figures:retention:${req.tenantId}:${whoAsks(req)}`, 15 * 1000, async () => {
      const since = cairoDayStartUtc(`${months[0]}-01`);
      const updatedMonth = `COALESCE(DATE_FORMAT(${sqlCairoWall('s.updated_at')}, '%Y-%m'), DATE_FORMAT(${sqlCairoWall('s.created_at')}, '%Y-%m'))`;
      const [[statusRows], [createdRows], [finishedRows], [courseRows], [[paid]]] = await Promise.all([
        pool.query(
          `SELECT ${STATUS_SQL} AS status, COUNT(*) AS n FROM subscribers s WHERE s.tenant_id = ? AND ${base.where} GROUP BY 1`,
          [req.tenantId, ...base.params]),
        pool.query(
          `SELECT DATE_FORMAT(${sqlCairoWall('s.created_at')}, '%Y-%m') AS month, COUNT(*) AS n FROM subscribers s
            WHERE s.tenant_id = ? AND ${base.where} AND s.created_at >= ? GROUP BY 1`,
          [req.tenantId, ...base.params, since]),
        pool.query(
          `SELECT ${updatedMonth} AS month, COUNT(*) AS n FROM subscribers s
            WHERE s.tenant_id = ? AND ${base.where} AND ${STATUS_SQL} = 'finished' AND COALESCE(s.updated_at, s.created_at) >= ? GROUP BY 1`,
          [req.tenantId, ...base.params, since]),
        pool.query(
          `SELECT e.course_id, COUNT(DISTINCT e.subscriber_id) AS n FROM enrollments e
             JOIN subscribers s ON s.id = e.subscriber_id AND s.tenant_id = e.tenant_id
            WHERE e.tenant_id = ? AND e.status = 'active' AND e.course_id IS NOT NULL AND ${base.where} GROUP BY e.course_id`,
          [req.tenantId, ...base.params]),
        // What each client paid, net, in EGP, rounded per client as GET /api/admin/subscribers/stats?paidBySubscriber=1 does.
        pool.query(
          `SELECT COALESCE(SUM(ROUND(t.egp)), 0) AS total FROM (
             SELECT SUM(COALESCE(p.amount_egp, CASE WHEN COALESCE(p.currency, 'EGP') = 'EGP' THEN p.amount END)) AS egp
               FROM payments p JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
              WHERE p.tenant_id = ? AND p.status = 'paid' AND p.deleted_at IS NULL AND ${base.where}
              GROUP BY p.subscriber_id) t`,
          [req.tenantId, ...base.params]),
      ]);
      return retentionFigures({ statusRows, createdRows, finishedRows, courseRows, paidEgp: paid?.total }, months);
    });
    res.json(payload);
  } catch (e) { if (!e.statusCode) logger.error('[/api/admin/analytics-hub/retention]', e.message); sendRouteError(res, e); }
});

module.exports = router;
