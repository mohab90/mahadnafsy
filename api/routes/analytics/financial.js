'use strict';
const logger = require('../../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../../lib/db');
const { tryJson } = require('../../lib/helpers');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { DEFAULT_TENANT } = require('../../middleware/tenantContext');

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: P&L (Profit & Loss) Report ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/financial/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/api/admin/financial/pnl', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-01-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);

    const [revRows] = await pool.query(`
      SELECT currency,
        COALESCE(SUM(CASE currency WHEN 'SAR' THEN amount*13 WHEN 'USD' THEN amount*50 ELSE amount END), 0) AS total_egp,
        COUNT(*) AS count
      FROM payments WHERE status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ?
      GROUP BY currency`, [from, to]);

    const [expRows] = await pool.query(`
      SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
      FROM expenses WHERE deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?
      GROUP BY category ORDER BY total DESC`, [from, to]);

    const [monthly] = await pool.query(`
      SELECT m.month,
        COALESCE(r.revenue, 0) AS revenue, COALESCE(e.expenses, 0) AS expenses
      FROM (
        SELECT DATE_FORMAT(d, '%Y-%m') AS month FROM
          (SELECT \`date\` AS d FROM payments WHERE status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ?
           UNION SELECT \`date\` AS d FROM expenses WHERE deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?) t
        GROUP BY month
      ) m
      LEFT JOIN (SELECT DATE_FORMAT(\`date\`,'%Y-%m') AS month, SUM(CASE currency WHEN 'SAR' THEN amount*13 WHEN 'USD' THEN amount*50 ELSE amount END) AS revenue FROM payments WHERE status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ? GROUP BY month) r ON r.month=m.month
      LEFT JOIN (SELECT DATE_FORMAT(\`date\`,'%Y-%m') AS month, SUM(amount) AS expenses FROM expenses WHERE deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ? GROUP BY month) e ON e.month=m.month
      ORDER BY m.month`, [from, to, from, to, from, to, from, to]);

    const totalRevenue  = revRows.reduce((s, r) => s + Number(r.total_egp), 0);
    const totalExpenses = expRows.reduce((s, r) => s + Number(r.total), 0);
    const netProfit     = totalRevenue - totalExpenses;

    res.json({
      from, to, totalRevenue, totalExpenses, netProfit,
      margin: totalRevenue > 0 ? parseFloat((netProfit / totalRevenue * 100).toFixed(1)) : 0,
      expensesByCategory: expRows,
      monthly: monthly.map(m => ({ ...m, revenue: Number(m.revenue), expenses: Number(m.expenses), net: Number(m.revenue) - Number(m.expenses) })),
    });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Recurring Expenses ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS recurring_expenses (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      title VARCHAR(200) NOT NULL,
      amount_egp DECIMAL(12,2) NOT NULL,
      category VARCHAR(100),
      notes TEXT,
      frequency ENUM('monthly','quarterly','yearly') DEFAULT 'monthly',
      day_of_month TINYINT DEFAULT 1,
      is_active TINYINT(1) DEFAULT 1,
      last_run DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(200)
    )`);
    logger.info('[schema] recurring_expenses ready');
  } catch (e) { logger.warn('[schema recurring_expenses]', e.message); }
})();
router.get  ('/api/admin/recurring-expenses', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try { const [rows] = await pool.query(
    `SELECT id, title, amount_egp, category, notes, frequency, day_of_month, is_active, last_run, created_at, created_by
     FROM recurring_expenses WHERE tenant_id = ? ORDER BY created_at DESC`
  , [req.tenantId]); res.json(rows); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post  ('/api/admin/recurring-expenses', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const { title, amount_egp, category, notes, frequency='monthly', day_of_month=1 } = req.body;
    if (!title || !amount_egp) return res.status(400).json({ error: 'title and amount_egp required' });
    const id = require('crypto').randomUUID();
    await pool.query('INSERT INTO recurring_expenses (id,title,amount_egp,category,notes,frequency,day_of_month,created_by) VALUES (?,?,?,?,?,?,?,?)',
      [id, title, amount_egp, category||null, notes||null, frequency, day_of_month, req.user?.email||null]);
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.put  ('/api/admin/recurring-expenses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const { title, amount_egp, category, notes, frequency, day_of_month, is_active } = req.body;
    await pool.query('UPDATE recurring_expenses SET title=COALESCE(?,title),amount_egp=COALESCE(?,amount_egp),category=COALESCE(?,category),notes=COALESCE(?,notes),frequency=COALESCE(?,frequency),day_of_month=COALESCE(?,day_of_month),is_active=COALESCE(?,is_active) WHERE id=?',
      [title||null, amount_egp||null, category||null, notes||null, frequency||null, day_of_month||null, is_active??null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/recurring-expenses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try { await pool.query('DELETE FROM recurring_expenses WHERE id=?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
// Cron: auto-create expenses from recurring templates daily at 8 AM Cairo
setInterval(async () => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  if (now.getHours() !== 8 || now.getMinutes() > 4) return;
  const today = now.toISOString().slice(0, 10);
  const dom   = now.getDate();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  try {
    const [recs] = await pool.query(
      `SELECT id, title, amount_egp, category, notes, frequency, day_of_month, is_active, last_run, created_at, created_by
       FROM recurring_expenses WHERE is_active=1 AND day_of_month=? AND (last_run IS NULL OR last_run < ?)`,
      [dom, monthStart]
    );
    if (recs.length > 0) {
      // Atomic: only mark last_run if expenses were actually created
      // expenses.category is an ENUM(SALARIES,RENT,...,OTHER); recurring category is
      // free text, so store it as OTHER and keep the original label in the description.
      const expRows = recs.map(() => '(?,?,?,?,?,?,?)');
      const expParams = recs.flatMap(rec => [
        require('crypto').randomUUID(),
        `[تلقائي] ${rec.title}${rec.category ? ' — ' + rec.category : ''}`, rec.amount_egp,
        'OTHER', today,
        `مصروف متكرر - ${rec.frequency}`,
        DEFAULT_TENANT,
      ]);
      try {
        await pool.query(`INSERT INTO expenses (id,description,amount,category,\`date\`,note,tenant_id) VALUES ${expRows.join(',')}`, expParams);
      } catch (e) {
        logger.warn('[cron recurring] INSERT failed — last_run NOT updated (will retry tomorrow):', e.message);
        return; // Don't update last_run; cron will retry next tick
      }
      // Only reached if INSERT succeeded — safe to mark as processed
      const recIds = recs.map(r => r.id);
      await pool.query(
        `UPDATE recurring_expenses SET last_run=? WHERE id IN (${recIds.map(() => '?').join(',')})`,
        [today, ...recIds]
      );
      logger.info(`[cron recurring] created ${recs.length} expense(s)`);
    }
  } catch (e) { logger.warn('[cron recurring]', e.message); }
}, 60000);

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Structured Installment Plans ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS installment_plans (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      subscriber_id VARCHAR(100) NOT NULL,
      payment_id VARCHAR(100),
      title VARCHAR(200),
      total_amount DECIMAL(12,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'EGP',
      installments_count INT NOT NULL DEFAULT 3,
      paid_count INT DEFAULT 0,
      installment_amounts JSON,
      due_dates JSON,
      paid_dates JSON,
      status ENUM('active','completed','overdue','cancelled') DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(200),
      KEY idx_inst_sub (subscriber_id),
      KEY idx_inst_status (status)
    )`);
    logger.info('[schema] installment_plans ready');
  } catch (e) { logger.warn('[schema installment_plans]', e.message); }
})();
router.get('/api/admin/installment-plans', requireAuth, async (req, res) => {
  try {
    const { subscriber_id, status } = req.query;
    let q = 'SELECT ip.*, s.name AS subscriber_name, s.phone AS subscriber_phone FROM installment_plans ip LEFT JOIN subscribers s ON s.id=ip.subscriber_id WHERE 1=1';
    const params = [];
    if (subscriber_id) { q += ' AND ip.subscriber_id=?'; params.push(subscriber_id); }
    if (status) { q += ' AND ip.status=?'; params.push(status); }
    q += ' ORDER BY ip.created_at DESC LIMIT 200';
    const [rows] = await pool.query(q, params);
    res.json(rows.map(r => ({ ...r, installment_amounts: tryJson(r.installment_amounts,[]), due_dates: tryJson(r.due_dates,[]), paid_dates: tryJson(r.paid_dates,[]) })));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/admin/installment-plans', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const { subscriber_id, title, total_amount, currency='EGP', installments_count=3, due_dates=[], notes, payment_id } = req.body;
    if (!subscriber_id || !total_amount) return res.status(400).json({ error: 'subscriber_id and total_amount required' });
    const id = require('crypto').randomUUID();
    const per = parseFloat((total_amount / installments_count).toFixed(2));
    await pool.query('INSERT INTO installment_plans (id,subscriber_id,payment_id,title,total_amount,currency,installments_count,installment_amounts,due_dates,paid_dates,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, subscriber_id, payment_id||null, title||'خطة تقسيط', total_amount, currency, installments_count,
       JSON.stringify(Array(Number(installments_count)).fill(per)), JSON.stringify(due_dates), JSON.stringify([]), notes||null, req.user?.email||null]);
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.patch('/api/admin/installment-plans/:id/pay', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const { installment_index } = req.body;
    const [[plan]] = await pool.query(
      `SELECT id, subscriber_id, payment_id, title, total_amount, currency, installments_count,
              paid_count, installment_amounts, due_dates, paid_dates, status, notes, created_at, created_by
       FROM installment_plans WHERE id=?`, [req.params.id]
    );
    if (!plan) return res.status(404).json({ error: 'Not found' });
    const paidDates = tryJson(plan.paid_dates, []);
    paidDates[installment_index] = new Date().toISOString().slice(0, 10);
    const paidCount = paidDates.filter(Boolean).length;
    const st = paidCount >= plan.installments_count ? 'completed' : 'active';
    await pool.query('UPDATE installment_plans SET paid_dates=?,paid_count=?,status=? WHERE id=?', [JSON.stringify(paidDates), paidCount, st, req.params.id]);
    res.json({ ok: true, paid_count: paidCount, status: st });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/installment-plans/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try { await pool.query('DELETE FROM installment_plans WHERE id=?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: VAT Tracking on Expenses ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 0");
    await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) DEFAULT 0");
    await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount_before_vat DECIMAL(12,2) DEFAULT NULL");
    logger.info('[schema] expenses VAT columns ready');
  } catch (e) { logger.warn('[schema vat]', e.message); }
})();
// GET /api/admin/financial/vat-summary?from=&to=
router.get('/api/admin/financial/vat-summary', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-01-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);
    const [[exp]] = await pool.query(`SELECT COALESCE(SUM(vat_amount),0) AS total_vat_paid, COALESCE(SUM(amount),0) AS total_expenses FROM expenses WHERE deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?`, [from, to]);
    const [[rev]] = await pool.query(`SELECT COALESCE(SUM(CASE currency WHEN 'SAR' THEN amount*13 WHEN 'USD' THEN amount*50 ELSE amount END),0) AS revenue FROM payments WHERE status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ?`, [from, to]);
    res.json({ from, to, total_vat_paid: Number(exp.total_vat_paid), total_expenses: Number(exp.total_expenses), estimated_output_vat: Math.round(rev.revenue * 0.14), vat_rate_standard: 14 });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: CSV / Excel Export ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function toCsv(rows, cols) {
  const escape = v => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  };
  const header = cols.map(c => escape(c.label)).join(',');
  const body = rows.map(r => cols.map(c => escape(r[c.key])).join(',')).join('\n');
  return header + '\n' + body;
}

// GET /api/admin/export/payments?from=YYYY-MM-DD&to=YYYY-MM-DD
// (removed dead duplicate GET /api/admin/export/payments — live in an earlier-mounted router)

// GET /api/admin/export/subscribers
// (removed dead duplicate GET /api/admin/export/subscribers — live in an earlier-mounted router)

// GET /api/admin/export/leads
// (removed dead duplicate GET /api/admin/export/leads — live in an earlier-mounted router)

// GET /api/admin/export/expenses
router.get('/api/admin/export/expenses', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = `SELECT id, title, amount, category, recurrence, date, notes FROM expenses WHERE tenant_id = ? AND deleted_at IS NULL AND 1=1`;
    const params = [req.tenantId];
    if (from) { sql += ' AND date >= ?'; params.push(from); }
    if (to)   { sql += ' AND date <= ?'; params.push(to); }
    sql += ' ORDER BY date DESC LIMIT 50000';
    const [rows] = await pool.query(sql, params);
    const cols = [
      { key: 'id', label: 'ID' },
      { key: 'title', label: 'البند' },
      { key: 'amount', label: 'المبلغ' },
      { key: 'category', label: 'الفئة' },
      { key: 'recurrence', label: 'التكرار' },
      { key: 'date', label: 'التاريخ' },
      { key: 'notes', label: 'ملاحظات' },
    ];
    const csv = toCsv(rows, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${Date.now()}.csv"`);
    res.send('﻿' + csv);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Balance Sheet ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/financial/balance-sheet?asOf=YYYY-MM-DD
router.get('/api/admin/financial/balance-sheet', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const asOf = req.query.asOf || new Date().toISOString().slice(0, 10);

    // Assets: total payments received up to asOf
    const [[{ totalRevenue }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS totalRevenue FROM payments WHERE status='paid' AND DATE(created_at) <= ?`, [asOf]);

    // Liabilities: outstanding balance (remaining_amount) for subscribers created up to asOf
    const [[{ totalLiabilities }]] = await pool.query(
      `SELECT COALESCE(SUM(remaining_amount), 0) AS totalLiabilities FROM subscribers WHERE DATE(created_at) <= ? AND remaining_amount > 0`, [asOf]);

    // Expenses up to asOf
    const [[{ totalExpenses }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS totalExpenses FROM expenses WHERE deleted_at IS NULL AND DATE(date) <= ?`, [asOf]);

    // Refunds issued up to asOf
    const [[{ totalRefunds }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS totalRefunds FROM payments WHERE status='refunded' AND DATE(created_at) <= ?`, [asOf]).catch(() => [[{ totalRefunds: 0 }]]);

    const cashAndEquivalents = parseFloat(totalRevenue) - parseFloat(totalExpenses) - parseFloat(totalRefunds);
    const equity = cashAndEquivalents - parseFloat(totalLiabilities);

    res.json({
      asOf,
      assets: {
        cashAndEquivalents: Math.max(0, cashAndEquivalents),
        totalRevenue: parseFloat(totalRevenue),
        totalAssets: Math.max(0, cashAndEquivalents),
      },
      liabilities: {
        outstandingReceivables: parseFloat(totalLiabilities),
        totalLiabilities: parseFloat(totalLiabilities),
      },
      equity: {
        retainedEarnings: equity,
        totalEquity: equity,
      },
      summary: {
        totalRevenue: parseFloat(totalRevenue),
        totalExpenses: parseFloat(totalExpenses),
        totalRefunds: parseFloat(totalRefunds),
        netPosition: equity,
      }
    });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Cash Flow Statement ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/financial/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/api/admin/financial/cash-flow', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to   = req.query.to   || now.toISOString().slice(0, 10);

    // Operating Inflows: payments received
    const [[{ inflows }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS inflows FROM payments WHERE status='paid' AND DATE(created_at) BETWEEN ? AND ?`, [from, to]);

    // Operating Outflows: expenses paid
    const [[{ outflows }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS outflows FROM expenses WHERE deleted_at IS NULL AND DATE(date) BETWEEN ? AND ?`, [from, to]);

    // Refunds
    const [[{ refunds }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS refunds FROM payments WHERE status='refunded' AND DATE(created_at) BETWEEN ? AND ?`, [from, to]).catch(() => [[{ refunds: 0 }]]);

    // Monthly breakdown
    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
             SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) AS revenue,
             SUM(CASE WHEN status='refunded' THEN amount ELSE 0 END) AS refunds
      FROM payments
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY month ORDER BY month`, [from, to]);

    const [monthlyExp] = await pool.query(`
      SELECT DATE_FORMAT(date, '%Y-%m') AS month, SUM(amount) AS expenses
      FROM expenses WHERE deleted_at IS NULL AND DATE(date) BETWEEN ? AND ?
      GROUP BY month ORDER BY month`, [from, to]);

    const expMap = Object.fromEntries(monthlyExp.map(r => [r.month, parseFloat(r.expenses)]));
    const cashFlowMonthly = monthly.map(r => ({
      month: r.month,
      revenue: parseFloat(r.revenue),
      refunds: parseFloat(r.refunds),
      expenses: expMap[r.month] || 0,
      netCashFlow: parseFloat(r.revenue) - parseFloat(r.refunds) - (expMap[r.month] || 0),
    }));

    res.json({
      period: { from, to },
      operating: {
        inflows: parseFloat(inflows),
        outflows: parseFloat(outflows),
        refunds: parseFloat(refunds),
        netOperatingCashFlow: parseFloat(inflows) - parseFloat(outflows) - parseFloat(refunds),
      },
      monthly: cashFlowMonthly,
    });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
