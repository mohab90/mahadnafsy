'use strict';
const logger = require('../../lib/logger');
const express = require('express');
const router  = express.Router();

const { pool } = require('../../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { logFinancialAudit, postExpenseJournal } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
const { bulkOperationLimiter } = require('../../middleware/rateLimits');
const { resolveFinancialScope } = require('../../lib/financialScope');
const { dateOnlyInTimeZone, isValidDateOnly, zonedDateTimeParts } = require('../../lib/dates');
const { getTenantSetting } = require('../../lib/tenantSettings');

function validDateRange(from, to) {
  return isValidDateOnly(from) && isValidDateOnly(to) && from <= to;
}

const EXPENSE_CATEGORIES = new Set([
  'SALARIES', 'RENT', 'UTILITIES', 'SOFTWARE', 'MARKETING',
  'EQUIPMENT', 'MAINTENANCE', 'TRAVEL', 'OTHER',
]);

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: P&L (Profit & Loss) Report ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/financial/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/api/admin/financial/pnl', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const today = dateOnlyInTimeZone();
    const from = req.query.from || `${today.slice(0, 4)}-01-01`;
    const to   = req.query.to   || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const { branch, branchId } = scope;
    const journalBranchSql = branchId ? ' AND je.branch_id=?' : '';
    const expenseBranchSql = branchId ? ' AND branch_id=?' : '';

    const [[ledgerTotals]] = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN jel.account_code LIKE '4%' THEN jel.credit-jel.debit ELSE 0 END),0) AS revenue,
        COALESCE(SUM(CASE WHEN jel.account_code LIKE '5%' THEN jel.debit-jel.credit ELSE 0 END),0) AS expenses
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id
      WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ?${journalBranchSql}`,
    branchId ? [req.tenantId, from, to, branchId] : [req.tenantId, from, to]);

    const [expRows] = await pool.query(`
      SELECT category, COALESCE(SUM(amount_egp), 0) AS total, COUNT(*) AS count
      FROM expenses WHERE tenant_id=? AND deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?${expenseBranchSql}
      GROUP BY category ORDER BY total DESC`,
    branchId ? [req.tenantId, from, to, branchId] : [req.tenantId, from, to]);

    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(je.entry_date,'%Y-%m') AS month,
        COALESCE(SUM(CASE WHEN jel.account_code LIKE '4%' THEN jel.credit-jel.debit ELSE 0 END),0) AS revenue,
        COALESCE(SUM(CASE WHEN jel.account_code LIKE '5%' THEN jel.debit-jel.credit ELSE 0 END),0) AS expenses
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id
      WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ?${journalBranchSql}
      GROUP BY DATE_FORMAT(je.entry_date,'%Y-%m')
      ORDER BY month`,
    branchId ? [req.tenantId, from, to, branchId] : [req.tenantId, from, to]);

    const totalRevenue  = Number(ledgerTotals.revenue) || 0;
    const totalExpenses = Number(ledgerTotals.expenses) || 0;
    const netProfit     = totalRevenue - totalExpenses;

    res.json({
      from, to, branch, branchId, totalRevenue, totalExpenses, netProfit,
      margin: totalRevenue > 0 ? parseFloat((netProfit / totalRevenue * 100).toFixed(1)) : 0,
      expensesByCategory: expRows,
      monthly: monthly.map(m => ({ ...m, revenue: Number(m.revenue), expenses: Number(m.expenses), net: Number(m.revenue) - Number(m.expenses) })),
    });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Recurring Expenses ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
router.get  ('/api/admin/recurring-expenses', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND branch_id=?' : '';
    const [rows] = await pool.query(
      `SELECT id, title, amount_egp, category, notes, frequency, day_of_month, is_active,
              last_run, branch, branch_id, created_at, created_by
       FROM recurring_expenses
       WHERE tenant_id=? AND deleted_at IS NULL${branchSql}
       ORDER BY created_at DESC`,
      scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]
    );
    res.json(rows);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});
router.post  ('/api/admin/recurring-expenses', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let tx = false;
  try {
    const { title, amount_egp, category='OTHER', notes, frequency='monthly', day_of_month=1 } = req.body;
    const scope = resolveFinancialScope(req, { requestedBranch: req.body.branch || null });
    const amount = Number(amount_egp);
    const day = Number(day_of_month);
    const normalizedCategory = String(category || 'OTHER').toUpperCase();
    const allowedFrequencies = new Set(['monthly', 'weekly', 'quarterly', 'yearly']);
    if (!String(title || '').trim()) return res.status(400).json({ error: 'title is required' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
      return res.status(400).json({ error: 'amount_egp must be a finite positive amount' });
    }
    if (!allowedFrequencies.has(String(frequency))) return res.status(400).json({ error: 'Invalid frequency' });
    if (!Number.isInteger(day) || day < 1 || day > 28) return res.status(400).json({ error: 'day_of_month must be between 1 and 28' });
    if (!EXPENSE_CATEGORIES.has(normalizedCategory)) return res.status(400).json({ error: 'Invalid expense category' });
    const id = require('crypto').randomUUID();
    const actor = req.user?.email || req.staffRecord?.name || 'system';
    const newData = {
      title: String(title).trim().slice(0, 255),
      amount_egp: amount,
      category: normalizedCategory,
      notes: String(notes || '').slice(0, 2000) || null,
      frequency: String(frequency),
      day_of_month: day,
      branch: scope.branch,
      branch_id: scope.branchId,
    };
    await conn.beginTransaction();
    tx = true;
    await conn.query(
      `INSERT INTO recurring_expenses
         (id,tenant_id,title,amount_egp,category,notes,frequency,day_of_month,created_by,branch,branch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, newData.title, amount, normalizedCategory, newData.notes,
       frequency, day, actor, scope.branch, scope.branchId]
    );
    await logFinancialAudit({
      entityType: 'recurring_expense',
      entityId: id,
      action: 'create',
      newData,
      amount,
      actor,
      tenantId: req.tenantId,
      db: conn,
      strict: true,
    });
    await conn.commit();
    tx = false;
    res.json({ ok: true, id, branch: scope.branch, branch_id: scope.branchId });
  } catch (e) {
    if (tx) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  } finally { conn.release(); }
});
router.put  ('/api/admin/recurring-expenses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let tx = false;
  try {
    const { title, amount_egp, category, notes, frequency, day_of_month, is_active } = req.body;
    const scope = resolveFinancialScope(req, { requestedBranch: req.body.branch || null });
    const amount = amount_egp == null ? null : Number(amount_egp);
    const day = day_of_month == null ? null : Number(day_of_month);
    const normalizedCategory = category == null ? null : String(category).toUpperCase();
    if (title != null && !String(title).trim()) return res.status(400).json({ error: 'title cannot be empty' });
    if (amount != null && (!Number.isFinite(amount) || amount <= 0 || amount > 10000000)) {
      return res.status(400).json({ error: 'amount_egp must be a finite positive amount' });
    }
    if (frequency != null && !['monthly', 'weekly', 'quarterly', 'yearly'].includes(String(frequency))) {
      return res.status(400).json({ error: 'Invalid frequency' });
    }
    if (day != null && (!Number.isInteger(day) || day < 1 || day > 28)) {
      return res.status(400).json({ error: 'day_of_month must be between 1 and 28' });
    }
    if (is_active != null && ![true, false, 0, 1].includes(is_active)) {
      return res.status(400).json({ error: 'is_active must be boolean' });
    }
    if (normalizedCategory != null && !EXPENSE_CATEGORIES.has(normalizedCategory)) {
      return res.status(400).json({ error: 'Invalid expense category' });
    }
    const branchSql = scope.branchId ? ' AND branch_id=?' : '';
    await conn.beginTransaction();
    tx = true;
    const [[oldRow]] = await conn.query(
      `SELECT id,title,amount_egp,category,notes,frequency,day_of_month,is_active,branch,branch_id
         FROM recurring_expenses
        WHERE id=? AND tenant_id=? AND deleted_at IS NULL${branchSql}
        FOR UPDATE`,
      scope.branchId ? [req.params.id, req.tenantId, scope.branchId] : [req.params.id, req.tenantId]
    );
    if (!oldRow) {
      await conn.rollback();
      tx = false;
      return res.status(404).json({ error: 'Recurring expense not found' });
    }
    const params = [
      title == null ? null : String(title).trim().slice(0, 255),
      amount,
      normalizedCategory,
      notes == null ? null : String(notes).slice(0, 2000),
      frequency ?? null,
      day,
      is_active == null ? null : Number(Boolean(is_active)),
      req.params.id,
      req.tenantId,
    ];
    if (scope.branchId) params.push(scope.branchId);
    await conn.query(
      `UPDATE recurring_expenses
       SET title=COALESCE(?,title), amount_egp=COALESCE(?,amount_egp),
           category=COALESCE(?,category), notes=COALESCE(?,notes),
           frequency=COALESCE(?,frequency), day_of_month=COALESCE(?,day_of_month),
           is_active=COALESCE(?,is_active)
       WHERE id=? AND tenant_id=? AND deleted_at IS NULL${branchSql}`,
      params
    );
    const [[newRow]] = await conn.query(
      `SELECT id,title,amount_egp,category,notes,frequency,day_of_month,is_active,branch,branch_id
         FROM recurring_expenses WHERE id=? AND tenant_id=?`,
      [req.params.id, req.tenantId]
    );
    await logFinancialAudit({
      entityType: 'recurring_expense',
      entityId: req.params.id,
      action: 'update',
      oldData: oldRow,
      newData: newRow,
      amount: Number(newRow.amount_egp),
      actor: req.user?.email || req.staffRecord?.name || 'system',
      tenantId: req.tenantId,
      db: conn,
      strict: true,
    });
    await conn.commit();
    tx = false;
    res.json({ ok: true });
  } catch (e) {
    if (tx) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  } finally { conn.release(); }
});
router.delete('/api/admin/recurring-expenses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let tx = false;
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND branch_id=?' : '';
    const scopedParams = scope.branchId ? [req.params.id, req.tenantId, scope.branchId] : [req.params.id, req.tenantId];
    await conn.beginTransaction();
    tx = true;
    const [[oldRow]] = await conn.query(
      `SELECT id,title,amount_egp,category,notes,frequency,day_of_month,is_active,branch,branch_id
         FROM recurring_expenses
        WHERE id=? AND tenant_id=? AND deleted_at IS NULL${branchSql}
        FOR UPDATE`,
      scopedParams
    );
    if (!oldRow) {
      await conn.rollback();
      tx = false;
      return res.status(404).json({ error: 'Recurring expense not found' });
    }
    await conn.query(
      `UPDATE recurring_expenses
       SET deleted_at=NOW(), is_active=0
       WHERE id=? AND tenant_id=? AND deleted_at IS NULL${branchSql}`,
      scopedParams
    );
    await logFinancialAudit({
      entityType: 'recurring_expense',
      entityId: req.params.id,
      action: 'delete',
      oldData: oldRow,
      amount: Number(oldRow.amount_egp),
      actor: req.user?.email || req.staffRecord?.name || 'system',
      tenantId: req.tenantId,
      db: conn,
      strict: true,
    });
    await conn.commit();
    tx = false;
    res.json({ ok: true });
  }
  catch (e) {
    if (tx) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  } finally { conn.release(); }
});
// Cron: auto-create expenses from recurring templates daily at 8 AM Cairo.
// Only frequency='monthly' auto-fires — day_of_month + "not already run this
// month" is the right trigger shape for a monthly cadence, but applying the
// same check to weekly/quarterly/yearly items (CFG-03) would have posted a
// real expense every month regardless of their actual cadence. Those
// frequencies remain informational/manual until multi-cadence scheduling
// is built.
setInterval(async () => {
  const now = zonedDateTimeParts();
  if (now.hour !== 8 || now.minute > 4) return;
  const today = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
  const dom = now.day;
  const monthStart = `${now.year}-${String(now.month).padStart(2, '0')}-01`;
  try {
    const [recs] = await pool.query(
      `SELECT id, tenant_id, title, amount_egp, category, notes, frequency, day_of_month,
              is_active, last_run, branch, branch_id, created_at, created_by
       FROM recurring_expenses
       WHERE deleted_at IS NULL AND is_active=1 AND frequency='monthly'
         AND day_of_month=? AND (last_run IS NULL OR last_run < ?)`,
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
          `SELECT id, tenant_id, title, amount_egp, category, frequency, last_run, branch, branch_id
           FROM recurring_expenses
           WHERE id=? AND tenant_id=? AND deleted_at IS NULL AND is_active=1
             AND frequency='monthly' AND (last_run IS NULL OR last_run < ?)
           FOR UPDATE`,
          [candidate.id, candidate.tenant_id, monthStart]
        );
        if (!rec) { await conn.rollback(); tx = false; continue; }
        await assertWritable(today, conn, rec.tenant_id);
        const expenseId = require('crypto').randomUUID();
        const expenseCategory = EXPENSE_CATEGORIES.has(String(rec.category || '').toUpperCase())
          ? String(rec.category).toUpperCase()
          : 'OTHER';
        const description = `[تلقائي] ${rec.title}${rec.category ? ' — ' + rec.category : ''}`;
        await conn.query(
          `INSERT INTO expenses
             (id,description,amount,currency,category,\`date\`,note,tenant_id,branch_id)
           VALUES (?,?,?,'EGP',?,?,?,?,?)`,
          [expenseId, description, rec.amount_egp, expenseCategory, today,
           `مصروف متكرر - ${rec.frequency}`, rec.tenant_id, rec.branch_id]
        );
        const journalId = await postExpenseJournal(
          {
            id: expenseId,
            tenant_id: rec.tenant_id,
            branch_id: rec.branch_id,
            description,
            amount: rec.amount_egp,
            currency: 'EGP',
            category: expenseCategory,
            date: today,
          },
          +1, 'recurring-expense-cron', conn, rec.tenant_id
        );
        if (!journalId) throw new Error('Recurring expense journal posting failed');
        await logFinancialAudit({
          entityType: 'expense',
          entityId: expenseId,
          action: 'recurring_create',
          newData: { recurring_expense_id: rec.id, journal_id: journalId, date: today },
          amount: Number(rec.amount_egp),
          actor: 'recurring-expense-cron',
          tenantId: rec.tenant_id,
          db: conn,
          strict: true,
        });
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
    const today = dateOnlyInTimeZone();
    const from = req.query.from || `${today.slice(0, 4)}-01-01`;
    const to   = req.query.to   || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const expenseScopeSql = scope.branchId ? ' AND branch_id=?' : '';
    const journalScopeSql = scope.branchId ? ' AND je.branch_id=?' : '';
    const [[exp]] = await pool.query(
      `SELECT COALESCE(SUM(vat_amount),0) AS total_vat_paid, COALESCE(SUM(amount_egp),0) AS total_expenses
       FROM expenses
       WHERE tenant_id=? AND deleted_at IS NULL AND DATE(\`date\`) BETWEEN ? AND ?${expenseScopeSql}`,
      scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]
    );
    const [[rev]] = await pool.query(`
      SELECT COALESCE(SUM(jel.credit-jel.debit),0) AS revenue
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id AND jel.account_code LIKE '4%'
      WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ?${journalScopeSql}`,
    scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);
    const configuredVatRate = Number(await getTenantSetting('vat_pct', { tenantId: req.tenantId, fallback: 0 })) || 0;
    const grossRevenue = Number(rev.revenue) || 0;
    const estimatedOutputVat = configuredVatRate > 0
      ? grossRevenue - (grossRevenue / (1 + configuredVatRate / 100))
      : 0;
    res.json({
      from, to, branch: scope.branch, branchId: scope.branchId,
      total_vat_paid: Number(exp.total_vat_paid),
      total_expenses: Number(exp.total_expenses),
      estimated_output_vat: Number(estimatedOutputVat.toFixed(2)),
      vat_rate_standard: configuredVatRate,
      estimate_basis: 'gross_ledger_revenue',
    });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
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
router.get('/api/admin/export/expenses', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), bulkOperationLimiter, async (req, res) => {
  try {
    const { from, to } = req.query;
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    // Real expenses columns are description/note (not title/notes), and there is
    // no `recurrence` column on this table — selecting those threw
    // "Unknown column" and broke the whole CSV export.
    let sql = `SELECT id, description, amount, currency, category, date, note FROM expenses WHERE tenant_id = ? AND deleted_at IS NULL AND 1=1`;
    const params = [req.tenantId];
    if (scope.branchId) { sql += ' AND branch_id=?'; params.push(scope.branchId); }
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
  } catch (e) {
    logger.error('[export/expenses]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Balance Sheet ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/financial/balance-sheet?asOf=YYYY-MM-DD
router.get('/api/admin/financial/balance-sheet', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const asOf = req.query.asOf || dateOnlyInTimeZone();
    if (!validDateRange('1900-01-01', asOf)) return res.status(400).json({ error: 'Invalid asOf date' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const journalScopeSql = scope.branchId ? ' AND je.branch_id=?' : '';

    const [[ledger]] = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN jel.account_code LIKE '1%' THEN jel.debit-jel.credit ELSE 0 END),0) AS assets,
        COALESCE(SUM(CASE WHEN jel.account_code LIKE '2%' THEN jel.credit-jel.debit ELSE 0 END),0) AS liabilities,
        COALESCE(SUM(CASE WHEN jel.account_code LIKE '3%' THEN jel.credit-jel.debit ELSE 0 END),0) AS contributed_equity,
        COALESCE(SUM(CASE WHEN jel.account_code LIKE '4%' THEN jel.credit-jel.debit ELSE 0 END),0) AS revenue,
        COALESCE(SUM(CASE WHEN jel.account_code LIKE '5%' THEN jel.debit-jel.credit ELSE 0 END),0) AS expenses,
        COALESCE(SUM(CASE WHEN jel.account_code='1100' THEN jel.debit-jel.credit ELSE 0 END),0) AS cash
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id
      WHERE je.tenant_id=? AND je.entry_date <= ?${journalScopeSql}`,
    scope.branchId ? [req.tenantId, asOf, scope.branchId] : [req.tenantId, asOf]);
    const [[refundRow]] = await pool.query(`
      SELECT COALESCE(SUM(jel.credit-jel.debit),0) AS refunds
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id AND jel.account_code='1100'
      WHERE je.tenant_id=? AND je.ref_type='refund' AND je.entry_date <= ?${journalScopeSql}`,
    scope.branchId ? [req.tenantId, asOf, scope.branchId] : [req.tenantId, asOf]);

    const totalAssets = Number(ledger.assets) || 0;
    const totalLiabilities = Number(ledger.liabilities) || 0;
    const totalRevenue = Number(ledger.revenue) || 0;
    const totalExpenses = Number(ledger.expenses) || 0;
    const retainedEarnings = totalRevenue - totalExpenses;
    const totalEquity = (Number(ledger.contributed_equity) || 0) + retainedEarnings;
    const imbalance = totalAssets - totalLiabilities - totalEquity;

    res.json({
      asOf, branch: scope.branch, branchId: scope.branchId,
      assets: {
        cashAndEquivalents: Number(ledger.cash) || 0,
        totalRevenue,
        totalAssets,
      },
      liabilities: {
        outstandingReceivables: 0,
        totalLiabilities,
      },
      equity: {
        retainedEarnings,
        contributedEquity: Number(ledger.contributed_equity) || 0,
        totalEquity,
      },
      summary: {
        totalRevenue,
        totalExpenses,
        totalRefunds: Number(refundRow.refunds) || 0,
        netPosition: totalAssets - totalLiabilities,
        ledgerImbalance: imbalance,
      }
    });
  } catch (e) {
    logger.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Cash Flow Statement ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/financial/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/api/admin/financial/cash-flow', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const today = dateOnlyInTimeZone();
    const from = req.query.from || `${today.slice(0, 7)}-01`;
    const to   = req.query.to   || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const journalScopeSql = scope.branchId ? ' AND je.branch_id=?' : '';

    const [[totals]] = await pool.query(`
      SELECT
        COALESCE(SUM(jel.debit),0) AS inflows,
        COALESCE(SUM(CASE WHEN je.ref_type <> 'refund' THEN jel.credit ELSE 0 END),0) AS outflows,
        COALESCE(SUM(CASE WHEN je.ref_type = 'refund' THEN jel.credit ELSE 0 END),0) AS refunds
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id AND jel.account_code='1100'
      WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ?${journalScopeSql}`,
    scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(je.entry_date, '%Y-%m') AS month,
        COALESCE(SUM(jel.debit),0) AS revenue,
        COALESCE(SUM(CASE WHEN je.ref_type='refund' THEN jel.credit ELSE 0 END),0) AS refunds,
        COALESCE(SUM(CASE WHEN je.ref_type<>'refund' THEN jel.credit ELSE 0 END),0) AS expenses
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id AND jel.account_code='1100'
      WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ?${journalScopeSql}
      GROUP BY DATE_FORMAT(je.entry_date, '%Y-%m')
      ORDER BY month`,
    scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    const cashFlowMonthly = monthly.map(r => ({
      month: r.month,
      revenue: Number(r.revenue) || 0,
      refunds: Number(r.refunds) || 0,
      expenses: Number(r.expenses) || 0,
      netCashFlow: (Number(r.revenue) || 0) - (Number(r.refunds) || 0) - (Number(r.expenses) || 0),
    }));

    res.json({
      period: { from, to }, branch: scope.branch, branchId: scope.branchId,
      operating: {
        inflows: Number(totals.inflows) || 0,
        outflows: Number(totals.outflows) || 0,
        refunds: Number(totals.refunds) || 0,
        netOperatingCashFlow: (Number(totals.inflows) || 0) - (Number(totals.outflows) || 0) - (Number(totals.refunds) || 0),
      },
      monthly: cashFlowMonthly,
    });
  } catch (e) {
    logger.error(e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

module.exports = router;
