'use strict';
/**
 * Installment plans — creation and payment confirmation.
 *
 * Root cause this closes (PAY-16): the admin UI (useInstallmentPlans.ts)
 * only ever wrote installment plans into subscribers.crm_json via the
 * generic updateSubscriber() call. Real installment_plans/installment_
 * amounts/due_dates/paid_dates columns already existed and were already
 * read by the overdue-reminder cron (admin-utils.js) and the finance
 * cockpit (finance.js) — but nothing ever wrote to them, and confirming a
 * "paid" installment never created a payments row, never posted a journal
 * entry, and was invisible to every financial report. This is the real
 * write path.
 */
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { uuidv4 } = require('./../lib/id');
const { pool } = require('../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { postPaymentJournal } = require('../lib/finance');
const { assertWritable } = require('../lib/periodLock');
const { branchIdForBranch } = require('../lib/branches');
const { applyInstallmentPayment, removeInstallmentEntry } = require('../lib/installmentMath');

// POST /api/admin/subscribers/:subscriberId/installment-plans — create a plan
router.post('/api/admin/subscribers/:subscriberId/installment-plans', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const { subscriberId } = req.params;
    const { courseId, bundleId, title, totalAmount, currency, entries, notes } = req.body || {};
    if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: 'entries (schedule) is required' });
    const total = Number(totalAmount);
    if (!total || total <= 0) return res.status(400).json({ error: 'totalAmount must be positive' });

    const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [subscriberId, req.tenantId]);
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });

    const id = `ip-${uuidv4()}`;
    const amounts = entries.map(e => Number(e.amount) || 0);
    const dueDates = entries.map(e => e.dueDate || null);
    await pool.query(
      `INSERT INTO installment_plans
         (id, tenant_id, subscriber_id, course_id, bundle_id, title, total_amount, currency,
          installments_count, paid_count, installment_amounts, due_dates, paid_dates, payment_ids, paid_amounts,
          status, notes, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,'active',?,NOW(),?)`,
      [id, req.tenantId, subscriberId, courseId || null, bundleId || null, title || null, total, currency || 'EGP',
       amounts.length, JSON.stringify(amounts), JSON.stringify(dueDates),
       JSON.stringify(amounts.map(() => null)), JSON.stringify(amounts.map(() => null)), JSON.stringify(amounts.map(() => null)),
       notes || null, req.user?.email || req.staffRecord?.name || 'system']
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/subscribers/:subscriberId/installment-plans — list plans for one subscriber
router.get('/api/admin/subscribers/:subscriberId/installment-plans', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, course_id, bundle_id, title, total_amount, currency, installments_count, paid_count,
              installment_amounts, due_dates, paid_dates, payment_ids, paid_amounts, status, notes, created_at
         FROM installment_plans WHERE subscriber_id=? AND tenant_id=? ORDER BY created_at DESC`,
      [req.params.subscriberId, req.tenantId]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/installment-plans/:planId/entries/:index/pay — confirm one scheduled payment
router.post('/api/admin/installment-plans/:planId/entries/:index/pay', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { planId } = req.params;
    const index = parseInt(req.params.index, 10);
    const { amount, paidDate } = req.body || {};
    const paidAmount = Number(amount);
    const effectiveDate = paidDate || new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();
    const [[plan]] = await conn.query(
      `SELECT ip.*, s.branch, s.branch_id
         FROM installment_plans ip JOIN subscribers s ON s.id = ip.subscriber_id AND s.tenant_id = ip.tenant_id
        WHERE ip.id=? AND ip.tenant_id=? LIMIT 1 FOR UPDATE`,
      [planId, req.tenantId]
    );
    if (!plan) { await conn.rollback(); return res.status(404).json({ error: 'Plan not found' }); }

    const payId = `inst-${uuidv4()}`;
    let update;
    try {
      update = applyInstallmentPayment(plan, { index, paidAmount, paidDate: effectiveDate, paymentId: payId });
    } catch (e) {
      await conn.rollback();
      return res.status(e.statusCode || 400).json({ error: e.message });
    }

    await assertWritable(effectiveDate, conn, req.tenantId);

    const branch = plan.branch || 'ONLINE_EGYPT';
    const payType = plan.course_id ? 'COURSE' : (plan.bundle_id ? 'BUNDLE' : 'OTHER');
    await conn.query(
      `INSERT INTO payments
         (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
          is_installment, course_expected, note, date, status, source, item_title, branch, branch_id,
          tenant_id, staff_name, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,?,?,'paid','installment',?,?,?,?,?,NOW())`,
      [payId, plan.subscriber_id, plan.course_id || null, plan.bundle_id || null, paidAmount, plan.currency || 'EGP',
       payType, 'installment',
       update.scheduledAmount, `قسط رقم ${index + 1} من ${update.installmentAmounts.length} — خطة ${plan.title || planId}`,
       effectiveDate,
       plan.title || null, branch, plan.branch_id || branchIdForBranch(branch),
       req.tenantId, req.user?.email || req.staffRecord?.name || 'system']
    );
    const journalId = await postPaymentJournal({
      paymentId: payId, amount: paidAmount, currency: plan.currency || 'EGP',
      payType, actor: req.user?.email || 'system', tenantId: req.tenantId,
    }, conn);
    if (!journalId) throw new Error('Installment payment journal posting failed');

    await conn.query(
      `UPDATE installment_plans SET paid_dates=?, payment_ids=?, paid_amounts=?, paid_count=?, status=?
        WHERE id=? AND tenant_id=?`,
      [JSON.stringify(update.paidDates), JSON.stringify(update.paymentIds), JSON.stringify(update.paidAmounts),
       update.paidCount, update.status, planId, req.tenantId]
    );

    await conn.commit();
    res.json({ ok: true, paymentId: payId, status: update.status, paidCount: update.paidCount });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// DELETE /api/admin/installment-plans/:planId — only if nothing has been paid yet
router.delete('/api/admin/installment-plans/:planId', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const [[plan]] = await pool.query('SELECT paid_count FROM installment_plans WHERE id=? AND tenant_id=? LIMIT 1', [req.params.planId, req.tenantId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (Number(plan.paid_count) > 0) return res.status(409).json({ error: 'Cannot delete a plan with recorded payments — it has real financial history' });
    const [r] = await pool.query('DELETE FROM installment_plans WHERE id=? AND tenant_id=? AND paid_count=0', [req.params.planId, req.tenantId]);
    if (!r.affectedRows) return res.status(409).json({ error: 'Plan changed concurrently — refresh and retry' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/installment-plans/:planId/entries/:index — remove one not-yet-paid entry
router.delete('/api/admin/installment-plans/:planId/entries/:index', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const { planId } = req.params;
    const index = parseInt(req.params.index, 10);
    const [[plan]] = await pool.query('SELECT * FROM installment_plans WHERE id=? AND tenant_id=? LIMIT 1', [planId, req.tenantId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    let update;
    try {
      update = removeInstallmentEntry(plan, { index });
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message });
    }

    await pool.query(
      `UPDATE installment_plans SET installment_amounts=?, due_dates=?, paid_dates=?, payment_ids=?, paid_amounts=?,
         installments_count=?, total_amount=? WHERE id=? AND tenant_id=?`,
      [JSON.stringify(update.installmentAmounts), JSON.stringify(update.dueDates), JSON.stringify(update.paidDates),
       JSON.stringify(update.paymentIds), JSON.stringify(update.paidAmounts), update.installmentsCount, update.totalAmount,
       planId, req.tenantId]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
