'use strict';
/**
 * Refund / dispute workflow (Money risk #9). A refund reverses a payment in the
 * ledger on approval (credit cash 1100 / debit revenue), with financial audit
 * and a closed-period guard. Server is the sole writer of the reversal entry.
 */
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');
const { postJournalEntry, toEgp, _paymentAccountCode, logFinancialAudit } = require('../lib/finance');
const { assertWritable } = require('../lib/periodLock');

// List refunds (optionally by status).
router.get('/api/admin/refunds', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const status = req.query.status;
    const params = [];
    let where = '1=1';
    if (status && status !== 'all') { where += ' AND status=?'; params.push(status); }
    const [rows] = await pool.query(`SELECT * FROM refunds WHERE ${where} ORDER BY created_at DESC LIMIT 500`, params);
    res.json(rows);
  } catch (e) { logger.error('[refunds]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Request a refund against a paid payment.
router.post('/api/admin/refunds', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { paymentId, amount, reason } = req.body || {};
    if (!paymentId || !(Number(amount) > 0)) return res.status(400).json({ error: 'paymentId و amount مطلوبان' });
    const [[pay]] = await pool.query('SELECT id, subscriber_id, amount, currency FROM payments WHERE id=? LIMIT 1', [paymentId]);
    if (!pay) return res.status(404).json({ error: 'الدفعة غير موجودة' });
    if (Number(amount) > Number(pay.amount)) return res.status(400).json({ error: 'مبلغ الاسترداد أكبر من الدفعة' });
    const id = uuidv4();
    await pool.query(
      `INSERT INTO refunds (id, payment_id, subscriber_id, amount, currency, reason, status, requested_by)
       VALUES (?,?,?,?,?,?,'requested',?)`,
      [id, paymentId, pay.subscriber_id || null, Number(amount), pay.currency || 'EGP', reason || null, req.user?.email || 'staff']
    );
    await logFinancialAudit({ entityType: 'refund', entityId: id, action: 'request', newData: { paymentId, amount }, amount: Number(amount), actor: req.user?.email || 'staff' });
    res.json({ ok: true, id });
  } catch (e) { logger.error('[refunds]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Approve → post the reversing journal entry (admin only).
router.post('/api/admin/refunds/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const actor = req.user?.email || 'admin';
    const [[r]] = await pool.query('SELECT * FROM refunds WHERE id=? LIMIT 1', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Not found' });
    if (r.status !== 'requested') return res.status(409).json({ error: `لا يمكن اعتماد استرداد حالته ${r.status}` });
    const today = new Date().toISOString().slice(0, 10);
    await assertWritable(today); // can't post into a closed period
    const amtEgp = await toEgp(Number(r.amount) || 0, r.currency);
    const [accCode, accName] = _paymentAccountCode('OTHER');
    await postJournalEntry('refund', r.id, today,
      `استرداد ${r.amount} ${r.currency} (= ${amtEgp} EGP) — دفعة ${r.payment_id}`,
      [
        { account_code: accCode, account_name: accName, debit: amtEgp, credit: 0 }, // reverse revenue
        { account_code: '1100', account_name: 'نقدية وبنوك', debit: 0, credit: amtEgp }, // cash out
      ], actor);
    await pool.query("UPDATE refunds SET status='approved', approved_by=?, journal_posted=1, resolved_at=NOW() WHERE id=?", [actor, r.id]);
    await logFinancialAudit({ entityType: 'refund', entityId: r.id, action: 'approve', amount: Number(r.amount), actor });
    res.json({ ok: true });
  } catch (e) {
    if (e.status === 409) return res.status(409).json({ error: e.message });
    logger.error('[refunds]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject.
router.post('/api/admin/refunds/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    const actor = req.user?.email || 'admin';
    const [r] = await pool.query("UPDATE refunds SET status='rejected', approved_by=?, resolved_at=NOW() WHERE id=? AND status='requested'", [actor, req.params.id]);
    if (!r.affectedRows) return res.status(409).json({ error: 'لا يمكن رفض هذا الاسترداد' });
    await logFinancialAudit({ entityType: 'refund', entityId: req.params.id, action: 'reject', actor });
    res.json({ ok: true });
  } catch (e) { logger.error('[refunds]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
