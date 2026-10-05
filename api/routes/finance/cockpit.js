'use strict';
// The finance cockpit's live figures.
// One part of routes/finance.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  pool,
  requireAuth,
  requireAdminOrStaff,
  requirePermission,
  resolveFinancialScope,
  addDaysToDateOnly,
  dateOnlyInTimeZone,
  monthRange,
  sqlCairoToday,
  logger,
} = require('./_shared');

const router = Router();

// IP-whitelist enforcement moved to a global, opt-in guard in server.js
// (adminIpWhitelistGuard) — it reads the ip_whitelist table the UI writes to,
// scopes to /api/admin/*, exempts the management route, and is env-gated. The old
// middleware here read a different store (site_config.admin_ip_whitelist) and only
// guarded the management route itself — a self-lockout footgun — so it was removed.


// ═══════════════════════════════════════════════════════════════════════════
// ── FINANCIAL COCKPIT — live dashboard data from DB (not SiteDataContext) ──
// ═══════════════════════════════════════════════════════════════════════════
router.get('/api/admin/finance/cockpit', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const journalScopeSql = scope.branchId ? ' AND je.branch_id=?' : '';
    const paymentScopeSql = scope.branchId ? ' AND branch_id=?' : '';
    const paymentAliasScopeSql = scope.branchId ? ' AND p.branch_id=?' : '';
    const expenseScopeSql = scope.branchId ? ' AND branch_id=?' : '';
    const now = new Date();
    const today = dateOnlyInTimeZone(now);
    const todayUtc = new Date(`${today}T00:00:00.000Z`);
    const weekStart = addDaysToDateOnly(today, -todayUtc.getUTCDay());
    const currentMonth = monthRange(today);
    const monthStart = currentMonth.startDate;
    const prevMonth = monthRange(addDaysToDateOnly(monthStart, -1));
    const prevMonthStart = prevMonth.startDate;
    const prevMonthEnd = prevMonth.endDate;

    // ── Revenue snapshots ──────────────────────────────────────────────
    const revenueForRange = async (start, end = null) => {
      const endSql = end ? ' AND je.entry_date < ?' : '';
      const params = end ? [req.tenantId, start, end] : [req.tenantId, start];
      if (scope.branchId) params.push(scope.branchId);
      const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(jel.credit-jel.debit),0) AS v
           FROM journal_entries je
           JOIN journal_entry_lines jel ON jel.entry_id=je.id
          WHERE je.tenant_id=? AND je.entry_date>=?${endSql}${journalScopeSql}
            AND jel.account_code LIKE '4%'`,
        params
      );
      return row;
    };
    const [todayRev, weekRev, monthRev, prevRev] = await Promise.all([
      revenueForRange(today, addDaysToDateOnly(today, 1)),
      revenueForRange(weekStart),
      revenueForRange(monthStart),
      revenueForRange(prevMonthStart, prevMonthEnd),
    ]);

    // ── Expense this month ─────────────────────────────────────────────
    const [[monthExp]] = await pool.query(
      `SELECT COALESCE(SUM(jel.debit-jel.credit),0) AS v
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.entry_id=je.id
        WHERE je.tenant_id=? AND je.entry_date>=?${journalScopeSql} AND jel.account_code LIKE '5%'`,
      scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]
    );

    // ── Revenue forecast: project month based on days elapsed ──────────
    const dayOfMonth = Number(today.slice(8, 10));
    const daysInMonth = Number(addDaysToDateOnly(currentMonth.endDate, -1).slice(8, 10));
    const forecast = dayOfMonth > 0 ? Math.round((parseFloat(monthRev.v) / dayOfMonth) * daysInMonth) : 0;

    // ── 12-month trend ─────────────────────────────────────────────────
    const [trend12] = await pool.query(`
      SELECT DATE_FORMAT(je.entry_date,'%Y-%m') AS month,
             COALESCE(SUM(jel.credit-jel.debit),0) AS revenue,
             COUNT(DISTINCT je.id) AS txn_count
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id
      WHERE je.tenant_id=? AND je.entry_date>=DATE_SUB(${sqlCairoToday()},INTERVAL 12 MONTH)
        AND jel.account_code LIKE '4%'${journalScopeSql}
      GROUP BY month ORDER BY month ASC
    `, scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]);

    // ── Top 5 courses by revenue this month ───────────────────────────
    const [topCourses] = await pool.query(`
      SELECT COALESCE(c.title_ar, c.title, p.item_title, p.payment_type, 'غير محدد') AS name,
             SUM(p.amount_egp) AS revenue, COUNT(*) AS cnt
      FROM payments p
      LEFT JOIN courses c ON c.id = p.course_id AND c.tenant_id = p.tenant_id
      WHERE p.tenant_id=? AND p.date >= ? AND p.status='paid' AND p.deleted_at IS NULL${paymentAliasScopeSql}
      GROUP BY p.course_id ORDER BY revenue DESC LIMIT 5
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);

    // ── Top 5 staff by revenue collected this month ────────────────────
    const [topStaff] = await pool.query(`
      SELECT COALESCE(s.name, p.staff_name, 'غير محدد') AS name,
             SUM(p.amount_egp) AS collected, COUNT(*) AS deals
      FROM payments p
      LEFT JOIN staff s ON s.id = p.staff_id AND s.tenant_id = p.tenant_id
      WHERE p.tenant_id=? AND p.date >= ? AND p.status='paid' AND p.deleted_at IS NULL AND p.staff_id IS NOT NULL${paymentAliasScopeSql}
      GROUP BY p.staff_id ORDER BY collected DESC LIMIT 5
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);

    // ── Revenue by payment method this month ───────────────────────────
    const [byMethod] = await pool.query(`
      SELECT COALESCE(payment_method,'غير محدد') AS method,
             SUM(amount_egp) AS revenue
      FROM payments
      WHERE tenant_id=? AND date >= ? AND status='paid' AND deleted_at IS NULL${paymentScopeSql}
      GROUP BY payment_method ORDER BY revenue DESC
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);

    // ── Expense by category this month ────────────────────────────────
    const [byCategory] = await pool.query(`
      SELECT category, SUM(amount_egp) AS total
      FROM expenses
      WHERE tenant_id=? AND deleted_at IS NULL AND date >= ?${expenseScopeSql}
      GROUP BY category ORDER BY total DESC
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);

    // ── Budget utilization ─────────────────────────────────────────────
    const curMonthLabel = today.slice(0, 7);
    const budgetBranchId = scope.branchId || 'branch-all';
    const [budgets] = await pool.query(`
      SELECT category, budgeted_amount AS limit_amount
      FROM budgets WHERE tenant_id=? AND branch_id=? AND month = ?
    `, [req.tenantId, budgetBranchId, curMonthLabel]);

    // ── Cross-section: Leads ───────────────────────────────────────────
    const [[leadsConverted]] = await pool.query(`
      SELECT COUNT(*) AS n FROM leads
      WHERE tenant_id=? AND status='converted' AND created_at>=? AND created_at<?
        ${scope.branchId ? 'AND branch_id=?' : ''}
    `, scope.branchId
      ? [req.tenantId, monthStart, currentMonth.endDate, scope.branchId]
      : [req.tenantId, monthStart, currentMonth.endDate]);
    const [[leadsTotal]] = await pool.query(`
      SELECT COUNT(*) AS n FROM leads
      WHERE tenant_id=? AND created_at>=? AND created_at<?
        ${scope.branchId ? 'AND branch_id=?' : ''}
    `, scope.branchId
      ? [req.tenantId, monthStart, currentMonth.endDate, scope.branchId]
      : [req.tenantId, monthStart, currentMonth.endDate]);

    // ── Cross-section: posted payroll expense this month ───────────────
    // The ledger is authoritative here. Summing payroll_items.net_salary
    // included unapproved/cancelled runs and omitted employer/statutory cost.
    const [[payrollCost]] = await pool.query(`
      SELECT COALESCE(SUM(jel.debit-jel.credit), 0) AS v
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id=je.id
      WHERE je.tenant_id=? AND je.ref_type='payroll'
        AND je.entry_date>=? AND je.entry_date<?
        AND jel.account_code='5100'
        ${scope.branchId ? 'AND je.branch_id=?' : ''}
    `, scope.branchId
      ? [req.tenantId, monthStart, currentMonth.endDate, scope.branchId]
      : [req.tenantId, monthStart, currentMonth.endDate]);

    // ── Cross-section: Daqqi revenue this month ────────────────────────
    // By the branch the money was taken at — what the branch P&L and the team report read.
    // It read `source='daqqi'`, which only the schedule's own payment dialog sets, so a Dokki
    // client who paid through their page, a booking or a lead's «حجز ودفع» was not counted.
    const [[daqqiRev]] = await pool.query(`
      SELECT COALESCE(SUM(p.amount_egp),0) AS v
      FROM payments p
      WHERE p.tenant_id=? AND p.date >= ? AND p.status='paid' AND p.deleted_at IS NULL AND p.branch='DAQQI'${paymentAliasScopeSql}
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);
    // And the Tagamoa branch beside it, read the same way.
    const [[tagamoaRev]] = await pool.query(`
      SELECT COALESCE(SUM(p.amount_egp),0) AS v
      FROM payments p
      WHERE p.tenant_id=? AND p.date >= ? AND p.status='paid' AND p.deleted_at IS NULL AND p.branch='TAGAMOA'${paymentAliasScopeSql}
    `, scope.branchId ? [req.tenantId, monthStart, scope.branchId] : [req.tenantId, monthStart]);

    // ── Alerts ─────────────────────────────────────────────────────────
    const [[pendingProofs]] = await pool.query(
      `SELECT COUNT(*) AS n FROM payment_proofs WHERE tenant_id=? AND status='pending'${paymentScopeSql}`,
      scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]
    );
    const [[pendingReviews]] = await pool.query(
      `SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND status='pending' AND deleted_at IS NULL${paymentScopeSql}`,
      scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]
    );
    // Any unpaid instalment whose date has passed — not the one at index
    // paid_count.
    //
    // paid_count is a count, and the pay route accepts any index, so
    // instalments can be settled out of order. A plan due 1 July and 1 December
    // whose customer prepaid December read due_dates[1] — December, not yet due
    // — and the July entry, months overdue, was never counted. The AR-aging
    // screen walks every entry and did list it, so the cockpit alert and that
    // screen disagreed. This is that same walk: an entry counts as unpaid when
    // neither its paid date nor its payment id is set.
    const [overduePlans] = await pool.query(`
      SELECT ip.due_dates, ip.paid_dates, ip.payment_ids
        FROM installment_plans ip
        JOIN subscribers s ON s.id=ip.subscriber_id AND s.tenant_id=ip.tenant_id
       WHERE ip.tenant_id=? AND ip.status IN ('active','overdue')
         ${scope.branchId ? 'AND s.branch_id=?' : ''}
    `, scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]);
    const todayIso = dateOnlyInTimeZone();
    const parseList = value => { try { const v = JSON.parse(value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
    const overdueInst = {
      n: overduePlans.filter(plan => {
        const dueDates = parseList(plan.due_dates);
        const paidDates = parseList(plan.paid_dates);
        const paymentIds = parseList(plan.payment_ids);
        return dueDates.some((dueDate, index) => dueDate
          && !paidDates[index] && !paymentIds[index]
          && String(dueDate).slice(0, 10) < todayIso);
      }).length,
    };
    const [[openTickets]] = await pool.query(
      `SELECT COUNT(*) AS n FROM support_tickets WHERE tenant_id=? AND status='open'${paymentScopeSql}`,
      scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]
    );

    // ── Financial health score (0-100) ─────────────────────────────────
    const mRev = parseFloat(monthRev.v) || 0;
    const mExp = parseFloat(monthExp.v) || 0;
    const profitMargin = mRev > 0 ? (mRev - mExp) / mRev : 0;
    const revenueGrowth = parseFloat(prevRev.v) > 0 ? (mRev - parseFloat(prevRev.v)) / parseFloat(prevRev.v) : 0;
    const alertPenalty = (pendingProofs.n + pendingReviews.n + overdueInst.n) * 2;
    const healthScore = Math.max(0, Math.min(100, Math.round(
      40 * Math.min(1, Math.max(0, profitMargin)) +   // profit margin contributes up to 40
      30 * Math.min(1, Math.max(0, 0.5 + revenueGrowth)) + // growth contributes up to 30
      20 * (mRev > 0 ? 1 : 0) +                          // has revenue → 20
      10 - alertPenalty                                    // penalty for alerts
    )));

    res.json({
      revenue: {
        today: parseFloat(todayRev.v) || 0,
        week:  parseFloat(weekRev.v)  || 0,
        month: mRev,
        prevMonth: parseFloat(prevRev.v) || 0,
        monthChangePercent: parseFloat(prevRev.v) > 0 ? Math.round(((mRev - parseFloat(prevRev.v)) / parseFloat(prevRev.v)) * 100) : null,
        forecast,
        dayOfMonth,
        daysInMonth,
      },
      expenses: {
        month: mExp,
        byCategory: byCategory.map(r => ({ category: r.category, total: parseFloat(r.total) || 0 })),
      },
      netProfit: { month: mRev - mExp, margin: mRev > 0 ? Math.round(((mRev - mExp) / mRev) * 100) : 0 },
      trend12: trend12.map(r => ({ month: r.month, revenue: parseFloat(r.revenue) || 0, txnCount: r.txn_count })),
      topCourses: topCourses.map(r => ({ name: r.name, revenue: parseFloat(r.revenue) || 0, cnt: r.cnt })),
      topStaff: topStaff.map(r => ({ name: r.name, collected: parseFloat(r.collected) || 0, deals: r.deals })),
      byMethod: byMethod.map(r => ({ method: r.method, revenue: parseFloat(r.revenue) || 0 })),
      budgets: budgets.map(r => ({ category: r.category, limit: parseFloat(r.limit_amount) || 0 })),
      crossSection: {
        leadsConverted: leadsConverted.n,
        leadsTotal: leadsTotal.n,
        conversionRate: leadsTotal.n > 0 ? Math.round((leadsConverted.n / leadsTotal.n) * 100) : 0,
        payrollCost: parseFloat(payrollCost.v) || 0,
        daqqiRevenue: parseFloat(daqqiRev.v) || 0,
        tagamoaRevenue: parseFloat(tagamoaRev.v) || 0,
      },
      alerts: {
        pendingProofs: pendingProofs.n,
        pendingReviews: pendingReviews.n,
        overdueInstallments: overdueInst.n,
        openTickets: openTickets.n,
        total: pendingProofs.n + pendingReviews.n + overdueInst.n,
      },
      healthScore,
      scope: { branch: scope.branch, branchId: scope.branchId },
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('[finance/cockpit]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

module.exports = router;
