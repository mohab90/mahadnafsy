'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../lib/logger').child({ module: 'finance-planning-route' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { dateOnlyInTimeZone, isValidDateOnly, safeDateOnly } = require('../lib/dates');
const { getFxSnapshot, isFxSnapshotUsable, logFinancialAudit } = require('../lib/finance');
const { resolveFinancialScope } = require('../lib/financialScope');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');

const view = [requireAuth, requireAdminOrStaff, requirePermission('view_financial')];
const manage = [requireAuth, requireAdminOrStaff, requirePermission('manage_financial')];
const allowed = (value, values) => values.includes(String(value || '').toLowerCase());
const numeric = (value, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};
const addDays = (date, days) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};
const daysBetween = (left, right) => Math.floor(
  (new Date(`${left}T00:00:00Z`) - new Date(`${right}T00:00:00Z`)) / 86400000
);
const actor = req => req.staffRecord?.id || req.user?.email || req.user?.uid || 'system';

router.get('/api/admin/finance/forecast-assumptions', ...view, async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const params = [req.tenantId];
    const branchSql = scope.branchId ? ' AND branch_id=?' : '';
    if (scope.branchId) params.push(scope.branchId);
    const [rows] = await pool.query(
      `SELECT * FROM cash_flow_forecast_assumptions
        WHERE tenant_id=?${branchSql} ORDER BY is_active DESC,start_date,label LIMIT 1000`,
      params
    );
    res.json(rows);
  } catch (error) {
    logger.error(error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not load forecast assumptions' });
  }
});

router.post('/api/admin/finance/forecast-assumptions', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  let tx = false;
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.body?.branch || null });
    const direction = String(req.body?.direction || '').toLowerCase();
    const cadence = String(req.body?.cadence || 'one_time').toLowerCase();
    const currency = String(req.body?.currency || 'EGP').toUpperCase();
    const amount = numeric(req.body?.amount, 0.01, 100000000);
    const confidence = numeric(req.body?.confidence_pct ?? 100, 0, 100);
    const startDate = String(req.body?.start_date || '');
    const endDate = req.body?.end_date ? String(req.body.end_date) : null;
    const label = String(req.body?.label || '').trim().slice(0, 255);
    const category = String(req.body?.category || '').trim().slice(0, 80);
    if (!allowed(direction, ['inflow', 'outflow']) || !allowed(cadence, ['one_time', 'weekly', 'monthly'])
      || !['EGP', 'SAR', 'USD'].includes(currency) || amount === null || confidence === null
      || !label || !category || !isValidDateOnly(startDate)
      || (endDate && (!isValidDateOnly(endDate) || endDate < startDate))) {
      return res.status(400).json({ error: 'Invalid forecast assumption' });
    }
    const fx = await getFxSnapshot(req.tenantId);
    if (!isFxSnapshotUsable(fx, currency)) {
      return res.status(409).json({ error: `Fresh FX snapshot unavailable for ${currency}` });
    }
    const rate = Number(fx.rates[currency]);
    const amountEgp = Number((amount * rate).toFixed(2));
    const id = uuidv4();
    await conn.beginTransaction();
    tx = true;
    await conn.query(
      `INSERT INTO cash_flow_forecast_assumptions
         (id,tenant_id,branch_id,direction,category,label,amount,currency,amount_egp,
          fx_rate_to_egp,cadence,start_date,end_date,confidence_pct,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, scope.branchId, direction, category, label, amount, currency, amountEgp,
       rate, cadence, startDate, endDate, confidence, String(req.body?.notes || '').slice(0, 1000) || null, actor(req)]
    );
    await logFinancialAudit({
      entityType: 'cash_flow_forecast', entityId: id, action: 'created',
      newData: { direction, category, label, amount, currency, amountEgp, cadence, startDate, endDate, confidence },
      amount: amountEgp, actor: actor(req), tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    tx = false;
    res.status(201).json({ id, amount_egp: amountEgp, fx_rate_to_egp: rate });
  } catch (error) {
    if (tx) await conn.rollback().catch(() => {});
    logger.error(error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save forecast assumption' });
  } finally {
    conn.release();
  }
});

router.patch('/api/admin/finance/forecast-assumptions/:id', ...manage, async (req, res) => {
  try {
    const active = req.body?.is_active;
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'is_active boolean is required' });
    const scope = resolveFinancialScope(req, { requestedBranch: req.body?.branch || null });
    const [result] = await pool.query(
      `UPDATE cash_flow_forecast_assumptions
          SET is_active=?,updated_at=NOW()
        WHERE id=? AND tenant_id=?${scope.branchId ? ' AND branch_id=?' : ''}`,
      scope.branchId
        ? [active ? 1 : 0, req.params.id, req.tenantId, scope.branchId]
        : [active ? 1 : 0, req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Forecast assumption not found' });
    res.json({ ok: true, is_active: active });
  } catch (error) {
    logger.error(error.message);
    res.status(500).json({ error: 'Could not update forecast assumption' });
  }
});

router.get('/api/admin/finance/cash-flow-forecast', ...view, async (req, res) => {
  try {
    const start = String(req.query.start || dateOnlyInTimeZone());
    if (!isValidDateOnly(start)) return res.status(400).json({ error: 'Invalid forecast start date' });
    const end = addDays(start, 90);
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchJournal = scope.branchId ? ' AND je.branch_id=?' : '';
    const branchRecord = scope.branchId ? ' AND branch_id=?' : '';
    const baseParams = scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId];
    const [[cash], assumptions, payables, recurring] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(jel.debit-jel.credit),0) AS balance
           FROM journal_entries je
           JOIN journal_entry_lines jel ON jel.entry_id=je.id AND jel.account_code='1100'
          WHERE je.tenant_id=? AND je.entry_date<?${branchJournal}`,
        scope.branchId ? [req.tenantId, start, scope.branchId] : [req.tenantId, start]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT id,direction,category,label,amount_egp,cadence,start_date,end_date,confidence_pct
           FROM cash_flow_forecast_assumptions
          WHERE tenant_id=? AND is_active=1 AND start_date<=?
            AND (end_date IS NULL OR end_date>=?)${branchRecord}`,
        scope.branchId ? [req.tenantId, end, start, scope.branchId] : [req.tenantId, end, start]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT i.id,i.due_date,
                GREATEST(i.amount_egp-COALESCE(SUM(p.amount_egp),0),0) AS outstanding_egp
           FROM accounts_payable_invoices i
           LEFT JOIN accounts_payable_payments p ON p.payable_id=i.id AND p.tenant_id=i.tenant_id
          WHERE i.tenant_id=? AND i.status IN ('approved','partially_paid')
            AND i.due_date BETWEEN ? AND ?${branchRecord}
          GROUP BY i.id,i.due_date,i.amount_egp`,
        scope.branchId ? [req.tenantId, start, end, scope.branchId] : [req.tenantId, start, end]
      ).then(([rows]) => rows),
      pool.query(
        `SELECT id,title,amount_egp,frequency,day_of_month
           FROM recurring_expenses
          WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL${branchRecord}`,
        baseParams
      ).then(([rows]) => rows),
    ]);
    const weeks = Array.from({ length: 13 }, (_, index) => ({
      week: index + 1,
      from: addDays(start, index * 7),
      to: addDays(start, index * 7 + 6),
      inflows: 0,
      outflows: 0,
      sources: [],
    }));
    const add = (date, direction, amount, source) => {
      const index = Math.floor(daysBetween(date, start) / 7);
      if (index < 0 || index >= weeks.length || amount <= 0) return;
      weeks[index][direction === 'inflow' ? 'inflows' : 'outflows'] += amount;
      weeks[index].sources.push({ ...source, direction, amount: Number(amount.toFixed(2)) });
    };
    for (const payable of payables) add(safeDateOnly(payable.due_date), 'outflow', Number(payable.outstanding_egp), { type: 'accounts_payable', id: payable.id });
    for (const item of recurring) {
      for (let index = 0; index < weeks.length; index++) {
        const shouldAdd = item.frequency === 'weekly'
          || (item.frequency === 'monthly' && new Date(`${weeks[index].from}T00:00:00Z`).getUTCDate() <= Number(item.day_of_month || 1)
            && new Date(`${weeks[index].to}T00:00:00Z`).getUTCDate() >= Number(item.day_of_month || 1));
        if (shouldAdd) add(weeks[index].from, 'outflow', Number(item.amount_egp), { type: 'recurring_expense', id: item.id, label: item.title });
      }
    }
    for (const assumption of assumptions) {
      const confidenceAmount = Number(assumption.amount_egp) * Number(assumption.confidence_pct) / 100;
      let occurrence = safeDateOnly(assumption.start_date);
      const assumptionEnd = safeDateOnly(assumption.end_date);
      while (occurrence && occurrence <= end && (!assumptionEnd || occurrence <= assumptionEnd)) {
        add(occurrence, assumption.direction, confidenceAmount, { type: 'assumption', id: assumption.id, label: assumption.label });
        if (assumption.cadence === 'one_time') break;
        occurrence = addDays(occurrence, assumption.cadence === 'weekly' ? 7 : 30);
      }
    }
    let closing = Number(cash.balance) || 0;
    for (const week of weeks) {
      week.inflows = Number(week.inflows.toFixed(2));
      week.outflows = Number(week.outflows.toFixed(2));
      week.opening = Number(closing.toFixed(2));
      closing = closing + week.inflows - week.outflows;
      week.closing = Number(closing.toFixed(2));
    }
    res.json({
      start, end, branch: scope.branch, branchId: scope.branchId,
      openingCash: Number(cash.balance) || 0,
      closingCash: Number(closing.toFixed(2)),
      weeks,
      basis: ['ledger_cash', 'approved_accounts_payable', 'recurring_expenses', 'confidence_weighted_assumptions'],
    });
  } catch (error) {
    logger.error(error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not build cash-flow forecast' });
  }
});

module.exports = router;
