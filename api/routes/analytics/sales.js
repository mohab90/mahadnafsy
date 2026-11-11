'use strict';
const { isConvertedLeadStatus, CONVERTED_SQL } = require('../../lib/leadStatuses');
const logger = require('../../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission, requireAnyPermission } = require('../../middleware/auth');
const { hasPermission, PERMISSIONS } = require('../../constants/permissions');
const { cairoToday, cairoDayBoundsUtc, cairoDayStartUtc, cairoMonthStart, monthRange, sqlCairoWall, addDaysToDateOnly } = require('../../lib/dates');
const { leadScope } = require('../../lib/leadAccess');
const { salesPaymentSql } = require('../../lib/salesMoney');
const { financialScopeClause, resolveFinancialScope } = require('../../lib/financialScope');

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Sales Team Performance + Lead Conversion Funnel ──────────────
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/reports/sales-performance?from=&to=
// «أداء فريق المبيعات» computed its figures in the browser out of the leads and
// orders arrays, so the smallest way to show somebody the team's numbers was to
// hand them the pipeline. This endpoint already computed them in SQL and was
// admin-only; it now also answers whoever runs the team or holds the
// performance key, and it tells a performance-only caller less: a rep's pay is
// not part of how the team is doing.
router.get('/api/admin/reports/sales-performance', requireAuth, requireAdminOrStaff,
  requireAnyPermission(PERMISSIONS.MANAGE_SALES_TEAM, PERMISSIONS.VIEW_PERF_SALES), async (req, res) => {
  try {
    const from = req.query.from || cairoMonthStart(0);
    const to   = req.query.to   || cairoToday();
    // from/to are Cairo days; leads.created_at is a UTC instant.
    const [fromUtc, toUtc] = cairoDayBoundsUtc(from, to);

    // The team is «sales» and «sales_collection_manager» (admin SalesTeamTab SALES_ROLES) plus the manager. The list named
    // 'SALES_MANAGER', which is no role, so the sales-and-collection managers the screen draws never had a row here: their
    // revenue read 0 and their lead counts came from whatever page of leads the browser held.
    const [staff] = await pool.query(`
      SELECT st.id, st.name, st.email, st.role, st.commission_rate,
        COALESCE(ld.total_leads, 0) AS total_leads, COALESCE(ld.converted, 0) AS converted_leads,
        COALESCE(rd.revenue_egp, 0) AS revenue_egp, COALESCE(rd.payment_count, 0) AS payment_count
      FROM staff st
      LEFT JOIN (
        SELECT assigned_sales_id, COUNT(*) AS total_leads,
          SUM(CASE WHEN status IN ${CONVERTED_SQL} THEN 1 ELSE 0 END) AS converted
        FROM leads WHERE tenant_id=? AND created_at >= ? AND created_at < ? AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id
      ) ld ON ld.assigned_sales_id = st.id
      LEFT JOIN (
        SELECT p.staff_id,
          SUM(p.amount_egp) AS revenue_egp,
          COUNT(*) AS payment_count
        FROM payments p WHERE p.tenant_id=? AND p.status IN ('paid','confirmed') AND DATE(p.\`date\`) BETWEEN ? AND ? AND p.staff_id IS NOT NULL AND p.deleted_at IS NULL AND ${salesPaymentSql('p')} GROUP BY p.staff_id
      ) rd ON rd.staff_id = st.id
      WHERE st.tenant_id=? AND UPPER(st.role) IN ('SALES','SALES_COLLECTION_MANAGER','MANAGER') AND st.is_active=1
      ORDER BY revenue_egp DESC`, [req.tenantId, fromUtc, toUtc, req.tenantId, from, to, req.tenantId]);

    // Pay is a different question from performance. A caller who holds the
    // performance key and nothing else gets the work, not the commission or the
    // address it would be paid to.
    const seesPay = Boolean(req.isSuperAdmin) || hasPermission(req.staffRecord, PERMISSIONS.MANAGE_SALES_TEAM);
    res.json({
      from, to,
      canSeePay: seesPay,
      staff: staff.map(s => {
        const conversion_rate = s.total_leads > 0 ? parseFloat((s.converted_leads / s.total_leads * 100).toFixed(1)) : null;
        if (!seesPay) {
          const { email: _email, commission_rate: _rate, ...rest } = s;
          return { ...rest, conversion_rate };
        }
        return {
          ...s,
          commission_due: s.commission_rate ? Math.round(Number(s.revenue_egp) * Number(s.commission_rate) / 100) : null,
          conversion_rate,
        };
      }),
    });
  } catch (e) { logger.error('[route]', e.message); res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' }); }
});

// GET /api/admin/marketing/overview?range=today|7d|30d|month|all — «نظرة عامة» of مركز التسويق (4 Nov 2026). It counted leads and orders in the browser out of the whole tables, added
// amounts of different currencies and had no past to compare with. Here: the leads by status and source, the collected money (payments.amount_egp), a daily line, the same
// figures for the period just before it, and the leads nobody has touched in two days.
const MARKETING_RANGES = { today: 1, '7d': 7, '30d': 30 };
router.get('/api/admin/marketing/overview', requireAuth, requireAdminOrStaff, requirePermission('manage_channel_settings'), async (req, res) => {
  try {
    const today = cairoToday();
    const range = Object.keys(MARKETING_RANGES).includes(String(req.query.range)) || ['month', 'all'].includes(String(req.query.range)) ? String(req.query.range) : 'month';
    const from = range === 'all' ? null : range === 'month' ? cairoMonthStart(0) : addDaysToDateOnly(today, 1 - MARKETING_RANGES[range]);
    const days = from ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1 : null;
    const before = from ? { from: addDaysToDateOnly(from, -days), to: addDaysToDateOnly(from, -1) } : null;

    const leadRange = leadScope(req, 'l');
    const moneyScope = financialScopeClause(resolveFinancialScope(req, { allowAssigned: true }), { branchColumn: 'p.branch_id', subscriberAlias: 's' });

    const leadsIn = async (start, end) => {
      if (leadRange.none) return [];
      const params = [req.tenantId, ...leadRange.params];
      let when = '';
      if (start) { const [fromUtc, toUtc] = cairoDayBoundsUtc(start, end); when = ' AND l.created_at >= ? AND l.created_at < ?'; params.push(fromUtc, toUtc); }
      const [rows] = await pool.query(
        `SELECT LOWER(COALESCE(NULLIF(l.status, ''), 'new')) AS status, COALESCE(NULLIF(l.source, ''), 'غير محدد') AS source, COUNT(*) AS n
           FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${leadRange.sql}${when} GROUP BY 1, 2`, params);
      return rows.map(row => ({ status: row.status, source: row.source, n: Number(row.n) }));
    };
    const moneyIn = async (start, end) => {
      const params = [req.tenantId, ...moneyScope.params];
      let when = '';
      if (start) { when = ' AND p.date >= ? AND p.date < ?'; params.push(start, addDaysToDateOnly(end, 1)); }
      const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(p.amount_egp), 0) AS revenue, COUNT(*) AS payments
           FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
          WHERE p.tenant_id = ? AND p.status IN ('paid','confirmed') AND p.deleted_at IS NULL AND p.amount_egp > 0 AND ${salesPaymentSql('p')}${moneyScope.sql}${when}`, params);
      return { revenue: Math.round(Number(row.revenue) || 0), payments: Number(row.payments) || 0 };
    };

    // The daily line is the last 30 days at most, whatever the range, so «all» does not draw years.
    const lineFrom = days && days <= 30 ? from : addDaysToDateOnly(today, -29);
    const lineLeadParams = [req.tenantId, ...leadRange.params, ...cairoDayBoundsUtc(lineFrom, today)];
    const lineMoneyParams = [req.tenantId, ...moneyScope.params, lineFrom, addDaysToDateOnly(today, 1)];
    const [current, previous, currentMoney, previousMoney, [lineLeads], [lineMoney], [[stale]]] = await Promise.all([
      leadsIn(from, today),
      before ? leadsIn(before.from, before.to) : Promise.resolve(null),
      moneyIn(from, today),
      before ? moneyIn(before.from, before.to) : Promise.resolve(null),
      leadRange.none ? [[]] : pool.query(
        `SELECT DATE_FORMAT(${sqlCairoWall('l.created_at')}, '%Y-%m-%d') AS day, COUNT(*) AS leads, SUM(l.status IN ${CONVERTED_SQL}) AS converted
           FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${leadRange.sql} AND l.created_at >= ? AND l.created_at < ? GROUP BY 1`, lineLeadParams),
      pool.query(
        `SELECT DATE_FORMAT(p.date, '%Y-%m-%d') AS day, COALESCE(SUM(p.amount_egp), 0) AS revenue
           FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
          WHERE p.tenant_id = ? AND p.status IN ('paid','confirmed') AND p.deleted_at IS NULL AND p.amount_egp > 0 AND ${salesPaymentSql('p')}${moneyScope.sql}
            AND p.date >= ? AND p.date < ? GROUP BY 1`, lineMoneyParams),
      leadRange.none ? [[{ n: 0 }]] : pool.query(
        `SELECT COUNT(*) AS n FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${leadRange.sql}
            AND LOWER(COALESCE(NULLIF(l.status, ''), 'new')) = 'new' AND l.created_at < NOW() - INTERVAL 2 DAY`, [req.tenantId, ...leadRange.params]),
    ]);

    const leadsByDay = new Map(lineLeads.map(row => [row.day, row]));
    const moneyByDay = new Map(lineMoney.map(row => [row.day, row]));
    const daily = [];
    for (let day = lineFrom; day <= today; day = addDaysToDateOnly(day, 1)) {
      daily.push({
        day,
        leads: Number(leadsByDay.get(day)?.leads) || 0,
        converted: Number(leadsByDay.get(day)?.converted) || 0,
        revenue: Math.round(Number(moneyByDay.get(day)?.revenue) || 0),
      });
    }
    res.json({
      range, from, to: today,
      current: { leads: current, ...currentMoney },
      previous: previous ? { from: before.from, to: before.to, leads: previous, ...previousMoney } : null,
      daily,
      untouchedLeads: Number(stale?.n) || 0,
    });
  } catch (e) { logger.error('[marketing-overview]', e.message); res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' }); }
});

// GET /api/admin/reports/sales-breakdown?from=&to= — «تقارير المبيعات»: the leads by status and by source, and the collected money in total, by employee and by course or track,
// over a range of Cairo days (no `from` is all time). «تقارير المبيعات» counted them in the browser out of the leads and orders it had loaded (it asked for every lead of the
// tenant to do it, and added amounts of different currencies); the money here is payments.amount_egp, the same figure «أداء المبيعات» draws (3 Nov 2026).
router.get('/api/admin/reports/sales-breakdown', requireAuth, requireAdminOrStaff, requirePermission(PERMISSIONS.MANAGE_SALES_TEAM), async (req, res) => {
  try {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : cairoToday();
    const leadRange = leadScope(req, 'l');
    const moneyScope = financialScopeClause(resolveFinancialScope(req, { allowAssigned: true }), { branchColumn: 'p.branch_id', subscriberAlias: 's' });

    const leadParams = [req.tenantId, ...leadRange.params];
    let leadWhen = '';
    if (from) { leadWhen = ' AND l.created_at >= ? AND l.created_at < ?'; const [fromUtc, toUtc] = cairoDayBoundsUtc(from, to); leadParams.push(fromUtc, toUtc); }
    const moneyParams = [req.tenantId, ...moneyScope.params];
    let moneyWhen = '';
    // `p.date <= to` would stop at midnight of the last day: payments carry the time they were made (NOW()), so the last day's own money dropped out of the report.
    if (from) { moneyWhen = ' AND p.date >= ? AND p.date < ?'; moneyParams.push(from, addDaysToDateOnly(to, 1)); }
    const moneyFrom = `FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.status IN ('paid','confirmed') AND p.deleted_at IS NULL AND p.amount_egp > 0 AND ${salesPaymentSql('p')}${moneyScope.sql}${moneyWhen}`;

    const [[leadRows], [[total]], [staffRows], [itemRows]] = await Promise.all([
      leadRange.none ? [[]] : pool.query(
        `SELECT LOWER(COALESCE(NULLIF(l.status, ''), 'new')) AS status, COALESCE(NULLIF(l.source, ''), 'غير محدد') AS source, COUNT(*) AS n
           FROM leads l WHERE l.tenant_id = ? AND l.hidden = 0${leadRange.sql}${leadWhen} GROUP BY 1, 2`, leadParams),
      pool.query(`SELECT COALESCE(SUM(p.amount_egp), 0) AS revenue, COUNT(*) AS payments ${moneyFrom}`, moneyParams),
      pool.query(
        `SELECT p.staff_id, SUM(p.amount_egp) AS revenue, COUNT(*) AS payments ${moneyFrom} GROUP BY p.staff_id ORDER BY revenue DESC LIMIT 8`, moneyParams),
      pool.query(
        `SELECT p.course_id, p.bundle_id, SUM(p.amount_egp) AS revenue, COUNT(*) AS payments ${moneyFrom} GROUP BY p.course_id, p.bundle_id ORDER BY revenue DESC LIMIT 6`, moneyParams),
    ]);

    const staffIds = staffRows.map(row => row.staff_id).filter(Boolean);
    const courseIds = itemRows.map(row => row.course_id).filter(Boolean);
    const bundleIds = itemRows.map(row => row.bundle_id).filter(Boolean);
    const [[staffNames], [courseTitles], [bundleTitles]] = await Promise.all([
      staffIds.length ? pool.query('SELECT id, name FROM staff WHERE tenant_id = ? AND id IN (?)', [req.tenantId, staffIds]) : [[]],
      courseIds.length ? pool.query('SELECT id, COALESCE(NULLIF(title_ar, \'\'), title) AS title FROM courses WHERE tenant_id = ? AND id IN (?)', [req.tenantId, courseIds]) : [[]],
      bundleIds.length ? pool.query('SELECT id, title FROM bundles WHERE tenant_id = ? AND id IN (?)', [req.tenantId, bundleIds]) : [[]],
    ]);
    const nameOf = new Map(staffNames.map(row => [row.id, row.name]));
    const titleOf = new Map([...courseTitles, ...bundleTitles].map(row => [row.id, row.title]));
    res.json({
      from, to,
      leads: leadRows.map(row => ({ status: row.status, source: row.source, n: Number(row.n) })),
      revenue: Math.round(Number(total.revenue) || 0), payments: Number(total.payments) || 0,
      byStaff: staffRows.map(row => ({ staffId: row.staff_id, name: nameOf.get(row.staff_id) || 'غير محدد', revenue: Math.round(Number(row.revenue) || 0), payments: Number(row.payments) || 0 })),
      byItem: itemRows.map(row => ({ id: row.bundle_id || row.course_id, name: titleOf.get(row.bundle_id || row.course_id) || 'غير محدد', revenue: Math.round(Number(row.revenue) || 0), payments: Number(row.payments) || 0 })),
    });
  } catch (e) { logger.error('[sales-breakdown]', e.message); res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Sales Goals / Targets ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


// GET /api/admin/sales-goals?period=YYYY-MM (or list all)
router.get('/api/admin/sales-goals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { period } = req.query;
    let sql = 'SELECT id, period, revenue_target, leads_target, conversions_target, new_clients_target, created_at, updated_at FROM sales_goals WHERE tenant_id=?';
    const params = [req.tenantId];
    if (period) { sql += ' AND period = ?'; params.push(period); }
    else sql += ' ORDER BY period DESC LIMIT 24';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/sales-goals/:period  (upsert)
router.put('/api/admin/sales-goals/:period', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { period } = req.params;
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' });
    const { revenue_target = 0, leads_target = 0, conversions_target = 0, new_clients_target = 0 } = req.body;
    await pool.query(`INSERT INTO sales_goals (tenant_id, period, revenue_target, leads_target, conversions_target, new_clients_target)
                      VALUES (?, ?, ?, ?, ?, ?)
                      ON DUPLICATE KEY UPDATE
                        revenue_target=VALUES(revenue_target),
                        leads_target=VALUES(leads_target),
                        conversions_target=VALUES(conversions_target),
                        new_clients_target=VALUES(new_clients_target)`,
      [req.tenantId, period, revenue_target, leads_target, conversions_target, new_clients_target]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ── Per-staff sales targets (single source of truth across SalesGoalsTab,
//    LeadsPerformancePanel and the collection target — were localStorage before).
//    staff_id '__collection__' holds the org-wide collection monthly target. ──

// GET /api/admin/sales-targets?period=YYYY-MM (omit period → recent across staff)
// Read by the sales screens (view_leads) and by «فريق الأونلاين والتحصيل»
// (manage_subscribers) and the online performance view (view_perf_online),
// which asked view_leads alone: an online manager was refused and shown
// «تعذر تحميل أهداف فريق الأونلاين والتحصيل» — 113 refusals on 5–7 Oct.
router.get('/api/admin/sales-targets', requireAuth, requireAdminOrStaff,
  requireAnyPermission('view_leads', 'manage_subscribers', 'view_perf_online'), async (req, res) => {
  try {
    const { period } = req.query;
    let sql = 'SELECT staff_id AS staffId, period, revenue_target AS revenueTarget, leads_target AS leadsTarget, updated_at AS updatedAt FROM sales_targets WHERE tenant_id=?';
    const params = [req.tenantId];
    if (period) { sql += ' AND period = ?'; params.push(period); }
    else sql += ' ORDER BY period DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/sales-targets  (upsert one {staffId, period, revenueTarget, leadsTarget})
// Deliberately gated on 'view_reports', NOT 'manage_leads': manage_leads is a
// default sales-rep permission, so a rep could set their own (or a colleague's)
// revenue target and thereby decide whether they "hit target" — the same target
// the scorecards and bonus views read. view_reports is exactly the manager set
// (manager / admin / sales_collection_manager / online_manager / hr) and
// excludes sales; super-admins bypass permission checks entirely. Reads stay
// open on view_leads so the team leaderboard keeps working for everyone.
router.post('/api/admin/sales-targets', requireAuth, requireAdminOrStaff, requirePermission('manage_sales_team'), async (req, res) => {
  try {
    const { staffId, period } = req.body || {};
    if (!staffId || !/^\d{4}-\d{2}$/.test(period || '')) return res.status(400).json({ error: 'staffId and period (YYYY-MM) required' });
    // Merge: only overwrite a field that was actually sent, so two tabs writing the
    // same (staff, month) row (one sets revenue, the other leads) don't clobber.
    const scopedStaffId = String(staffId).slice(0, 64);
    if (scopedStaffId !== '__collection__') {
      const [[staff]] = await pool.query('SELECT id FROM staff WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1', [scopedStaffId, req.tenantId]);
      if (!staff) return res.status(400).json({ error: 'Staff member not found in tenant' });
    }
    const [[existing]] = await pool.query('SELECT revenue_target, leads_target FROM sales_targets WHERE tenant_id=? AND staff_id=? AND period=? LIMIT 1', [req.tenantId, scopedStaffId, period]);
    const revenueTarget = req.body.revenueTarget !== undefined ? (Number(req.body.revenueTarget) || 0) : (existing ? Number(existing.revenue_target) : 0);
    const leadsTarget   = req.body.leadsTarget   !== undefined ? (Number(req.body.leadsTarget)   || 0) : (existing ? Number(existing.leads_target)   : 0);
    await pool.query(
      `INSERT INTO sales_targets (tenant_id, staff_id, period, revenue_target, leads_target, updated_by)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE revenue_target=VALUES(revenue_target), leads_target=VALUES(leads_target), updated_by=VALUES(updated_by)`,
      [req.tenantId, scopedStaffId, period, revenueTarget, leadsTarget, (req.user?.id || req.user?.email || null)]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/sales-goals/vs-actual?period=YYYY-MM
router.get('/api/admin/sales-goals/vs-actual', requireAuth, requireAdmin, async (req, res) => {
  try {
    const period = req.query.period || cairoToday().slice(0, 7);
    // The month as a half-open range of UTC instants. `to` was period + '-31',
    // which is no date in a 30-day month or February: MariaDB answers NULL for
    // DATE_ADD('2026-09-31', …), so every «الفعلي» of September read 0.
    const range = monthRange(period);
    if (!range) return res.status(400).json({ error: 'الشهر لازم يكون بالشكل YYYY-MM' });
    const from = cairoDayStartUtc(range.startDate);
    const to   = cairoDayStartUtc(range.endDate);

    const [goalRows] = await pool.query(
      'SELECT id, period, revenue_target, leads_target, conversions_target, new_clients_target, created_at, updated_at FROM sales_goals WHERE tenant_id=? AND period = ?',
      [req.tenantId, period]
    );
    const goal = goalRows[0] || {};

    const [[{ actual_revenue }]] = await pool.query(
      `SELECT COALESCE(SUM(p.amount_egp), 0) AS actual_revenue FROM payments p WHERE p.tenant_id=? AND p.status='paid' AND p.created_at >= ? AND p.created_at < ? AND p.deleted_at IS NULL AND ${salesPaymentSql('p')}`, [req.tenantId, from, to]);
    const [[{ actual_leads }]] = await pool.query(
      `SELECT COUNT(*) AS actual_leads FROM leads WHERE tenant_id=? AND created_at >= ? AND created_at < ?`, [req.tenantId, from, to]);
    const [[{ actual_conversions }]] = await pool.query(
      `SELECT COUNT(*) AS actual_conversions FROM leads WHERE tenant_id=? AND status IN ${CONVERTED_SQL} AND updated_at >= ? AND updated_at < ?`, [req.tenantId, from, to]);
    const [[{ actual_new_clients }]] = await pool.query(
      `SELECT COUNT(*) AS actual_new_clients FROM subscribers WHERE tenant_id=? AND created_at >= ? AND created_at < ?`, [req.tenantId, from, to]);

    res.json({
      period,
      goals: {
        revenue: parseFloat(goal.revenue_target || 0),
        leads: parseInt(goal.leads_target || 0),
        conversions: parseInt(goal.conversions_target || 0),
        new_clients: parseInt(goal.new_clients_target || 0),
      },
      actual: {
        revenue: parseFloat(actual_revenue),
        leads: parseInt(actual_leads),
        conversions: parseInt(actual_conversions),
        new_clients: parseInt(actual_new_clients),
      },
      achievement: {
        revenue_pct:      goal.revenue_target     > 0 ? Math.round(actual_revenue     / goal.revenue_target     * 100) : null,
        leads_pct:        goal.leads_target        > 0 ? Math.round(actual_leads        / goal.leads_target        * 100) : null,
        conversions_pct:  goal.conversions_target  > 0 ? Math.round(actual_conversions  / goal.conversions_target  * 100) : null,
        new_clients_pct:  goal.new_clients_target  > 0 ? Math.round(actual_new_clients  / goal.new_clients_target  * 100) : null,
      }
    });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
