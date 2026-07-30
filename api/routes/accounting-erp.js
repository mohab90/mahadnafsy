'use strict';
// Chart of Accounts + manual journal entries.
// Schema is owned by numbered migrations; this route only bootstraps missing
// account rows from the existing ledger when the table is already present.

const express = require('express');
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { assertWritable } = require('../lib/periodLock');
const { resolveFinancialScope } = require('../lib/financialScope');
const { logFinancialAudit } = require('../lib/finance');
const logger = require('../lib/logger').child({ route: 'accounting-erp' });

const router = express.Router();

const VALID_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);
const VALID_ACCOUNT_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const cleanAccountName = (value) => String(value || '').trim();
const SYSTEM_ACCOUNT_CODES = new Set(['1100', '1300', '2100', '2200', '4100', '4200', '4300', '4900', '5100']);

router.get('/api/admin/accounting/chart-of-accounts', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null });
    const branchSql = scope.branchId ? ' AND je.branch_id=?' : '';
    const [accounts] = await pool.query(`
      SELECT code, name, type, is_active, created_at, updated_at
      FROM tenant_chart_of_accounts
      WHERE tenant_id=?
      ORDER BY code ASC
    `, [req.tenantId]);
    const [balances] = await pool.query(`
      SELECT account_code, COALESCE(SUM(debit),0) AS total_debit, COALESCE(SUM(credit),0) AS total_credit
      FROM journal_entry_lines jel
      INNER JOIN journal_entries je ON je.id=jel.entry_id
      WHERE je.tenant_id=?${branchSql}
      GROUP BY account_code
    `, scope.branchId ? [req.tenantId, scope.branchId] : [req.tenantId]);
    const byCode = new Map(balances.map((row) => [row.account_code, row]));
    res.json(accounts.map((account) => {
      const row = byCode.get(account.code) || { total_debit: 0, total_credit: 0 };
      const totalDebit = Number(row.total_debit || 0);
      const totalCredit = Number(row.total_credit || 0);
      const debitNormal = account.type === 'asset' || account.type === 'expense';
      return {
        ...account,
        is_active: account.is_active !== 0,
        total_debit: totalDebit,
        total_credit: totalCredit,
        balance: debitNormal ? totalDebit - totalCredit : totalCredit - totalDebit,
      };
    }));
  } catch (error) {
    logger.error('chart-of-accounts get failed', { error: error.message });
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error', code: error.code });
  }
});

router.post('/api/admin/accounting/chart-of-accounts', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const scope = resolveFinancialScope(req);
    if (scope.kind !== 'all' || scope.branchId) {
      return res.status(403).json({ error: 'Chart of accounts changes require central financial scope' });
    }
    const code = String(req.body.code || '').trim();
    const name = cleanAccountName(req.body.name);
    const type = String(req.body.type || '').trim();
    if (!VALID_ACCOUNT_CODE.test(code) || !name || name.length > 255 || !VALID_TYPES.has(type)) {
      return res.status(400).json({ error: 'بيانات الحساب غير صالحة' });
    }

    await conn.beginTransaction();
    transactionStarted = true;
    await conn.query(
      `INSERT INTO tenant_chart_of_accounts (tenant_id, code, name, type, is_active) VALUES (?,?,?,?,1)`,
      [req.tenantId, code, name, type]
    );
    await logFinancialAudit({
      entityType: 'chart_account', entityId: code, action: 'create',
      newData: { code, name, type, is_active: true },
      actor: req.user?.email || req.user?.uid, tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, account: { code, name, type, is_active: true } });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'كود الحساب موجود مسبقا' });
    logger.error('chart-of-accounts create failed', { error: error.message });
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error', code: error.code });
  } finally { conn.release(); }
});

router.put('/api/admin/accounting/chart-of-accounts/:code', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const scope = resolveFinancialScope(req);
    if (scope.kind !== 'all' || scope.branchId) {
      return res.status(403).json({ error: 'Chart of accounts changes require central financial scope' });
    }
    const updates = [];
    const params = [];
    const nextName = typeof req.body.name === 'string' ? cleanAccountName(req.body.name) : '';
    if (nextName && nextName.length > 255) return res.status(400).json({ error: 'اسم الحساب يتجاوز 255 حرفًا' });
    if (nextName) {
      updates.push('name=?');
      params.push(nextName);
    }
    if (req.body.is_active !== undefined) {
      if (!req.body.is_active && SYSTEM_ACCOUNT_CODES.has(String(req.params.code))) {
        return res.status(409).json({ error: 'لا يمكن تعطيل حساب أساسي يستخدمه النظام' });
      }
      updates.push('is_active=?');
      params.push(req.body.is_active ? 1 : 0);
    }
    if (!updates.length) return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });
    await conn.beginTransaction();
    transactionStarted = true;
    const [[current]] = await conn.query(
      'SELECT code,name,type,is_active FROM tenant_chart_of_accounts WHERE tenant_id=? AND code=? LIMIT 1 FOR UPDATE',
      [req.tenantId, req.params.code],
    );
    if (!current) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'الحساب غير موجود' });
    }
    params.push(req.tenantId, req.params.code);
    await conn.query(`UPDATE tenant_chart_of_accounts SET ${updates.join(', ')}, updated_at=NOW() WHERE tenant_id=? AND code=?`, params);
    await logFinancialAudit({
      entityType: 'chart_account', entityId: req.params.code, action: 'update',
      oldData: current,
      newData: {
        name: nextName || current.name,
        is_active: req.body.is_active === undefined ? current.is_active : Boolean(req.body.is_active),
      },
      actor: req.user?.email || req.user?.uid, tenantId: req.tenantId, db: conn, strict: true,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('chart-of-accounts update failed', { error: error.message });
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error', code: error.code });
  } finally { conn.release(); }
});

router.post('/api/admin/accounting/journal-entries', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.body.branch || null });
    const date = String(req.body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const description = String(req.body.description || '').trim();
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!description || lines.length < 2) return res.status(400).json({ error: 'يجب إدخال وصف وسطرين على الأقل' });
    if (description.length > 1000 || lines.length > 100) {
      return res.status(400).json({ error: 'القيد يتجاوز الحدود المسموح بها' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
      return res.status(400).json({ error: 'Invalid journal date' });
    }

    const cleanLines = lines
      .map((line) => ({
        account_code: String(line.account_code || '').trim(),
        account_name: String(line.account_name || '').trim(),
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
      }))
      .filter((line) => VALID_ACCOUNT_CODE.test(line.account_code) && (line.debit > 0 || line.credit > 0));

    if (cleanLines.length < 2) return res.status(400).json({ error: 'يجب إدخال حسابين بقيم صحيحة على الأقل' });
    if (cleanLines.some((line) =>
      !Number.isFinite(line.debit) || !Number.isFinite(line.credit)
      || line.debit < 0 || line.credit < 0
      || (line.debit > 0 && line.credit > 0)
      || Math.max(line.debit, line.credit) > 100000000
    )) {
      return res.status(400).json({ error: 'Each journal line must contain one finite debit or credit amount' });
    }
    const totalDebit = cleanLines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = cleanLines.reduce((sum, line) => sum + line.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit <= 0) {
      return res.status(400).json({ error: 'القيد غير متوازن' });
    }

    await conn.beginTransaction();
    transactionStarted = true;
    await assertWritable(date, conn, req.tenantId);

    const codes = [...new Set(cleanLines.map((line) => line.account_code))];
    const [existingAccounts] = await conn.query(
      `SELECT code, name, is_active FROM tenant_chart_of_accounts
       WHERE tenant_id=? AND code IN (${codes.map(() => '?').join(',')})`,
      [req.tenantId, ...codes]
    );
    const byCode = new Map(existingAccounts.map((account) => [account.code, account]));
    const missing = codes.filter((code) => !byCode.has(code));
    if (missing.length) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(400).json({ error: 'حساب غير موجود', missing_accounts: missing });
    }
    const inactive = existingAccounts.filter((account) => account.is_active === 0).map((account) => account.code);
    if (inactive.length) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(400).json({ error: 'حساب غير مفعل', inactive_accounts: inactive });
    }
    for (const line of cleanLines) {
      line.account_name = byCode.get(line.account_code)?.name || line.account_name;
    }

    const entryId = uuidv4();
    await conn.query(
      `INSERT INTO journal_entries
         (id, tenant_id, ref_type, ref_id, entry_date, description, total_debit, total_credit, posted_by, branch, branch_id)
       VALUES (?, ?, 'manual', NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entryId,
        req.tenantId,
        date,
        description,
        totalDebit,
        totalCredit,
        req.user?.email || req.user?.id || 'admin',
        scope.branch,
        scope.branchId,
      ]
    );
    for (const line of cleanLines) {
      await conn.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_code, account_name, debit, credit)
         VALUES (?,?,?,?,?,?)`,
        [uuidv4(), entryId, line.account_code, line.account_name, line.debit, line.credit]
      );
    }
    await logFinancialAudit({
      entityType: 'journal_entry', entityId: entryId, action: 'create',
      newData: { date, description, branch: scope.branch, branch_id: scope.branchId, line_count: cleanLines.length },
      amount: totalDebit,
      actor: req.user?.email || req.user?.id || 'admin',
      tenantId: req.tenantId,
      db: conn,
      strict: true,
    });
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, entry: { id: entryId, branch: scope.branch, branch_id: scope.branchId } });
  } catch (error) {
    if (transactionStarted) {
      try { await conn.rollback(); } catch (_) {}
    }
    logger.error('journal-entry create failed', { error: error.message });
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error' });
  } finally {
    conn.release();
  }
});

module.exports = router;
