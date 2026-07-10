'use strict';
const logger = require('../../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Sales Team Performance + Lead Conversion Funnel ──────────────
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/reports/sales-performance?from=&to=
router.get('/api/admin/reports/sales-performance', requireAuth, requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);

    const [staff] = await pool.query(`
      SELECT st.id, st.name, st.email, st.role, st.commission_rate,
        COALESCE(ld.total_leads, 0) AS total_leads, COALESCE(ld.converted, 0) AS converted_leads,
        COALESCE(rd.revenue_egp, 0) AS revenue_egp, COALESCE(rd.payment_count, 0) AS payment_count
      FROM staff st
      LEFT JOIN (
        SELECT assigned_sales_id, COUNT(*) AS total_leads,
          SUM(CASE WHEN status IN ('converted','won') THEN 1 ELSE 0 END) AS converted
        FROM leads WHERE DATE(created_at) BETWEEN ? AND ? AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id
      ) ld ON ld.assigned_sales_id = st.id
      LEFT JOIN (
        SELECT staff_id,
          SUM(CASE currency WHEN 'SAR' THEN amount*13 WHEN 'USD' THEN amount*50 ELSE amount END) AS revenue_egp,
          COUNT(*) AS payment_count
        FROM payments WHERE status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ? AND staff_id IS NOT NULL GROUP BY staff_id
      ) rd ON rd.staff_id = st.id
      WHERE UPPER(st.role) IN ('SALES','SALES_MANAGER','MANAGER') AND st.is_active=1
      ORDER BY revenue_egp DESC`, [from, to, from, to]);

    res.json({
      from, to,
      staff: staff.map(s => ({
        ...s,
        commission_due: s.commission_rate ? Math.round(Number(s.revenue_egp) * Number(s.commission_rate) / 100) : null,
        conversion_rate: s.total_leads > 0 ? parseFloat((s.converted_leads / s.total_leads * 100).toFixed(1)) : null,
      })),
    });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/reports/lead-funnel?from=&to=
router.get('/api/admin/reports/lead-funnel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);
    const [byStatus] = await pool.query(`SELECT status, COUNT(*) AS count FROM leads WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY status ORDER BY count DESC`, [from, to]);
    const [bySource] = await pool.query(`SELECT source, COUNT(*) AS total, SUM(CASE WHEN status IN ('converted','won') THEN 1 ELSE 0 END) AS converted FROM leads WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY source ORDER BY total DESC`, [from, to]);
    const [byBranch] = await pool.query(`SELECT branch, COUNT(*) AS total, SUM(CASE WHEN status IN ('converted','won') THEN 1 ELSE 0 END) AS converted FROM leads WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY branch ORDER BY total DESC`, [from, to]);
    const total     = byStatus.reduce((s, r) => s + Number(r.count), 0);
    const converted = byStatus.filter(r => ['converted','won'].includes(r.status)).reduce((s, r) => s + Number(r.count), 0);
    const lost      = byStatus.filter(r => r.status === 'lost').reduce((s, r) => s + Number(r.count), 0);
    res.json({
      from, to, total, converted, lost,
      conversion_rate: total > 0 ? parseFloat((converted / total * 100).toFixed(1)) : 0,
      byStatus,
      bySource: bySource.map(s => ({ ...s, conversion_rate: s.total > 0 ? parseFloat((Number(s.converted) / s.total * 100).toFixed(1)) : 0 })),
      byBranch: byBranch.map(b => ({ ...b, conversion_rate: b.total > 0 ? parseFloat((Number(b.converted) / b.total * 100).toFixed(1)) : 0 })),
    });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Sales Goals / Targets ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Ensure sales_goals table
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS sales_goals (
      id INT PRIMARY KEY AUTO_INCREMENT,
      period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
      revenue_target DECIMAL(12,2) DEFAULT 0,
      leads_target INT DEFAULT 0,
      conversions_target INT DEFAULT 0,
      new_clients_target INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_period (period)
    )`);
  } catch (e) { logger.warn('[sales_goals table]', e.message); }
})();

// GET /api/admin/sales-goals?period=YYYY-MM (or list all)
router.get('/api/admin/sales-goals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { period } = req.query;
    let sql = 'SELECT id, period, revenue_target, leads_target, conversions_target, new_clients_target, created_at, updated_at FROM sales_goals';
    const params = [];
    if (period) { sql += ' WHERE period = ?'; params.push(period); }
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
    await pool.query(`INSERT INTO sales_goals (period, revenue_target, leads_target, conversions_target, new_clients_target)
                      VALUES (?, ?, ?, ?, ?)
                      ON DUPLICATE KEY UPDATE
                        revenue_target=VALUES(revenue_target),
                        leads_target=VALUES(leads_target),
                        conversions_target=VALUES(conversions_target),
                        new_clients_target=VALUES(new_clients_target)`,
      [period, revenue_target, leads_target, conversions_target, new_clients_target]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ── Per-staff sales targets (single source of truth across SalesGoalsTab,
//    LeadsPerformancePanel and the collection target — were localStorage before).
//    staff_id '__collection__' holds the org-wide collection monthly target. ──
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS sales_targets (
      staff_id VARCHAR(64) NOT NULL,
      period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
      revenue_target DECIMAL(12,2) DEFAULT 0,
      leads_target INT DEFAULT 0,
      updated_by VARCHAR(64) DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (staff_id, period)
    ) COLLATE utf8mb4_unicode_ci`);
  } catch (e) { logger.warn('[sales_targets table]', e.message); }
})();

// GET /api/admin/sales-targets?period=YYYY-MM (omit period → recent across staff)
router.get('/api/admin/sales-targets', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { period } = req.query;
    let sql = 'SELECT staff_id AS staffId, period, revenue_target AS revenueTarget, leads_target AS leadsTarget, updated_at AS updatedAt FROM sales_targets';
    const params = [];
    if (period) { sql += ' WHERE period = ?'; params.push(period); }
    else sql += ' ORDER BY period DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/sales-targets  (upsert one {staffId, period, revenueTarget, leadsTarget})
router.post('/api/admin/sales-targets', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { staffId, period } = req.body || {};
    if (!staffId || !/^\d{4}-\d{2}$/.test(period || '')) return res.status(400).json({ error: 'staffId and period (YYYY-MM) required' });
    // Merge: only overwrite a field that was actually sent, so two tabs writing the
    // same (staff, month) row (one sets revenue, the other leads) don't clobber.
    const [[existing]] = await pool.query('SELECT revenue_target, leads_target FROM sales_targets WHERE staff_id=? AND period=? LIMIT 1', [String(staffId).slice(0, 64), period]);
    const revenueTarget = req.body.revenueTarget !== undefined ? (Number(req.body.revenueTarget) || 0) : (existing ? Number(existing.revenue_target) : 0);
    const leadsTarget   = req.body.leadsTarget   !== undefined ? (Number(req.body.leadsTarget)   || 0) : (existing ? Number(existing.leads_target)   : 0);
    await pool.query(
      `INSERT INTO sales_targets (staff_id, period, revenue_target, leads_target, updated_by)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE revenue_target=VALUES(revenue_target), leads_target=VALUES(leads_target), updated_by=VALUES(updated_by)`,
      [String(staffId).slice(0, 64), period, revenueTarget, leadsTarget, (req.user?.id || req.user?.email || null)]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/sales-goals/vs-actual?period=YYYY-MM
router.get('/api/admin/sales-goals/vs-actual', requireAuth, requireAdmin, async (req, res) => {
  try {
    const period = req.query.period || new Date().toISOString().slice(0, 7);
    const from = period + '-01';
    const to   = period + '-31';

    const [goalRows] = await pool.query(
      'SELECT id, period, revenue_target, leads_target, conversions_target, new_clients_target, created_at, updated_at FROM sales_goals WHERE period = ?',
      [period]
    );
    const goal = goalRows[0] || {};

    const [[{ actual_revenue }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS actual_revenue FROM payments WHERE status='paid' AND DATE(created_at) BETWEEN ? AND ?`, [from, to]);
    const [[{ actual_leads }]] = await pool.query(
      `SELECT COUNT(*) AS actual_leads FROM leads WHERE DATE(created_at) BETWEEN ? AND ?`, [from, to]);
    const [[{ actual_conversions }]] = await pool.query(
      `SELECT COUNT(*) AS actual_conversions FROM leads WHERE status='converted' AND DATE(updated_at) BETWEEN ? AND ?`, [from, to]);
    const [[{ actual_new_clients }]] = await pool.query(
      `SELECT COUNT(*) AS actual_new_clients FROM subscribers WHERE DATE(created_at) BETWEEN ? AND ?`, [from, to]);

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
