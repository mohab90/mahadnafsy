'use strict';

// The one figure the budget screen still asks of this file, counted by the database (lib/analyticsScreens.js):
//   GET /api/admin/analytics-hub/month-revenue?month=YYYY-MM    «متابعة الميزانية»
// The analyses of retention, revenue sources and expenses went with their pages (5 Nov 2026).
// Gated like the screen: view_financial, inside the caller's financial scope.

const express = require('express');
const router = express.Router();

const { pool, cached } = require('../../lib/db');
const logger = require('../../lib/logger');
const { sendRouteError } = require('../../lib/helpers');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { financialScopeClause, resolveFinancialScope } = require('../../lib/financialScope');
const { sqlCairoWall, cairoToday, isValidDateOnly } = require('../../lib/dates');
const { revenueGroups, monthRevenue } = require('../../lib/analyticsScreens');

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

router.get('/api/admin/analytics-hub/month-revenue', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const month = String(req.query.month || cairoToday().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(month) || !isValidDateOnly(`${month}-01`)) return res.status(400).json({ error: 'Valid month is required' });
    res.json({ month, amounts: monthRevenue(await paidGroups(req), month) });
  } catch (e) { if (!e.statusCode) logger.error('[/api/admin/analytics-hub/month-revenue]', e.message); sendRouteError(res, e); }
});

module.exports = router;
