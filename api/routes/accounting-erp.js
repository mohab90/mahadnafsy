'use strict';
// ── Chart of Accounts + manual journal entries (ported from the 26 line) ──────
// Adds an admin-managed chart of accounts on top of 25's existing ledger
// (journal_entries / journal_entry_lines). Self-contained: creates its table on
// load and bootstraps it from the accounts already used in the ledger, so it is
// immediately populated with the institute's real accounts (no manual seeding).

const express = require('express');
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../lib/logger').child({ route: 'accounting-erp' });

const router = express.Router();

// Ensure the table exists + bootstrap from the live ledger the first time.
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS chart_of_accounts (
      code VARCHAR(32) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      type ENUM('asset','liability','equity','revenue','expense') NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM chart_of_accounts');
    if (n === 0) {
      // Type inferred from the code prefix (1=asset, 2=liability, 3=equity,
      // 4=revenue, else expense) — standard accounting convention.
      await pool.query(`INSERT IGNORE INTO chart_of_accounts (code, name, type)
        SELECT account_code, MAX(account_name),
          CASE LEFT(account_code, 1)
            WHEN '1' THEN 'asset' WHEN '2' THEN 'liability'
            WHEN '3' THEN 'equity' WHEN '4' THEN 'revenue' ELSE 'expense' END
        FROM journal_entry_lines WHERE account_code <> '' GROUP BY account_code`);
    }
  } catch (e) { logger.warn('[accounting-erp] ensure chart_of_accounts failed', { err: e.message }); }
})();

const VALID_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);

router.get('/api/admin/accounting/chart-of-accounts', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [accounts] = await pool.query(`
      SELECT code, name, type, is_active, created_at, updated_at
      FROM chart_of_accounts
      ORDER BY code ASC
    `);
    const [balances] = await pool.query(`
      SELECT account_code, COALESCE(SUM(debit),0) AS total_debit, COALESCE(SUM(credit),0) AS total_credit
      FROM journal_entry_lines
      GROUP BY account_code
    `);
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/accounting/chart-of-accounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim();
    const name = String(req.body.name || '').trim();
    const type = String(req.body.type || '').trim();
    if (!code || !name || !VALID_TYPES.has(type)) return res.status(400).json({ error: 'بيانات الحساب غير مكتملة' });

    await pool.query(
      `INSERT INTO chart_of_accounts (code, name, type, is_active) VALUES (?,?,?,1)`,
      [code, name, type]
    );
    res.json({ ok: true, account: { code, name, type, is_active: true } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'كود الحساب موجود مسبقا' });
    logger.error('chart-of-accounts create failed', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/accounting/chart-of-accounts/:code', requireAuth, requireAdmin, async (req, res) => {
  try {
    const updates = [];
    const params = [];
    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      updates.push('name=?');
      params.push(req.body.name.trim());
    }
    if (req.body.is_active !== undefined) {
      updates.push('is_active=?');
      params.push(req.body.is_active ? 1 : 0);
    }
    if (!updates.length) return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });
    params.push(req.params.code);
    const [result] = await pool.query(`UPDATE chart_of_accounts SET ${updates.join(', ')}, updated_at=NOW() WHERE code=?`, params);
    if (!result.affectedRows) return res.status(404).json({ error: 'الحساب غير موجود' });
    res.json({ ok: true });
  } catch (error) {
    logger.error('chart-of-accounts update failed', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/accounting/journal-entries', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const date = String(req.body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const description = String(req.body.description || '').trim();
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!description || lines.length < 2) return res.status(400).json({ error: 'يجب إدخال وصف وسطرين على الأقل' });

    const cleanLines = lines
      .map((line) => ({
        account_code: String(line.account_code || '').trim(),
        account_name: String(line.account_name || '').trim(),
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
      }))
      .filter((line) => line.account_code && (line.debit > 0 || line.credit > 0));

    if (cleanLines.length < 2) return res.status(400).json({ error: 'يجب إدخال حسابين بقيم صحيحة على الأقل' });
    const totalDebit = cleanLines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = cleanLines.reduce((sum, line) => sum + line.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit <= 0) {
      return res.status(400).json({ error: 'القيد غير متوازن' });
    }

    const codes = [...new Set(cleanLines.map((line) => line.account_code))];
    const [existingAccounts] = await pool.query(
      `SELECT code, name, is_active FROM chart_of_accounts WHERE code IN (${codes.map(() => '?').join(',')})`,
      codes
    );
    const byCode = new Map(existingAccounts.map((account) => [account.code, account]));
    const missing = codes.filter((code) => !byCode.has(code));
    if (missing.length) {
      return res.status(400).json({ error: 'حساب غير موجود', missing_accounts: missing });
    }
    const inactive = existingAccounts.filter((account) => account.is_active === 0).map((account) => account.code);
    if (inactive.length) {
      return res.status(400).json({ error: 'حساب غير مفعل', inactive_accounts: inactive });
    }
    for (const line of cleanLines) {
      line.account_name = byCode.get(line.account_code)?.name || line.account_name;
    }

    const entryId = uuidv4();
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO journal_entries (id, ref_type, ref_id, entry_date, description, total_debit, total_credit, posted_by)
       VALUES (?, 'manual', NULL, ?, ?, ?, ?, ?)`,
      [entryId, date, description, totalDebit, totalCredit, req.user?.email || req.user?.id || 'admin']
    );
    for (const line of cleanLines) {
      await conn.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_code, account_name, debit, credit)
         VALUES (?,?,?,?,?,?)`,
        [uuidv4(), entryId, line.account_code, line.account_name, line.debit, line.credit]
      );
    }
    await conn.commit();
    res.json({ ok: true, entry: { id: entryId } });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('journal-entry create failed', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

module.exports = router;
