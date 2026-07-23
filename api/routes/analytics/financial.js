'use strict';
const logger = require('../../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { postExpenseJournal } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');

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
        COALESCE(SUM(amount_egp), 0) AS total_egp,
        COUNT(*) AS count
      FROM payments WHERE tenant_id=? AND status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ?
      GROUP BY currency`, [req.tenantId, from, to]);

    const [expRows] = await pool.query(`
      SELECT category, COALESCE(SUM(amount_egp), 0) AS total, COUNT(*) AS count
      FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?
      GROUP BY category ORDER BY total DESC`, [req.tenantId, from, to]);

    const [monthly] = await pool.query(`
      SELECT m.month,
        COALESCE(r.revenue, 0) AS revenue, COALESCE(e.expenses, 0) AS expenses
      FROM (
        SELECT DATE_FORMAT(d, '%Y-%m') AS month FROM
          (SELECT \`date\` AS d FROM payments WHERE tenant_id=? AND status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ?
           UNION SELECT \`date\` AS d FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?) t
        GROUP BY month
      ) m
      LEFT JOIN (SELECT DATE_FORMAT(\`date\`,'%Y-%m') AS month, SUM(amount_egp) AS revenue FROM payments WHERE tenant_id=? AND status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ? GROUP BY month) r ON r.month=m.month
      LEFT JOIN (SELECT DATE_FORMAT(\`date\`,'%Y-%m') AS month, SUM(amount_egp) AS expenses FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ? GROUP BY month) e ON e.month=m.month
      ORDER BY m.month`, [req.tenantId, from, to, req.tenantId, from, to, req.tenantId, from, to, req.tenantId, from, to]);

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
    await pool.query('INSERT INTO recurring_expenses (id,tenant_id,title,amount_egp,category,notes,frequency,day_of_month,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, req.tenantId, title, amount_egp, category||null, notes||null, frequency, day_of_month, req.user?.email||null]);
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.put  ('/api/admin/recurring-expenses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const { title, amount_egp, category, notes, frequency, day_of_month, is_active } = req.body;
    await pool.query('UPDATE recurring_expenses SET title=COALESCE(?,title),amount_egp=COALESCE(?,amount_egp),category=COALESCE(?,category),notes=COALESCE(?,notes),frequency=COALESCE(?,frequency),day_of_month=COALESCE(?,day_of_month),is_active=COALESCE(?,is_active) WHERE id=? AND tenant_id=?',
      [title||null, amount_egp||null, category||null, notes||null, frequency||null, day_of_month||null, is_active??null, req.params.id, req.tenantId]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/recurring-expenses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try { await pool.query('DELETE FROM recurring_expenses WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]); res.json({ ok: true }); }
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
      `SELECT id, tenant_id, title, amount_egp, category, notes, frequency, day_of_month, is_active, last_run, created_at, created_by
       FROM recurring_expenses WHERE is_active=1 AND day_of_month=? AND (last_run IS NULL OR last_run < ?)`,
      [dom, monthStart]
    );
    let created = 0;
    for (const candidate of recs) {
      const conn = await pool.getConnection();
      let tx = false;
      try {
        await conn.beginTransaction();
        tx = true;
        const [[rec]] = await conn.query(
          `SELECT id, tenant_id, title, amount_egp, category, frequency, last_run
           FROM recurring_expenses
           WHERE id=? AND tenant_id=? AND is_active=1 AND (last_run IS NULL OR last_run < ?)
           FOR UPDATE`,
          [candidate.id, candidate.tenant_id, monthStart]
        );
        if (!rec) { await conn.rollback(); tx = false; continue; }
        await assertWritable(today, conn, rec.tenant_id);
        const expenseId = require('crypto').randomUUID();
        const description = `[تلقائي] ${rec.title}${rec.category ? ' — ' + rec.category : ''}`;
        await conn.query(
          `INSERT INTO expenses (id,description,amount,currency,category,\`date\`,note,tenant_id)
           VALUES (?,?,?,'EGP','OTHER',?,?,?)`,
          [expenseId, description, rec.amount_egp, today, `مصروف متكرر - ${rec.frequency}`, rec.tenant_id]
        );
        const journalId = await postExpenseJournal(
          { id: expenseId, tenant_id: rec.tenant_id, description, amount: rec.amount_egp, currency: 'EGP', category: 'OTHER', date: today },
          +1, 'recurring-expense-cron', conn, rec.tenant_id
        );
        if (!journalId) throw new Error('Recurring expense journal posting failed');
        await conn.query('UPDATE recurring_expenses SET last_run=? WHERE id=? AND tenant_id=?', [today, rec.id, rec.tenant_id]);
        await conn.commit();
        tx = false;
        created += 1;
      } catch (e) {
        if (tx) await conn.rollback().catch(() => {});
        logger.warn('[cron recurring] item skipped:', e.message);
      } finally { conn.release(); }
    }
    if (created) logger.info(`[cron recurring] created ${created} expense(s)`);
  } catch (e) { logger.warn('[cron recurring]', e.message); }
}, 60000);

// Structured Installment Plans used to live here — a duplicate, older
// implementation of the same feature routes/installments.js now owns
// (built for PAY-16). Because this router mounts before installmentsRouter
// in server.js, this copy's blind, unconditional DELETE (no check for
// already-recorded payments) silently WON over installments.js's real one,
// which correctly refuses to delete a plan with paid_count > 0 — the safe
// delete guard built for PAY-16 never actually ran. Removed rather than
// reordering the mounts, since this copy's other endpoints (flat GET, PATCH
// .../pay) were also unused by any frontend caller — see routes/installments.js.

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: VAT Tracking on Expenses ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/financial/vat-summary?from=&to=
router.get('/api/admin/financial/vat-summary', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const from = req.query.from || `${new Date().getFullYear()}-01-01`;
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);
    const [[exp]] = await pool.query(`SELECT COALESCE(SUM(vat_amount),0) AS total_vat_paid, COALESCE(SUM(amount_egp),0) AS total_expenses FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?`, [req.tenantId, from, to]);
    const [[rev]] = await pool.query(`SELECT COALESCE(SUM(amount_egp),0) AS revenue FROM payments WHERE tenant_id=? AND status IN ('paid','confirmed') AND DATE(\`date\`) BETWEEN ? AND ?`, [req.tenantId, from, to]);
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
    // Real expenses columns are description/note (not title/notes), and there is
    // no `recurrence` column on this table — selecting those threw
    // "Unknown column" and broke the whole CSV export.
    let sql = `SELECT id, description, amount, currency, category, date, note FROM expenses WHERE tenant_id = ? AND deleted_at IS NULL AND 1=1`;
    const params = [req.tenantId];
    if (from) { sql += ' AND date >= ?'; params.push(from); }
    if (to)   { sql += ' AND date <= ?'; params.push(to); }
    sql += ' ORDER BY date DESC LIMIT 50000';
    const [rows] = await pool.query(sql, params);
    const cols = [
      { key: 'id', label: 'ID' },
      { key: 'description', label: 'البند' },
      { key: 'amount', label: 'المبلغ' },
      { key: 'currency', label: 'العملة' },
      { key: 'category', label: 'الفئة' },
      { key: 'date', label: 'التاريخ' },
      { key: 'note', label: 'ملاحظات' },
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
      `SELECT COALESCE(SUM(amount_egp), 0) AS totalRevenue FROM payments WHERE tenant_id=? AND status='paid' AND DATE(created_at) <= ?`, [req.tenantId, asOf]);

    // Liabilities: outstanding balance (remaining_amount) for subscribers created up to asOf
    const [[{ totalLiabilities }]] = await pool.query(
      `SELECT COALESCE(SUM(remaining_amount), 0) AS totalLiabilities FROM subscribers WHERE tenant_id=? AND DATE(created_at) <= ? AND remaining_amount > 0`, [req.tenantId, asOf]);

    // Expenses up to asOf
    const [[{ totalExpenses }]] = await pool.query(
      `SELECT COALESCE(SUM(amount_egp), 0) AS totalExpenses FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND DATE(date) <= ?`, [req.tenantId, asOf]);

    // Refunds issued up to asOf
    const [[{ totalRefunds }]] = await pool.query(
      `SELECT COALESCE(SUM(amount_egp), 0) AS totalRefunds FROM payments WHERE tenant_id=? AND status='refunded' AND DATE(created_at) <= ?`, [req.tenantId, asOf]).catch(() => [[{ totalRefunds: 0 }]]);

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
      `SELECT COALESCE(SUM(amount_egp), 0) AS inflows FROM payments WHERE tenant_id=? AND status='paid' AND DATE(created_at) BETWEEN ? AND ?`, [req.tenantId, from, to]);

    // Operating Outflows: expenses paid
    const [[{ outflows }]] = await pool.query(
      `SELECT COALESCE(SUM(amount_egp), 0) AS outflows FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND DATE(date) BETWEEN ? AND ?`, [req.tenantId, from, to]);

    // Refunds
    const [[{ refunds }]] = await pool.query(
      `SELECT COALESCE(SUM(amount_egp), 0) AS refunds FROM payments WHERE tenant_id=? AND status='refunded' AND DATE(created_at) BETWEEN ? AND ?`, [req.tenantId, from, to]).catch(() => [[{ refunds: 0 }]]);

    // Monthly breakdown
    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
             SUM(CASE WHEN status='paid' THEN amount_egp ELSE 0 END) AS revenue,
             SUM(CASE WHEN status='refunded' THEN amount_egp ELSE 0 END) AS refunds
      FROM payments
      WHERE tenant_id=? AND DATE(created_at) BETWEEN ? AND ?
      GROUP BY month ORDER BY month`, [req.tenantId, from, to]);

    const [monthlyExp] = await pool.query(`
      SELECT DATE_FORMAT(date, '%Y-%m') AS month, SUM(amount_egp) AS expenses
      FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND DATE(date) BETWEEN ? AND ?
      GROUP BY month ORDER BY month`, [req.tenantId, from, to]);

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
