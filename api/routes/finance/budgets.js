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
const { requireAnyPermission } = require('../../middleware/auth');
const { loadExpenseCategories, expenseCategoryLabel } = require('../../lib/expenseCategories');
const { canonicalChannel } = require('../../lib/paymentChannels');
const { hasPermission } = require('../../constants/permissions');
const { GENERAL, configuredBoxes, currencyOfName, currentBalances, mergeBoxes, recentEvents, resetAll, resetBox, setBoxBalance, setTotalBalance, totalOf } = require('../../lib/boxBalances');
const { PARTNERS, listWithdrawals, voidWithdrawal, withdraw } = require('../../lib/boxWithdrawals');
const { applyAlias, loadBoxAliases } = require('../../lib/boxAliases');

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
    const yesterday = addDaysToDateOnly(today, -1);
    const [rows] = await pool.query(
      `SELECT COALESCE(NULLIF(REGEXP_REPLACE(TRIM(p.payment_method), ' {2,}', ' '), ''), 'غير محدد') AS method, p.currency,
              ${BOX_WINDOWS.map(days => `SUM(CASE WHEN p.date >= ? THEN p.amount ELSE 0 END) AS total_${days},
              SUM(CASE WHEN p.date >= ? AND p.amount > 0 THEN 1 ELSE 0 END) AS count_${days}`).join(',\n              ')},
              SUM(CASE WHEN p.date = ? THEN p.amount ELSE 0 END) AS total_y,
              SUM(CASE WHEN p.date = ? AND p.amount > 0 THEN 1 ELSE 0 END) AS count_y
         FROM payments p
         LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND (p.status = 'paid' OR p.status IS NULL)
          AND p.date >= ? AND p.date <= ?${scope.branchId ? ' AND p.branch_id = ? AND (s.id IS NULL OR s.branch_id = p.branch_id)' : ''}
        GROUP BY method, p.currency
        ORDER BY total_30 DESC`,
      [...BOX_WINDOWS.flatMap(days => [since(days), since(days)]), yesterday, yesterday, req.tenantId, since(30), today,
        ...(scope.branchId ? [scope.branchId] : [])]);
    // One box per channel: «فودافون كاش 7722» typed two ways is one box (lib/paymentChannels.js); two numbers the desk says are one box are read
    // as one through the aliases (lib/boxAliases.js).
    const aliases = await loadBoxAliases(pool, req.tenantId);
    const merged = new Map();
    const emptyBox = (method, currency) => ({
      method,
      currency,
      totals: Object.fromEntries(BOX_WINDOWS.map(days => [days, 0])),
      counts: Object.fromEntries(BOX_WINDOWS.map(days => [days, 0])),
      yesterday: { total: 0, count: 0 },
    });
    for (const row of rows) {
      const method = applyAlias(canonicalChannel(row.method), aliases);
      const currency = row.currency || 'EGP';
      const box = merged.get(`${method}|${currency}`) || emptyBox(method, currency);
      for (const days of BOX_WINDOWS) {
        box.totals[days] = Math.round((box.totals[days] + (Number(row[`total_${days}`]) || 0)) * 100) / 100;
        box.counts[days] += Number(row[`count_${days}`]) || 0;
      }
      box.yesterday.total = Math.round((box.yesterday.total + (Number(row.total_y) || 0)) * 100) / 100;
      box.yesterday.count += Number(row.count_y) || 0;
      merged.set(`${method}|${currency}`, box);
    }
    // The institute's boxes carry a balance; a branch sees only its own clients' money, which has none (lib/boxBalances.js).
    let balances = null;
    if (!scope.branchId) {
      const current = await currentBalances(pool, { tenantId: req.tenantId });
      const currencyOf = key => key.slice(key.lastIndexOf('|') + 1);
      // Every box there is, at zero or not: one that has balance history, and one the settings list names.
      for (const [key, value] of current) {
        if (key.startsWith(`${GENERAL}|`)) continue;
        if (!merged.has(key)) merged.set(key, emptyBox(key.slice(0, key.lastIndexOf('|')), currencyOf(key)));
        merged.get(key).balance = value.balance;
      }
      const shown = new Set([...merged.values()].map(box => box.method));
      for (const name of await configuredBoxes(pool, req.tenantId)) {
        if (shown.has(name)) continue;
        const currency = currencyOfName(name);
        merged.set(`${name}|${currency}`, { ...emptyBox(name, currency), balance: 0 });
      }
      const currencies = [...new Set([...merged.values()].map(box => box.currency).concat([...current.keys()].map(currencyOf)))];
      balances = {
        canManage: Boolean(req.isSuperAdmin || hasPermission(req.staffRecord, 'manage_financial')),
        partners: PARTNERS.map(({ key, name }) => ({ key, name })),
        totals: Object.fromEntries(currencies.map(currency => [currency, totalOf(current, currency)])),
        general: Object.fromEntries(currencies.map(currency => [currency, current.get(`${GENERAL}|${currency}`)?.opening || 0])),
      };
    }
    res.json({
      branch: scope.branch || null,
      today,
      yesterday,
      windows: Object.fromEntries(BOX_WINDOWS.map(days => [days, since(days)])),
      boxes: [...merged.values()].sort((a, b) => b.totals[30] - a.totals[30]),
      balances,
    });
  } catch (e) {
    logger.error('[finance/boxes]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// «عند اضافه مصروف لازم يكون اختيار الخزنة اللى هصرف منها الفلوس»: the boxes an expense can be taken from — every box on the boxes screen, with its
// balance and currency. Asked by whoever records an expense (manage_financial), who may not hold view_financial's balances screen.
router.get('/api/admin/finance/box-options', requireAuth, requireAdminOrStaff, requireAnyPermission('view_financial', 'manage_financial'), async (req, res) => {
  try {
    const current = await currentBalances(pool, { tenantId: req.tenantId });
    const options = new Map();
    for (const [key, value] of current) {
      if (key.startsWith(`${GENERAL}|`)) continue;
      const cut = key.lastIndexOf('|');
      options.set(key, { method: key.slice(0, cut), currency: key.slice(cut + 1), balance: value.balance });
    }
    const named = new Set([...options.values()].map(option => option.method));
    for (const name of await configuredBoxes(pool, req.tenantId)) {
      if (!named.has(name)) options.set(`${name}|${currencyOfName(name)}`, { method: name, currency: currencyOfName(name), balance: 0 });
    }
    res.json([...options.values()].sort((a, b) => a.method.localeCompare(b.method, 'ar') || a.currency.localeCompare(b.currency)));
  } catch (e) {
    logger.error('[finance/box-options]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── The balances: reset a box, correct a box, correct the overall balance (lib/boxBalances.js) ─────────────────────────
// Only the institute's books — a branch's view has no balances — and only manage_financial. Each change is one transaction
// and one audit row, and says what the balance was and what it became.
const mainBooks = [requireAuth, requireAdminOrStaff, requirePermission('manage_financial')];
function boxChange(work, action) {
  return async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const scope = resolveFinancialScope(req, { requestedBranch: null });
      if (scope.branchId || scope.kind !== 'all') return res.status(403).json({ error: 'الخزائن بتتعدّل من الحسابات الرئيسية بس', code: 'BOXES_MAIN_BOOKS_ONLY' });
      await conn.beginTransaction();
      const actor = req.staffRecord?.name || req.user?.email || 'system';
      const result = await work(conn, { tenantId: req.tenantId, actor, body: req.body || {} });
      await logFinancialAudit({
        entityType: 'cash_box',
        entityId: String(req.body?.method || req.body?.currency || 'all'),
        action,
        oldData: { balance: result.before },
        newData: { balance: result.after, note: req.body?.note || null },
        amount: result.after - result.before,
        actor: req.user?.email || actor,
        tenantId: req.tenantId,
        db: conn,
        strict: true,
      });
      await conn.commit();
      res.json({ ok: true, ...result });
    } catch (e) {
      await conn.rollback().catch(() => {});
      const status = e.statusCode || e.status || 500;
      if (status >= 500) logger.error(`[finance/boxes ${action}]`, e.message);
      res.status(status).json({ error: status < 500 ? e.message : 'Internal server error', code: e.code });
    } finally { conn.release(); }
  };
}
router.post('/api/admin/finance/boxes/reset', ...mainBooks, boxChange((db, { tenantId, actor, body }) => resetBox(db, { tenantId, method: body.method, currency: body.currency, note: body.note, actor }), 'box_reset'));
router.post('/api/admin/finance/boxes/balance', ...mainBooks, boxChange((db, { tenantId, actor, body }) => setBoxBalance(db, { tenantId, method: body.method, currency: body.currency, amount: body.amount, note: body.note, actor }), 'box_set_balance'));
router.post('/api/admin/finance/boxes/total', ...mainBooks, boxChange((db, { tenantId, actor, body }) => setTotalBalance(db, { tenantId, currency: body.currency, amount: body.amount, note: body.note, actor }), 'box_set_total'));
router.post('/api/admin/finance/boxes/reset-all', ...mainBooks, boxChange((db, { tenantId, actor, body }) => resetAll(db, { tenantId, currency: body.currency, note: body.note, actor }), 'box_reset_all'));
// «سحب من الرصيد»: money out of a box, directed to an account (a partner's drawings, an expense, any account) or to another box.
router.post('/api/admin/finance/boxes/withdraw', ...mainBooks, boxChange((db, { tenantId, actor, body }) => withdraw(db, { tenantId, actor, today: dateOnlyInTimeZone(), input: body }), 'box_withdraw'));
router.post('/api/admin/finance/boxes/withdrawals/void', ...mainBooks, boxChange((db, { tenantId, actor, body }) => voidWithdrawal(db, { tenantId, id: String(body.id || ''), actor, today: dateOnlyInTimeZone() }), 'box_withdraw_void'));
// «دمج»: one box is another's. The balances are added, nothing else changes.
router.post('/api/admin/finance/boxes/merge', ...mainBooks, boxChange(async (db, { tenantId, actor, body }) => {
  const result = await mergeBoxes(db, { tenantId, from: body.from, into: body.into, note: body.note, actor });
  const total = result.balances.reduce((sum, entry) => sum + entry.balance, 0);
  return { ...result, before: total, after: total };
}, 'box_merge'));
router.get('/api/admin/finance/boxes/withdrawals', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: null });
    if (scope.branchId || scope.kind !== 'all') return res.json({ rows: [], partners: [] });
    const date = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null);
    res.json(await listWithdrawals(pool, {
      tenantId: req.tenantId, from: date(req.query.from), to: date(req.query.to), kind: req.query.kind || null, partner: req.query.partner || null,
    }));
  } catch (e) {
    logger.error('[finance/boxes withdrawals]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});
router.get('/api/admin/finance/boxes/history', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: null });
    if (scope.branchId || scope.kind !== 'all') return res.json([]);
    res.json(await recentEvents(pool, { tenantId: req.tenantId }));
  } catch (e) {
    logger.error('[finance/boxes history]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

module.exports = router;
