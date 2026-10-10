'use strict';
// Budgets and the cash boxes.
// One part of routes/finance.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  uuidv4,
  pool,
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  resolveFinancialScope,
  addDaysToDateOnly,
  dateOnlyInTimeZone,
  monthRange,
  logFinancialAudit,
  logger,
} = require('./_shared');
const { loadExpenseCategories, expenseCategoryLabel } = require('../../lib/expenseCategories');

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// ── BUDGET MANAGEMENT ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/finance/budgets', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const budgetBranchId = scope.branchId || 'branch-all';
    const month = req.query.month || dateOnlyInTimeZone().slice(0, 7);
    const range = monthRange(month);
    if (!range) return res.status(400).json({ error: 'Valid month is required' });
    const [rows] = await pool.query(
      `SELECT id, branch, branch_id, category, budgeted_amount AS limit_amount, month AS period_label, notes
       FROM budgets WHERE tenant_id=? AND branch_id=? AND month=? ORDER BY category`,
      [req.tenantId, budgetBranchId, month]
    );

    // Also get current month spending per category
    const monthStart = range.startDate;
    const monthEnd = range.endDate;
    const [spending] = await pool.query(
      `SELECT e.category,COALESCE(SUM(jel.debit-jel.credit),0) AS spent
         FROM expenses e
         JOIN journal_entries je ON je.tenant_id=e.tenant_id
          AND je.ref_type='expense' AND je.ref_id=e.id
         JOIN journal_entry_lines jel ON jel.entry_id=je.id AND jel.account_code LIKE '5%'
        WHERE e.tenant_id=? AND e.deleted_at IS NULL AND je.entry_date >= ? AND je.entry_date < ?
          ${scope.branchId ? 'AND je.branch_id=?' : ''}
        GROUP BY e.category`,
      scope.branchId
        ? [req.tenantId, monthStart, monthEnd, scope.branchId]
        : [req.tenantId, monthStart, monthEnd]
    );
    // expenses.category holds the English code; budgets.category holds whatever
    // the screen that created the budget wrote, and every one of them writes the
    // Arabic label. Keyed by the code alone, no budget row ever found its spend.
    const categories = await loadExpenseCategories(req.tenantId);
    const spendMap = {};
    for (const s of spending) {
      const spent = parseFloat(s.spent) || 0;
      spendMap[s.category] = spent;
      const label = expenseCategoryLabel(s.category, categories);
      if (label) spendMap[label] = (spendMap[label] || 0) + spent;
    }

    res.json(rows.map(r => ({
      id: r.id,
      category: r.category,
      limit: parseFloat(r.limit_amount) || 0,
      spent: spendMap[r.category] || 0,
      remaining: (parseFloat(r.limit_amount) || 0) - (spendMap[r.category] || 0),
      utilizationPct: parseFloat(r.limit_amount) > 0 ? Math.round(((spendMap[r.category] || 0) / parseFloat(r.limit_amount)) * 100) : 0,
      notes: r.notes || '',
    })));
  } catch (e) {
    logger.error('[finance/budgets GET]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

router.put('/api/admin/finance/budgets', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { month, budgets, branch } = req.body;
    const scope = resolveFinancialScope(req, { requestedBranch: branch || null });
    const budgetBranch = scope.branch || null;
    const budgetBranchId = scope.branchId || 'branch-all';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || '')) || !Array.isArray(budgets)) return res.status(400).json({ error: 'Valid month and budgets[] required' });
    const { uuidv4: uid } = require('../../lib/id');
    const normalized = [];
    const categories = new Set();
    for (const b of budgets) {
      const limitAmount = b.limit ?? b.limit_amount ?? b.budgeted_amount;
      const numericLimit = Number(limitAmount);
      const category = String(b.category || '').trim().slice(0, 255);
      const currency = String(b.currency || 'EGP').toUpperCase();
      if (!category || categories.has(category) || currency !== 'EGP'
        || !Number.isFinite(numericLimit) || numericLimit < 0 || numericLimit > 100000000) {
        return res.status(400).json({ error: 'Invalid budget row' });
      }
      categories.add(category);
      normalized.push({ ...b, category, numericLimit, currency });
    }
    await conn.beginTransaction();
    transactionStarted = true;
    const [oldRows] = await conn.query(
      `SELECT category,budgeted_amount,currency,notes FROM budgets
        WHERE tenant_id=? AND branch_id=? AND month=? FOR UPDATE`,
      [req.tenantId, budgetBranchId, month],
    );
    for (const b of normalized) {
      await conn.query(
        `INSERT INTO budgets (id, tenant_id, branch, branch_id, month, category, budgeted_amount, currency, notes)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE budgeted_amount=VALUES(budgeted_amount), currency=VALUES(currency), notes=VALUES(notes)`,
        [uid(), req.tenantId, budgetBranch, budgetBranchId, month, b.category, b.numericLimit, b.currency, b.notes || null]
      );
    }
    await logFinancialAudit({
      entityType: 'budget',
      entityId: `${budgetBranchId}:${month}`,
      action: 'upsert',
      oldData: oldRows,
      newData: normalized.map(({ category, numericLimit, currency, notes }) => ({
        category, budgeted_amount: numericLimit, currency, notes: notes || null,
      })),
      actor: req.user?.email || req.user?.uid || 'system',
      tenantId: req.tenantId,
      db: conn,
      strict: true,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) try { await conn.rollback(); } catch (_) {}
    logger.error('[finance/budgets PUT]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  } finally { conn.release(); }
});

// «محتاجين يظهر كل وسائل الدفع اللى تمت للدقي وكل وسيله دفع خزنتها كام من
// الدقي بتقرير يومي واسبوعي وكل 15 وكل 30 يوم». Every box money came into, and
// what it took over today and the last 7, 15 and 30 days. A refund is a
// negative row in the box it left from, so it is netted here as everywhere.
// «فودافون كاش  7722» and «فودافون كاش 7722» are one box typed twice.
//
// A branch's money is its own clients' money: the payment filed under the
// branch and the client in it. 13 payments filed under Dokki belong to online
// clients, and were what the Dokki manager saw as «فلوس مدفوعه في الاونلاين».
const BOX_WINDOWS = [1, 7, 15, 30];
router.get('/api/admin/finance/boxes', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const today = dateOnlyInTimeZone();
    const since = days => addDaysToDateOnly(today, 1 - days);
    const [rows] = await pool.query(
      `SELECT COALESCE(NULLIF(REGEXP_REPLACE(TRIM(p.payment_method), ' {2,}', ' '), ''), 'غير محدد') AS method, p.currency,
              ${BOX_WINDOWS.map(days => `SUM(CASE WHEN p.date >= ? THEN p.amount ELSE 0 END) AS total_${days},
              SUM(CASE WHEN p.date >= ? AND p.amount > 0 THEN 1 ELSE 0 END) AS count_${days}`).join(',\n              ')}
         FROM payments p
         LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND (p.status = 'paid' OR p.status IS NULL)
          AND p.date >= ? AND p.date <= ?${scope.branchId ? ' AND p.branch_id = ? AND (s.id IS NULL OR s.branch_id = p.branch_id)' : ''}
        GROUP BY method, p.currency
        ORDER BY total_30 DESC`,
      [...BOX_WINDOWS.flatMap(days => [since(days), since(days)]), req.tenantId, since(30), today,
        ...(scope.branchId ? [scope.branchId] : [])]);
    res.json({
      branch: scope.branch || null,
      today,
      windows: Object.fromEntries(BOX_WINDOWS.map(days => [days, since(days)])),
      boxes: rows.map(row => ({
        method: row.method,
        currency: row.currency || 'EGP',
        totals: Object.fromEntries(BOX_WINDOWS.map(days => [days, Number(row[`total_${days}`]) || 0])),
        counts: Object.fromEntries(BOX_WINDOWS.map(days => [days, Number(row[`count_${days}`]) || 0])),
      })),
    });
  } catch (e) {
    logger.error('[finance/boxes]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

module.exports = router;
