'use strict';
// Monthly comparison and the accounting reports: P&L, trial balance, journal.
// One part of routes/finance.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  pool,
  getBrandSettings,
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  resolveFinancialScope,
  addDaysToDateOnly,
  dateOnlyInTimeZone,
  monthRange,
  escapeHtml,
  logger,
  validDateRange,
} = require('./_shared');

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Monthly Financial Comparison ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/financial/monthly-comparison — current vs previous month
router.get('/api/admin/financial/monthly-comparison', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const scopedParams = (...values) => scope.branchId ? [...values, scope.branchId] : values;
    const journalBranchSql = scope.branchId ? ' AND je.branch_id=?' : '';
    const paymentBranchSql = scope.branchId ? ' AND p.branch_id=?' : '';
    const leadBranchSql = scope.branchId ? ' AND l.branch_id=?' : '';
    const subscriberBranchSql = scope.branchId ? ' AND s.branch_id=?' : '';
    const today = dateOnlyInTimeZone();
    const current = monthRange(today);
    const previous = monthRange(addDaysToDateOnly(current.startDate, -1));
    const [ledgerResult, paymentResult, leadResult, subscriberResult] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN je.entry_date>=? AND jel.account_code LIKE '4%' THEN jel.credit-jel.debit ELSE 0 END),0) AS current_revenue,
          COALESCE(SUM(CASE WHEN je.entry_date<? AND jel.account_code LIKE '4%' THEN jel.credit-jel.debit ELSE 0 END),0) AS previous_revenue,
          COALESCE(SUM(CASE WHEN je.entry_date>=? AND jel.account_code LIKE '5%' THEN jel.debit-jel.credit ELSE 0 END),0) AS current_expenses,
          COALESCE(SUM(CASE WHEN je.entry_date<? AND jel.account_code LIKE '5%' THEN jel.debit-jel.credit ELSE 0 END),0) AS previous_expenses
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.entry_id=je.id
        WHERE je.tenant_id=? AND je.entry_date>=? AND je.entry_date<?${journalBranchSql}`,
      scopedParams(current.startDate, current.startDate, current.startDate, current.startDate,
        req.tenantId, previous.startDate, current.endDate)),
      pool.query(`
        SELECT
          COUNT(CASE WHEN p.date>=? AND p.status='paid' THEN 1 END) AS current_payment_count,
          COUNT(DISTINCT CASE WHEN p.date>=? AND p.status='paid' THEN p.subscriber_id END) AS current_active_clients,
          COUNT(CASE WHEN p.date<? AND p.status='paid' THEN 1 END) AS previous_payment_count,
          COUNT(DISTINCT CASE WHEN p.date<? AND p.status='paid' THEN p.subscriber_id END) AS previous_active_clients
        FROM payments p
        WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.date>=? AND p.date<?${paymentBranchSql}`,
      scopedParams(current.startDate, current.startDate, current.startDate, current.startDate,
        req.tenantId, previous.startDate, current.endDate)),
      pool.query(`
        SELECT
          COUNT(CASE WHEN l.created_at>=? THEN 1 END) AS current_count,
          COUNT(CASE WHEN l.created_at<? THEN 1 END) AS previous_count
        FROM leads l
        WHERE l.tenant_id=? AND l.created_at>=? AND l.created_at<?${leadBranchSql}`,
      scopedParams(current.startDate, current.startDate, req.tenantId, previous.startDate, current.endDate)),
      pool.query(`
        SELECT
          COUNT(CASE WHEN s.created_at>=? THEN 1 END) AS current_count,
          COUNT(CASE WHEN s.created_at<? THEN 1 END) AS previous_count
        FROM subscribers s
        WHERE s.tenant_id=? AND s.deleted_at IS NULL AND s.created_at>=? AND s.created_at<?${subscriberBranchSql}`,
      scopedParams(current.startDate, current.startDate, req.tenantId, previous.startDate, current.endDate)),
    ]);
    const ledger = ledgerResult[0][0];
    const payments = paymentResult[0][0];
    const leads = leadResult[0][0];
    const subscribers = subscriberResult[0][0];

    const diff = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : (a > 0 ? 100 : 0);
    const curRev = Number(ledger.current_revenue) || 0;
    const prevRev = Number(ledger.previous_revenue) || 0;
    const curExpAmt = Number(ledger.current_expenses) || 0;
    const prevExpAmt = Number(ledger.previous_expenses) || 0;
    const curPaymentCount = Number(payments.current_payment_count) || 0;
    const prevPaymentCount = Number(payments.previous_payment_count) || 0;
    const curActiveClients = Number(payments.current_active_clients) || 0;
    const prevActiveClients = Number(payments.previous_active_clients) || 0;
    const newLeads = Number(leads.current_count) || 0;
    const prevLeads = Number(leads.previous_count) || 0;
    const newSubs = Number(subscribers.current_count) || 0;
    const prevSubs = Number(subscribers.previous_count) || 0;

    res.json({
      current: {
        revenue: curRev,
        expenses: curExpAmt,
        net: curRev - curExpAmt,
        payment_count: curPaymentCount,
        active_clients: curActiveClients,
        new_leads: newLeads,
        new_subscribers: newSubs,
      },
      previous: {
        revenue: prevRev,
        expenses: prevExpAmt,
        net: prevRev - prevExpAmt,
        payment_count: prevPaymentCount,
        active_clients: prevActiveClients,
        new_leads: prevLeads,
        new_subscribers: prevSubs,
      },
      changes: {
        revenue: diff(curRev, prevRev),
        expenses: diff(curExpAmt, prevExpAmt),
        net: diff(curRev - curExpAmt, prevRev - prevExpAmt),
        payment_count: diff(curPaymentCount, prevPaymentCount),
        new_leads: diff(newLeads, prevLeads),
        new_subscribers: diff(newSubs, prevSubs),
      },
      branch: scope.branch,
      branchId: scope.branchId,
    });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Accounting Reports (P&L, Balance Sheet, Trial Balance) ───────
// ═══════════════════════════════════════════════════════════════════════════

/*
  Chart of accounts reference (from v22):
    1xxx = Assets     (Debit-normal)   e.g. 1100 Cash/Bank
    2xxx = Liabilities(Credit-normal)  e.g. 2100 Accrued Salaries
    3xxx = Equity     (Credit-normal)
    4xxx = Revenue    (Credit-normal)  e.g. 4100 Courses, 4200 Consult, 4300 Cert, 4900 Other
    5xxx = Expenses   (Debit-normal)   e.g. 5100 Staff Salaries
*/

// GET /api/admin/reports/pl?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns Profit & Loss: Revenue (4xxx) - Expenses (5xxx) grouped by account, monthly breakdown
router.get('/api/admin/reports/pl', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const today = dateOnlyInTimeZone();
    const from = req.query.from || `${today.slice(0, 4)}-01-01`;
    const to   = req.query.to   || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND je.branch_id=?' : '';

    // Revenue lines (credit-normal): credit - debit = net credit
    const [revRows] = await pool.query(`
      SELECT
        jel.account_code,
        jel.account_name,
        DATE_FORMAT(je.entry_date, '%Y-%m') AS month,
        SUM(jel.credit) - SUM(jel.debit) AS net_amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.tenant_id=? AND jel.account_code LIKE '4%'
        AND je.entry_date BETWEEN ? AND ?${branchSql}
      GROUP BY jel.account_code, jel.account_name, month
      ORDER BY jel.account_code, month
    `, scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    // Expense lines (debit-normal): debit - credit = net debit
    const [expRows] = await pool.query(`
      SELECT
        jel.account_code,
        jel.account_name,
        DATE_FORMAT(je.entry_date, '%Y-%m') AS month,
        SUM(jel.debit) - SUM(jel.credit) AS net_amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.tenant_id=? AND jel.account_code LIKE '5%'
        AND je.entry_date BETWEEN ? AND ?${branchSql}
      GROUP BY jel.account_code, jel.account_name, month
      ORDER BY jel.account_code, month
    `, scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    // Totals
    const totalRevenue  = revRows.reduce((s, r) => s + parseFloat(r.net_amount || 0), 0);
    const totalExpenses = expRows.reduce((s, r) => s + parseFloat(r.net_amount || 0), 0);
    const netIncome     = totalRevenue - totalExpenses;

    // Group revenue by account
    const revenueByAccount = {};
    for (const r of revRows) {
      const key = r.account_code;
      if (!revenueByAccount[key]) revenueByAccount[key] = { account_code: key, account_name: r.account_name, total: 0, monthly: {} };
      revenueByAccount[key].total += parseFloat(r.net_amount || 0);
      revenueByAccount[key].monthly[r.month] = parseFloat(r.net_amount || 0);
    }

    // Group expenses by account
    const expensesByAccount = {};
    for (const r of expRows) {
      const key = r.account_code;
      if (!expensesByAccount[key]) expensesByAccount[key] = { account_code: key, account_name: r.account_name, total: 0, monthly: {} };
      expensesByAccount[key].total += parseFloat(r.net_amount || 0);
      expensesByAccount[key].monthly[r.month] = parseFloat(r.net_amount || 0);
    }

    // Distinct months
    const monthSet = new Set([...revRows, ...expRows].map(r => r.month));
    const months = [...monthSet].sort();

    res.json({
      period: { from, to }, branch: scope.branch, branchId: scope.branchId,
      months,
      revenue:  { accounts: Object.values(revenueByAccount),  total: totalRevenue  },
      expenses: { accounts: Object.values(expensesByAccount), total: totalExpenses },
      net_income: netIncome
    });
  } catch (e) {
    logger.error('[reports/pl]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// GET /api/admin/reports/trial-balance?from=&to=
// Returns all accounts with running debit/credit totals
router.get('/api/admin/reports/trial-balance', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const today = dateOnlyInTimeZone();
    const from = req.query.from || `${today.slice(0, 4)}-01-01`;
    const to   = req.query.to   || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND je.branch_id=?' : '';

    const [rows] = await pool.query(`
      SELECT
        jel.account_code,
        jel.account_name,
        SUM(jel.debit)  AS total_debit,
        SUM(jel.credit) AS total_credit,
        SUM(jel.debit) - SUM(jel.credit) AS balance
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ?${branchSql}
      GROUP BY jel.account_code, jel.account_name
      ORDER BY jel.account_code
    `, scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    const totalDebit  = rows.reduce((s, r) => s + parseFloat(r.total_debit  || 0), 0);
    const totalCredit = rows.reduce((s, r) => s + parseFloat(r.total_credit || 0), 0);

    const accounts = rows.map(r => ({
      account_code:  r.account_code,
      account_name:  r.account_name,
      total_debit:   parseFloat(r.total_debit  || 0),
      total_credit:  parseFloat(r.total_credit || 0),
      balance:       parseFloat(r.balance       || 0),
      type: r.account_code.startsWith('1') ? 'asset'
          : r.account_code.startsWith('2') ? 'liability'
          : r.account_code.startsWith('3') ? 'equity'
          : r.account_code.startsWith('4') ? 'revenue'
          : r.account_code.startsWith('5') ? 'expense'
          : 'other'
    }));

    res.json({
      period: { from, to },
      branch: scope.branch,
      branchId: scope.branchId,
      accounts,
      totals: { debit: totalDebit, credit: totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 }
    });
  } catch (e) {
    logger.error('[reports/trial-balance]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// GET /api/admin/reports/journal?from=&to=&account_code=&ref_type=&page=&limit=
// Paginated journal entry ledger
router.get('/api/admin/reports/journal', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const today = dateOnlyInTimeZone();
    const from    = req.query.from    || `${today.slice(0, 4)}-01-01`;
    const to      = req.query.to      || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const acct    = req.query.account_code || null;
    const refType = req.query.ref_type    || null;
    const page    = Math.max(1, parseInt(req.query.page)  || 1);
    const limit   = Math.min(200, parseInt(req.query.limit) || 50);
    const offset  = (page - 1) * limit;
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });

    let filters = '';
    const params = [req.tenantId, from, to];
    if (scope.branchId) { filters += ' AND je.branch_id = ?'; params.push(scope.branchId); }
    if (refType) { filters += ' AND je.ref_type = ?'; params.push(refType); }

    let entryFilter = '';
    if (acct) {
      entryFilter = `AND je.id IN (SELECT DISTINCT entry_id FROM journal_entry_lines WHERE account_code = ?)`;
      params.push(acct);
    }

    const countParams = [...params];
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM journal_entries je
       WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ? ${filters} ${entryFilter}`,
      countParams
    );

    const [entries] = await pool.query(`
      SELECT je.id, je.ref_type, je.ref_id, je.entry_date, je.description,
             je.total_debit, je.total_credit, je.posted_by, je.branch, je.branch_id, je.created_at
       FROM journal_entries je
       WHERE je.tenant_id=? AND je.entry_date BETWEEN ? AND ? ${filters} ${entryFilter}
      ORDER BY je.entry_date DESC, je.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    if (!entries.length) return res.json({
      period: { from, to },
      branch: scope.branch,
      branchId: scope.branchId,
      entries: [],
      lines: {},
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });

    const entryIds = entries.map(e => e.id);
    const [lines] = await pool.query(
      `SELECT id, entry_id, account_code, account_name, debit, credit
       FROM journal_entry_lines WHERE entry_id IN (${entryIds.map(() => '?').join(',')}) ORDER BY entry_id, account_code`,
      entryIds
    );

    const linesByEntry = {};
    for (const l of lines) {
      if (!linesByEntry[l.entry_id]) linesByEntry[l.entry_id] = [];
      linesByEntry[l.entry_id].push(l);
    }

    res.json({
      period: { from, to },
      branch: scope.branch,
      branchId: scope.branchId,
      entries,
      lines: linesByEntry,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });
  } catch (e) {
    logger.error('[reports/journal]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

// GET /api/admin/reports/pl/html?from=&to= — printable P&L HTML report
router.get('/api/admin/reports/pl/html', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const today = dateOnlyInTimeZone();
    const from = req.query.from || `${today.slice(0, 4)}-01-01`;
    const to   = req.query.to   || today;
    if (!validDateRange(from, to)) return res.status(400).json({ error: 'Invalid date range' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND je.branch_id=?' : '';

    const [revRows] = await pool.query(`
      SELECT jel.account_code, jel.account_name, SUM(jel.credit) - SUM(jel.debit) AS net_amount
      FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.tenant_id=? AND jel.account_code LIKE '4%' AND je.entry_date BETWEEN ? AND ?${branchSql}
      GROUP BY jel.account_code, jel.account_name ORDER BY jel.account_code
    `, scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    const [expRows] = await pool.query(`
      SELECT jel.account_code, jel.account_name, SUM(jel.debit) - SUM(jel.credit) AS net_amount
      FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
      WHERE je.tenant_id=? AND jel.account_code LIKE '5%' AND je.entry_date BETWEEN ? AND ?${branchSql}
      GROUP BY jel.account_code, jel.account_name ORDER BY jel.account_code
    `, scope.branchId ? [req.tenantId, from, to, scope.branchId] : [req.tenantId, from, to]);

    const instituteName = escapeHtml((await getBrandSettings(req.tenantId)).instituteName);

    const totalRevenue  = revRows.reduce((s, r) => s + parseFloat(r.net_amount || 0), 0);
    const totalExpenses = expRows.reduce((s, r) => s + parseFloat(r.net_amount || 0), 0);
    const netIncome     = totalRevenue - totalExpenses;
    const fmt = n => parseFloat(n || 0).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2 });

    const revRows_html = revRows.map(r => `
      <tr><td>${escapeHtml(r.account_code)}</td><td>${escapeHtml(r.account_name)}</td>
          <td class="num">${fmt(r.net_amount)}</td></tr>`).join('') ||
      '<tr><td colspan="3" style="text-align:center;color:#999">لا يوجد بيانات</td></tr>';

    const expRows_html = expRows.map(r => `
      <tr><td>${escapeHtml(r.account_code)}</td><td>${escapeHtml(r.account_name)}</td>
          <td class="num">${fmt(r.net_amount)}</td></tr>`).join('') ||
      '<tr><td colspan="3" style="text-align:center;color:#999">لا يوجد بيانات</td></tr>';

    const dateRange = `${new Date(from).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo' })} — ${new Date(to).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo' })}`;

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>قائمة الدخل — ${dateRange}</title>
<style>
  @page { size: A4; margin: 15mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #222; direction: rtl; background: #fff; }
  .header { text-align: center; border-bottom: 3px solid #2c7a7b; padding-bottom: 12px; margin-bottom: 20px; }
  .header h1 { font-size: 22px; color: #2c7a7b; }
  .header p  { color: #666; font-size: 12px; margin-top: 4px; }
  h2 { font-size: 15px; background: #2c7a7b; color: #fff; padding: 6px 12px; margin: 16px 0 8px; border-radius: 4px; }
  h2.exp { background: #c53030; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #edf2f7; padding: 8px 10px; font-size: 12px; text-align: right; }
  td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
  td.num { text-align: left; font-family: 'Courier New', monospace; font-weight: 600; }
  .total-row td { background: #f7fafc; font-weight: 700; border-top: 2px solid #2c7a7b; font-size: 14px; }
  .net-box { margin-top: 24px; border: 2px solid ${netIncome >= 0 ? '#2c7a7b' : '#c53030'}; border-radius: 8px; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; }
  .net-box .lbl { font-size: 16px; font-weight: 700; }
  .net-box .amt { font-size: 24px; font-weight: 900; color: ${netIncome >= 0 ? '#2c7a7b' : '#c53030'}; }
  .footer { margin-top: 30px; text-align: center; color: #999; font-size: 11px; border-top: 1px solid #e2e8f0; padding-top: 10px; }
  @media print { .no-print { display: none !important; } }
  @media screen { .no-print { margin: 20px; text-align: center; } }
</style>
</head>
<body>
<div class="header">
  <h1>${instituteName}</h1>
  <p>قائمة الدخل (Profit & Loss Statement)</p>
  <p>${dateRange}</p>
</div>

<h2>الإيرادات</h2>
<table>
  <thead><tr><th>كود الحساب</th><th>اسم الحساب</th><th>المبلغ (ج.م)</th></tr></thead>
  <tbody>${revRows_html}</tbody>
  <tfoot><tr class="total-row"><td colspan="2">إجمالي الإيرادات</td><td class="num">${fmt(totalRevenue)}</td></tr></tfoot>
</table>

<h2 class="exp">المصروفات</h2>
<table>
  <thead><tr><th>كود الحساب</th><th>اسم الحساب</th><th>المبلغ (ج.م)</th></tr></thead>
  <tbody>${expRows_html}</tbody>
  <tfoot><tr class="total-row"><td colspan="2">إجمالي المصروفات</td><td class="num">${fmt(totalExpenses)}</td></tr></tfoot>
</table>

<div class="net-box">
  <span class="lbl">${netIncome >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</span>
  <span class="amt">${fmt(Math.abs(netIncome))} ج.م</span>
</div>

<div class="footer">
  <p>تقرير مُنشأ بتاريخ ${new Date().toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo' })} — ${instituteName}</p>
</div>

<div class="no-print">
  <button onclick="window.print()" style="background:#2c7a7b;color:#fff;border:none;padding:10px 28px;border-radius:6px;font-size:15px;cursor:pointer;font-weight:bold">🖨️ طباعة / PDF</button>
</div>
<script>
  if (new URLSearchParams(location.search).get('print') === '1') setTimeout(() => window.print(), 400);
</script>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (e) {
    logger.error('[reports/pl/html]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

module.exports = router;
