'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { pool } = require('../lib/db');
const logger = require('../lib/logger').child({ route: 'finance-operations' });
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { resolveFinancialScope } = require('../lib/financialScope');
const { branchIdForBranch } = require('../lib/branches');
const { logFinancialAudit, postJournalEntry, toEgp } = require('../lib/finance');
const { actor, buildCloseChecklist, currency, dateOnly, money, sha256, signedMoney } = require('../lib/financeOperations');

const router = express.Router();
const view = [requireAuth, requireAdminOrStaff, requirePermission('view_financial')];
const manage = [requireAuth, requireAdminOrStaff, requirePermission('manage_financial')];
const fail = (res, error, label) => {
  logger.error(label, error);
  return res.status(error.statusCode || error.status || 500)
    .json({ error: error.statusCode || error.status ? error.message : 'Internal server error' });
};
const clean = (value, max = 500) => String(value || '').trim().slice(0, max);
const scopedBranch = (req, requested) => {
  const scope = resolveFinancialScope(req, { requestedBranch: requested || null });
  return { scope, branchId: scope.branchId || (requested ? branchIdForBranch(requested) : null) };
};
const scopeSql = scope => scope.kind === 'branch' || scope.branchId ? ' AND i.branch_id=?' : '';
const scopeParams = scope => scope.kind === 'branch' || scope.branchId ? [scope.branchId] : [];

router.get('/api/admin/finance/vendors', ...view, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT v.*,COUNT(i.id) AS invoice_count,
              COALESCE(SUM(CASE WHEN i.status IN ('approved','partially_paid') THEN i.total_amount ELSE 0 END),0) AS open_amount
         FROM finance_vendors v
         LEFT JOIN accounts_payable_invoices i ON i.vendor_id=v.id AND i.tenant_id=v.tenant_id
        WHERE v.tenant_id=? GROUP BY v.id ORDER BY v.is_active DESC,v.name LIMIT 500`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (error) { fail(res, error, 'vendor list failed'); }
});

router.post('/api/admin/finance/vendors', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const name = clean(req.body?.name, 255);
    if (!name) return res.status(400).json({ error: 'Vendor name is required' });
    const id = crypto.randomUUID();
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO finance_vendors
         (id,tenant_id,name,tax_id,email,phone,currency,payment_terms_days,created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id, req.tenantId, name, clean(req.body?.tax_id, 80) || null,
        clean(req.body?.email, 255) || null, clean(req.body?.phone, 50) || null,
        currency(req.body?.currency || 'EGP'),
        Math.min(Math.max(Number(req.body?.payment_terms_days) || 30, 0), 365),
        actor(req),
      ]
    );
    await logFinancialAudit({
      entityType: 'vendor', entityId: id, action: 'create', newData: { name },
      actor: actor(req), tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    res.status(201).json({ ok: true, id });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'vendor creation failed');
  } finally { conn.release(); }
});

router.get('/api/admin/finance/payables', ...view, async (req, res) => {
  try {
    const { scope } = scopedBranch(req, req.query.branch);
    const [rows] = await pool.query(
      `SELECT i.*,v.name AS vendor_name,
              COALESCE((SELECT SUM(p.amount) FROM accounts_payable_payments p
                WHERE p.tenant_id=i.tenant_id AND p.payable_id=i.id),0) AS paid_amount
         FROM accounts_payable_invoices i
         JOIN finance_vendors v ON v.id=i.vendor_id AND v.tenant_id=i.tenant_id
        WHERE i.tenant_id=?${scopeSql(scope)}
        ORDER BY FIELD(i.status,'draft','approved','partially_paid','paid','void'),i.due_date LIMIT 1000`,
      [req.tenantId, ...scopeParams(scope)]
    );
    res.json(rows.map(row => ({ ...row, remaining_amount: Math.max(0, Number(row.total_amount) - Number(row.paid_amount)) })));
  } catch (error) { fail(res, error, 'payables list failed'); }
});

router.post('/api/admin/finance/payables', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { branchId } = scopedBranch(req, req.body?.branch);
    if (!branchId) return res.status(400).json({ error: 'Branch is required' });
    const invoiceDate = dateOnly(req.body?.invoice_date);
    const dueDate = dateOnly(req.body?.due_date);
    const subtotal = money(req.body?.subtotal, { allowZero: true });
    const taxAmount = money(req.body?.tax_amount || 0, { allowZero: true });
    const total = Number((subtotal + taxAmount).toFixed(2));
    if (!invoiceDate || !dueDate || dueDate < invoiceDate || total <= 0) {
      return res.status(400).json({ error: 'Invalid invoice dates or totals' });
    }
    const invoiceNumber = clean(req.body?.invoice_number, 120);
    if (!invoiceNumber) return res.status(400).json({ error: 'Invoice number is required' });
    const expenseCode = clean(req.body?.expense_account_code || '5900', 20);
    if (!/^5\d{3,19}$/.test(expenseCode)) return res.status(400).json({ error: 'Expense account must be a 5xxx account' });
    await conn.beginTransaction();
    const [[vendor]] = await conn.query(
      'SELECT id,currency FROM finance_vendors WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1 FOR UPDATE',
      [req.body?.vendor_id, req.tenantId]
    );
    if (!vendor) {
      await conn.rollback();
      return res.status(404).json({ error: 'Active vendor not found' });
    }
    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO accounts_payable_invoices
         (id,tenant_id,vendor_id,branch_id,invoice_number,invoice_date,due_date,currency,
          subtotal,tax_amount,total_amount,expense_account_code,description,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, req.tenantId, vendor.id, branchId, invoiceNumber, invoiceDate, dueDate,
        currency(req.body?.currency || vendor.currency), subtotal, taxAmount, total,
        expenseCode, clean(req.body?.description, 1000) || null, actor(req),
      ]
    );
    await logFinancialAudit({
      entityType: 'accounts_payable', entityId: id, action: 'create',
      newData: { vendor_id: vendor.id, invoice_number: invoiceNumber, total_amount: total },
      amount: total, actor: actor(req), tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    res.status(201).json({ ok: true, id, total_amount: total, status: 'draft' });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Vendor invoice already exists' });
    fail(res, error, 'payable creation failed');
  } finally { conn.release(); }
});

router.post('/api/admin/finance/payables/:id/approve', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[invoice]] = await conn.query(
      `SELECT * FROM accounts_payable_invoices
        WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId]
    );
    if (!invoice) {
      await conn.rollback();
      return res.status(404).json({ error: 'Payable not found' });
    }
    const scope = scopedBranch(req, req.body?.branch).scope;
    if ((scope.kind === 'branch' || scope.branchId) && String(scope.branchId) !== String(invoice.branch_id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Payable is outside your branch scope' });
    }
    if (invoice.status !== 'draft') {
      await conn.rollback();
      return res.status(409).json({ error: 'Only draft payables can be approved' });
    }
    if (String(invoice.created_by) === actor(req)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Payable approval requires a separate reviewer', code: 'AP_APPROVAL_SOD' });
    }
    const amountEgp = await toEgp(invoice.total_amount, invoice.currency, req.tenantId);
    const fxRate = Number((amountEgp / Number(invoice.total_amount)).toFixed(8));
    const journalId = await postJournalEntry(
      'accounts_payable_accrual', invoice.id, invoice.invoice_date,
      `AP ${invoice.invoice_number}`,
      [
        { account_code: invoice.expense_account_code, account_name: 'Accounts payable expense', debit: amountEgp, credit: 0 },
        { account_code: invoice.liability_account_code, account_name: 'Accounts payable', debit: 0, credit: amountEgp },
      ],
      actor(req), conn, req.tenantId, { branchId: invoice.branch_id }
    );
    if (!journalId) throw new Error('Unable to post payable accrual journal');
    await conn.query(
      `UPDATE accounts_payable_invoices
          SET status='approved',amount_egp=?,fx_rate_to_egp=?,approved_by=?,approved_at=NOW(),approval_journal_id=?
        WHERE id=? AND tenant_id=?`,
      [amountEgp, fxRate, actor(req), journalId, invoice.id, req.tenantId]
    );
    await logFinancialAudit({
      entityType: 'accounts_payable', entityId: invoice.id, action: 'approve',
      newData: { journal_id: journalId, amount_egp: amountEgp }, amount: amountEgp,
      actor: actor(req), tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    res.json({ ok: true, status: 'approved', journal_entry_id: journalId, amount_egp: amountEgp });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'payable approval failed');
  } finally { conn.release(); }
});

router.post('/api/admin/finance/payables/:id/void', ...manage, async (req, res) => {
  const reason = clean(req.body?.reason, 500);
  if (!reason) return res.status(400).json({ error: 'Void reason is required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[invoice]] = await conn.query(
      'SELECT id,branch_id,status FROM accounts_payable_invoices WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!invoice) {
      await conn.rollback();
      return res.status(404).json({ error: 'Payable not found' });
    }
    const scope = scopedBranch(req, req.body?.branch).scope;
    if ((scope.kind === 'branch' || scope.branchId) && String(scope.branchId) !== String(invoice.branch_id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Payable is outside your branch scope' });
    }
    if (invoice.status !== 'draft') {
      await conn.rollback();
      return res.status(409).json({ error: 'Only a draft payable can be voided' });
    }
    await conn.query(
      "UPDATE accounts_payable_invoices SET status='void' WHERE id=? AND tenant_id=?",
      [invoice.id, req.tenantId]
    );
    await logFinancialAudit({
      entityType: 'accounts_payable', entityId: invoice.id, action: 'void',
      newData: { reason }, actor: actor(req), tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    res.json({ ok: true, status: 'void' });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'payable void failed');
  } finally { conn.release(); }
});

router.post('/api/admin/finance/payables/:id/payments', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const paymentDate = dateOnly(req.body?.payment_date);
    const paymentAmount = money(req.body?.amount);
    const reference = clean(req.body?.reference, 191);
    if (!paymentDate || !reference) return res.status(400).json({ error: 'Payment date and reference are required' });
    await conn.beginTransaction();
    const [[invoice]] = await conn.query(
      'SELECT * FROM accounts_payable_invoices WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!invoice) {
      await conn.rollback();
      return res.status(404).json({ error: 'Payable not found' });
    }
    const paymentScope = scopedBranch(req, req.body?.branch).scope;
    if ((paymentScope.kind === 'branch' || paymentScope.branchId)
      && String(paymentScope.branchId) !== String(invoice.branch_id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Payable is outside your branch scope' });
    }
    if (!['approved', 'partially_paid'].includes(invoice.status)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Payable is not approved for payment' });
    }
    if (String(invoice.approved_by) === actor(req) || String(invoice.created_by) === actor(req)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Payable payment requires a separate operator', code: 'AP_PAYMENT_SOD' });
    }
    const [[paid]] = await conn.query(
      'SELECT COALESCE(SUM(amount),0) AS amount FROM accounts_payable_payments WHERE tenant_id=? AND payable_id=? FOR UPDATE',
      [req.tenantId, invoice.id]
    );
    const remaining = Number((Number(invoice.total_amount) - Number(paid.amount)).toFixed(2));
    if (paymentAmount > remaining) {
      await conn.rollback();
      return res.status(409).json({ error: 'Payment exceeds payable balance', remaining });
    }
    const amountEgp = Number((paymentAmount * Number(invoice.fx_rate_to_egp)).toFixed(2));
    const bankCode = clean(req.body?.bank_account_code || '1100', 20);
    const [[bankAccount]] = await conn.query(
      `SELECT code FROM tenant_chart_of_accounts
        WHERE tenant_id=? AND code=? AND type='asset' AND is_active=1 LIMIT 1`,
      [req.tenantId, bankCode]
    );
    if (!bankAccount) {
      await conn.rollback();
      return res.status(400).json({ error: 'Active bank/cash asset account is required' });
    }
    const paymentId = crypto.randomUUID();
    const journalId = await postJournalEntry(
      'accounts_payable_payment', paymentId, paymentDate,
      `AP payment ${invoice.invoice_number} / ${reference}`,
      [
        { account_code: invoice.liability_account_code, account_name: 'Accounts payable', debit: amountEgp, credit: 0 },
        { account_code: bankCode, account_name: 'Cash and bank', debit: 0, credit: amountEgp },
      ],
      actor(req), conn, req.tenantId, { branchId: invoice.branch_id }
    );
    if (!journalId) throw new Error('Unable to post payable payment journal');
    await conn.query(
      `INSERT INTO accounts_payable_payments
         (id,tenant_id,payable_id,payment_date,amount,currency,amount_egp,
          bank_account_code,reference,journal_entry_id,paid_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        paymentId, req.tenantId, invoice.id, paymentDate, paymentAmount, invoice.currency,
        amountEgp, bankCode, reference, journalId, actor(req),
      ]
    );
    const nextStatus = paymentAmount === remaining ? 'paid' : 'partially_paid';
    await conn.query(
      'UPDATE accounts_payable_invoices SET status=? WHERE id=? AND tenant_id=?',
      [nextStatus, invoice.id, req.tenantId]
    );
    await logFinancialAudit({
      entityType: 'accounts_payable', entityId: invoice.id, action: 'payment',
      newData: { payment_id: paymentId, journal_id: journalId, status: nextStatus },
      amount: amountEgp, actor: actor(req), tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    res.status(201).json({ ok: true, id: paymentId, status: nextStatus, remaining: Number((remaining - paymentAmount).toFixed(2)) });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Payment reference already exists' });
    fail(res, error, 'payable payment failed');
  } finally { conn.release(); }
});

router.get('/api/admin/finance/bank-reconciliations', ...view, async (req, res) => {
  try {
    const { scope } = scopedBranch(req, req.query.branch);
    const filter = scope.kind === 'branch' || scope.branchId ? ' AND branch_id=?' : '';
    const [rows] = await pool.query(
      `SELECT * FROM bank_reconciliations WHERE tenant_id=?${filter}
        ORDER BY period_end DESC,created_at DESC LIMIT 500`,
      [req.tenantId, ...scopeParams(scope)]
    );
    res.json(rows);
  } catch (error) { fail(res, error, 'bank reconciliation list failed'); }
});

router.post('/api/admin/finance/bank-reconciliations', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const periodStart = dateOnly(req.body?.period_start);
    const periodEnd = dateOnly(req.body?.period_end);
    if (!periodStart || !periodEnd || periodEnd < periodStart) {
      return res.status(400).json({ error: 'Invalid reconciliation period' });
    }
    const opening = signedMoney(req.body?.opening_balance || 0);
    const statement = signedMoney(req.body?.statement_closing_balance || 0);
    const accountCode = clean(req.body?.account_code || '1100', 20);
    const { branchId } = scopedBranch(req, req.body?.branch);
    await conn.beginTransaction();
    const [[account]] = await conn.query(
      `SELECT code FROM tenant_chart_of_accounts
        WHERE tenant_id=? AND code=? AND type='asset' AND is_active=1 LIMIT 1`,
      [req.tenantId, accountCode]
    );
    if (!account) {
      await conn.rollback();
      return res.status(400).json({ error: 'Active bank/cash asset account is required' });
    }
    const branchFilter = branchId ? ' AND je.branch_id=?' : '';
    const [[movement]] = await conn.query(
      `SELECT COALESCE(SUM(jel.debit-jel.credit),0) AS amount
         FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id=je.id
        WHERE je.tenant_id=? AND jel.account_code=? AND je.entry_date>=? AND je.entry_date<=?${branchFilter}`,
      [req.tenantId, accountCode, periodStart, periodEnd, ...(branchId ? [branchId] : [])]
    );
    const ledgerMovement = Number(Number(movement.amount).toFixed(2));
    const ledgerClosing = Number((opening + ledgerMovement).toFixed(2));
    const difference = Number((statement - ledgerClosing).toFixed(2));
    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO bank_reconciliations
         (id,tenant_id,branch_id,account_code,period_start,period_end,opening_balance,
          ledger_movement,ledger_closing_balance,statement_closing_balance,difference_amount,
          status,note,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, req.tenantId, branchId, accountCode, periodStart, periodEnd, opening,
        ledgerMovement, ledgerClosing, statement, difference,
        Math.abs(difference) < 0.01 ? 'ready' : 'draft', clean(req.body?.note, 1000) || null, actor(req),
      ]
    );
    await conn.commit();
    res.status(201).json({ ok: true, id, ledger_movement: ledgerMovement, ledger_closing_balance: ledgerClosing, difference_amount: difference });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Reconciliation already exists for this period' });
    fail(res, error, 'bank reconciliation creation failed');
  } finally { conn.release(); }
});

router.post('/api/admin/finance/bank-reconciliations/:id/items', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const itemDate = dateOnly(req.body?.item_date);
    const amount = Number(req.body?.amount);
    const itemType = clean(req.body?.item_type, 40);
    const allowed = new Set(['deposit_in_transit', 'outstanding_payment', 'bank_fee', 'interest', 'other']);
    if (!itemDate || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000000 || !allowed.has(itemType)) {
      return res.status(400).json({ error: 'Invalid reconciliation item' });
    }
    await conn.beginTransaction();
    const [[reconciliation]] = await conn.query(
      'SELECT * FROM bank_reconciliations WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!reconciliation || reconciliation.status === 'approved') {
      await conn.rollback();
      return res.status(409).json({ error: 'Reconciliation is unavailable or already approved' });
    }
    const itemScope = scopedBranch(req, req.body?.branch).scope;
    if ((itemScope.kind === 'branch' || itemScope.branchId)
      && String(itemScope.branchId) !== String(reconciliation.branch_id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Reconciliation is outside your branch scope' });
    }
    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO bank_reconciliation_items
         (id,tenant_id,reconciliation_id,item_date,description,amount,item_type,ledger_entry_id,created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id, req.tenantId, reconciliation.id, itemDate, clean(req.body?.description, 500),
        Number(amount.toFixed(2)), itemType, clean(req.body?.ledger_entry_id, 36) || null, actor(req),
      ]
    );
    const [[items]] = await conn.query(
      'SELECT COALESCE(SUM(amount),0) AS amount FROM bank_reconciliation_items WHERE tenant_id=? AND reconciliation_id=?',
      [req.tenantId, reconciliation.id]
    );
    const difference = Number((Number(reconciliation.statement_closing_balance)
      - Number(reconciliation.ledger_closing_balance) - Number(items.amount)).toFixed(2));
    await conn.query(
      'UPDATE bank_reconciliations SET difference_amount=?,status=? WHERE id=? AND tenant_id=?',
      [difference, Math.abs(difference) < 0.01 ? 'ready' : 'draft', reconciliation.id, req.tenantId]
    );
    await conn.commit();
    res.status(201).json({ ok: true, id, difference_amount: difference });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'bank reconciliation item failed');
  } finally { conn.release(); }
});

router.post('/api/admin/finance/bank-reconciliations/:id/approve', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      'SELECT * FROM bank_reconciliations WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!row || row.status !== 'ready' || Math.abs(Number(row.difference_amount)) >= 0.01) {
      await conn.rollback();
      return res.status(409).json({ error: 'Only a zero-difference reconciliation can be approved' });
    }
    const approvalScope = scopedBranch(req, req.body?.branch).scope;
    if ((approvalScope.kind === 'branch' || approvalScope.branchId)
      && String(approvalScope.branchId) !== String(row.branch_id)) {
      await conn.rollback();
      return res.status(403).json({ error: 'Reconciliation is outside your branch scope' });
    }
    if (String(row.created_by) === actor(req)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Bank reconciliation approval requires a separate reviewer', code: 'BANK_RECONCILIATION_SOD' });
    }
    await conn.query(
      `UPDATE bank_reconciliations
          SET status='approved',approved_by=?,approved_at=NOW()
        WHERE id=? AND tenant_id=?`,
      [actor(req), row.id, req.tenantId]
    );
    await logFinancialAudit({
      entityType: 'bank_reconciliation', entityId: row.id, action: 'approve',
      newData: { difference_amount: row.difference_amount }, actor: actor(req),
      tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    res.json({ ok: true, status: 'approved' });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'bank reconciliation approval failed');
  } finally { conn.release(); }
});

router.post('/api/admin/accounting-periods/:id/close-request', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const scope = resolveFinancialScope(req);
    if (scope.kind !== 'all' || scope.branchId) return res.status(403).json({ error: 'Central financial scope is required' });
    await conn.beginTransaction();
    const [[period]] = await conn.query(
      "SELECT * FROM accounting_periods WHERE id=? AND tenant_id=? AND status='open' LIMIT 1 FOR UPDATE",
      [req.params.id, req.tenantId]
    );
    if (!period) {
      await conn.rollback();
      return res.status(404).json({ error: 'Open period not found' });
    }
    const checklist = await buildCloseChecklist(conn, req.tenantId, period);
    if (!checklist.ready) {
      await conn.rollback();
      return res.status(409).json({ error: 'Close checklist has blocking items', checklist });
    }
    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO accounting_close_requests
         (id,tenant_id,period_id,checklist_snapshot,checklist_sha256,requested_by,request_note)
       VALUES (?,?,?,?,?,?,?)`,
      [id, req.tenantId, period.id, JSON.stringify(checklist), sha256(checklist), actor(req), clean(req.body?.note, 1000) || null]
    );
    await conn.commit();
    res.status(201).json({ ok: true, id, checklist });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An active close request already exists' });
    fail(res, error, 'period close request failed');
  } finally { conn.release(); }
});

router.get('/api/admin/accounting-periods/:id/close-requests', ...view, async (req, res) => {
  try {
    const scope = resolveFinancialScope(req);
    if (scope.kind !== 'all' || scope.branchId) return res.status(403).json({ error: 'Central financial scope is required' });
    const [rows] = await pool.query(
      `SELECT id,period_id,status,checklist_snapshot,checklist_sha256,requested_by,
              request_note,reviewed_by,review_note,reviewed_at,consumed_at,created_at
         FROM accounting_close_requests
        WHERE tenant_id=? AND period_id=? ORDER BY created_at DESC LIMIT 100`,
      [req.tenantId, req.params.id]
    );
    res.json(rows);
  } catch (error) { fail(res, error, 'period close request list failed'); }
});

router.post('/api/admin/accounting-periods/:id/close-request/:requestId/review', ...manage, async (req, res) => {
  const decision = clean(req.body?.decision, 20);
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Decision must be approve or reject' });
  const conn = await pool.getConnection();
  try {
    const scope = resolveFinancialScope(req);
    if (scope.kind !== 'all' || scope.branchId) return res.status(403).json({ error: 'Central financial scope is required' });
    await conn.beginTransaction();
    const [[request]] = await conn.query(
      `SELECT * FROM accounting_close_requests
        WHERE id=? AND period_id=? AND tenant_id=? AND status='pending' LIMIT 1 FOR UPDATE`,
      [req.params.requestId, req.params.id, req.tenantId]
    );
    if (!request) {
      await conn.rollback();
      return res.status(404).json({ error: 'Pending close request not found' });
    }
    if (String(request.requested_by) === actor(req)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Period close review requires a separate reviewer', code: 'PERIOD_CLOSE_SOD' });
    }
    await conn.query(
      `UPDATE accounting_close_requests
          SET status=?,reviewed_by=?,review_note=?,reviewed_at=NOW()
        WHERE id=? AND tenant_id=?`,
      [
        decision === 'approve' ? 'approved' : 'rejected', actor(req),
        clean(req.body?.note, 1000) || null, request.id, req.tenantId,
      ]
    );
    await conn.commit();
    res.json({ ok: true, status: decision === 'approve' ? 'approved' : 'rejected' });
  } catch (error) {
    await conn.rollback().catch(() => {});
    fail(res, error, 'period close review failed');
  } finally { conn.release(); }
});

module.exports = router;
