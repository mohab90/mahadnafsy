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
const { dateOnlyInTimeZone } = require('../lib/dates');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { postPaymentJournal, logPaymentAudit } = require('../lib/finance');
const { assertWritable } = require('../lib/periodLock');
const { branchIdForBranch } = require('../lib/branches');
const { applyInstallmentPayment, removeInstallmentEntry } = require('../lib/installmentMath');
const { financialRecordMatches, resolveFinancialScope } = require('../lib/financialScope');
const { resolvePaymentAccess, accessModeOf, paidRatioOf } = require('../lib/paymentEntitlementAccess');
const { grantCourseEntitlement } = require('../lib/entitlements');
const { queuePaymentReceipt } = require('../lib/paymentReceipt');
const { isRealPhone } = require('../lib/phoneNumber');

async function requireScopedSubscriber(req, subscriberId, db = pool) {
  const [[subscriber]] = await db.query(
    `SELECT id, branch_id, assigned_cs_id, assigned_sales_id
       FROM subscribers
      WHERE id=? AND tenant_id=? AND deleted_at IS NULL
      LIMIT 1`,
    [subscriberId, req.tenantId]
  );
  const scope = resolveFinancialScope(req, { allowAssigned: true });
  return subscriber && financialRecordMatches(scope, subscriber) ? subscriber : null;
}

function planMatchesScope(req, plan) {
  return financialRecordMatches(resolveFinancialScope(req, { allowAssigned: true }), plan);
}

// On unless switched off. It was off unless switched on, and production never
// switched it on, so every plan anyone tried to make was refused with a 409 —
// «زرار الأقساط مش شغال» — and no plan was ever created. INSTALLMENT_WRITES_ENABLED=false
// still turns them off.
function requireInstallmentWritesEnabled(_req, res, next) {
  if (process.env.INSTALLMENT_WRITES_ENABLED !== 'false') return next();
  return res.status(409).json({
    error: 'Installment changes are temporarily disabled pending payment-model approval',
    code: 'INSTALLMENT_WRITES_DISABLED',
  });
}

// POST /api/admin/subscribers/:subscriberId/installment-plans — create a plan
router.post('/api/admin/subscribers/:subscriberId/installment-plans', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), requireInstallmentWritesEnabled, async (req, res) => {
  try {
    const { subscriberId } = req.params;
    const { courseId, bundleId, title, totalAmount, currency, entries, notes } = req.body || {};
    if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: 'entries (schedule) is required' });
    const total = Number(totalAmount);
    if (!total || total <= 0) return res.status(400).json({ error: 'totalAmount must be positive' });

    const sub = await requireScopedSubscriber(req, subscriberId);
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
    if (!await requireScopedSubscriber(req, req.params.subscriberId)) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }
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
router.post('/api/admin/installment-plans/:planId/entries/:index/pay', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), requireInstallmentWritesEnabled, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { planId } = req.params;
    const index = parseInt(req.params.index, 10);
    const { amount, paidDate, paymentMethod } = req.body || {};
    // The box the money went into, as every other payment records it. The row
    // used to say 'installment', which is no box, so the payment could not be
    // reconciled against the account it actually landed in.
    const method = String(paymentMethod || '').trim().slice(0, 100);
    if (!method) return res.status(400).json({ error: 'paymentMethod is required' });
    const paidAmount = Number(amount);
    // Cairo, not UTC. toISOString() takes the server's clock, and the server
    // runs in UTC — so an instalment confirmed at 01:30 Cairo was dated to the
    // previous day, filing the payment and its journal entry in the wrong
    // month. lib/finance.js records 179 entries already filed a day early this
    // way; this is the same default in another route.
    const effectiveDate = paidDate || dateOnlyInTimeZone();

    await conn.beginTransaction();
    const [[plan]] = await conn.query(
      `SELECT ip.*, s.branch, s.branch_id, s.assigned_cs_id, s.assigned_sales_id, s.phone AS subscriber_phone
         FROM installment_plans ip JOIN subscribers s ON s.id = ip.subscriber_id AND s.tenant_id = ip.tenant_id
        WHERE ip.id=? AND ip.tenant_id=? LIMIT 1 FOR UPDATE`,
      [planId, req.tenantId]
    );
    if (!plan) { await conn.rollback(); return res.status(404).json({ error: 'Plan not found' }); }
    if (!planMatchesScope(req, plan)) {
      await conn.rollback();
      return res.status(404).json({ error: 'Plan not found' });
    }
    // No money against a client who cannot be reached (lib/phoneNumber isRealPhone).
    if (!isRealPhone(plan.subscriber_phone)) {
      await conn.rollback();
      return res.status(400).json({
        error: 'لازم يكون للعميل رقم تليفون حقيقي قبل تسجيل أي دفعة — عدّل رقم العميل الأول.',
        code: 'PHONE_REQUIRED',
      });
    }

    const payId = `inst-${uuidv4()}`;
    let update;
    try {
      update = applyInstallmentPayment(plan, { index, paidAmount, paidDate: effectiveDate, paymentId: payId });
    } catch (e) {
      await conn.rollback();
      return res.status(e.statusCode || 400).json({ error: e.message });
    }

    await assertWritable(effectiveDate, conn, req.tenantId);

    // The price agreed for the course, when the booking recorded one: a plan is
    // often made for what is left, and its total then is not the course's
    // price. Recording the plan's total beside a booking's price made the next
    // payment on the course refuse with INSTALLMENT_EXPECTED_MISMATCH.
    const [[agreed]] = await conn.query(
      `SELECT MAX(course_expected) AS expected FROM payments
        WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND status='paid'
          AND course_id <=> ? AND bundle_id <=> ? AND course_expected > 0`,
      [req.tenantId, plan.subscriber_id, plan.course_id || null, plan.bundle_id || null]
    );
    const courseExpected = Number(agreed?.expected) > 0 ? Number(agreed.expected) : Number(plan.total_amount);

    const branch = plan.branch || 'ONLINE_EGYPT';
    const payType = plan.course_id ? 'COURSE' : (plan.bundle_id ? 'BUNDLE' : 'OTHER');
    await conn.query(
      `INSERT INTO payments
         (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
          is_installment, course_expected, note, date, status, source, item_title, branch, branch_id,
          tenant_id, staff_name, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,?,?,'paid','installment',?,?,?,?,?,NOW())`,
      [payId, plan.subscriber_id, plan.course_id || null, plan.bundle_id || null, paidAmount, plan.currency || 'EGP',
       payType, method,
       // The course's agreed price (the plan's total when none is on file),
       // not this instalment's amount.
       //
       // course_expected is what the customer owes for the course, and the
       // collections query reads MAX(course_expected) per course to decide who
       // still owes money. Writing 3,000 here for one instalment of a 9,000
       // plan made expected equal paid the moment that instalment cleared, so
       // a customer owing 6,000 dropped off /admin/payments/outstanding and
       // was never chased again. MAX over the plan total is stable across
       // every instalment row, which is why recording it on each is correct
       // rather than double-counting.
       courseExpected, `قسط رقم ${index + 1} من ${update.installmentAmounts.length} — خطة ${plan.title || planId}`,
       effectiveDate,
       plan.title || null, branch, plan.branch_id || branchIdForBranch(branch),
       req.tenantId, req.user?.email || req.staffRecord?.name || 'system']
    );
    const journalId = await postPaymentJournal({
      paymentId: payId, amount: paidAmount, currency: plan.currency || 'EGP',
      payType, actor: req.user?.email || 'system', tenantId: req.tenantId,
    }, conn);
    if (!journalId) throw new Error('Installment payment journal posting failed');
    // Every path that creates a paid payment writes the audit row. Six of the
    // nine did not, which is why 165 of 296 paid payments on production have no
    // provenance at all — including one taken today. strict + the transaction
    // connection, so the payment and its audit row live or die together.
    await logPaymentAudit(payId, 'create', null, 'paid', paidAmount, plan.subscriber_id,
      req.user?.email || req.staffRecord?.name || 'system', req.tenantId, conn, true);

    // What the instalment opens, as every other paid payment does: more
    // lectures in proportion to what is now paid, the whole course once it is
    // covered. Paying an instalment recorded the money and opened nothing.
    const courseIds = plan.course_id ? [plan.course_id] : [];
    if (plan.bundle_id) {
      const [bundleCourses] = await conn.query(
        'SELECT course_id FROM bundle_courses WHERE tenant_id=? AND bundle_id=?', [req.tenantId, plan.bundle_id]);
      courseIds.push(...bundleCourses.map(row => row.course_id));
    }
    if (courseIds.length) {
      let access = null;
      try {
        access = await resolvePaymentAccess({
          db: conn, tenantId: req.tenantId, subscriberId: plan.subscriber_id,
          courseId: plan.course_id || null, bundleId: plan.bundle_id || null,
          currentPaymentId: payId, currentAmount: paidAmount, currency: plan.currency || 'EGP',
          expectedAmount: courseExpected,
        });
      } catch (error) {
        // Mixed currencies or prices on the course: the money is recorded and
        // access is left for the desk to set, rather than refusing the payment.
        logger.warn('[installments] access left unchanged', { planId, code: error.code || error.message });
      }
      if (access) {
        for (const courseId of [...new Set(courseIds)]) {
          await grantCourseEntitlement({
            tenantId: req.tenantId, subscriberId: plan.subscriber_id, courseId,
            bundleId: plan.bundle_id || null, accessType: accessModeOf(access), lectureLimit: null,
            paidRatio: paidRatioOf(access), branchId: plan.branch_id || branchIdForBranch(branch),
            source: 'manual_payment', actor: req.user?.email || 'installment',
          }, conn);
        }
      }
    }

    await conn.query(
      `UPDATE installment_plans SET paid_dates=?, payment_ids=?, paid_amounts=?, paid_count=?, status=?
        WHERE id=? AND tenant_id=?`,
      [JSON.stringify(update.paidDates), JSON.stringify(update.paymentIds), JSON.stringify(update.paidAmounts),
       update.paidCount, update.status, planId, req.tenantId]
    );

    await conn.commit();
    queuePaymentReceipt(req.tenantId, payId);
    res.json({ ok: true, paymentId: payId, status: update.status, paidCount: update.paidCount });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// DELETE /api/admin/installment-plans/:planId — only if nothing has been paid yet
router.delete('/api/admin/installment-plans/:planId', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), requireInstallmentWritesEnabled, async (req, res) => {
  try {
    const [[plan]] = await pool.query(
      `SELECT ip.paid_count, s.branch_id, s.assigned_cs_id, s.assigned_sales_id
         FROM installment_plans ip
         JOIN subscribers s ON s.id=ip.subscriber_id AND s.tenant_id=ip.tenant_id
        WHERE ip.id=? AND ip.tenant_id=? AND s.deleted_at IS NULL LIMIT 1`,
      [req.params.planId, req.tenantId]
    );
    if (!plan || !planMatchesScope(req, plan)) return res.status(404).json({ error: 'Plan not found' });
    if (Number(plan.paid_count) > 0) return res.status(409).json({ error: 'Cannot delete a plan with recorded payments — it has real financial history' });
    const [r] = await pool.query('DELETE FROM installment_plans WHERE id=? AND tenant_id=? AND paid_count=0', [req.params.planId, req.tenantId]);
    if (!r.affectedRows) return res.status(409).json({ error: 'Plan changed concurrently — refresh and retry' });
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/installment-plans/:planId/entries/:index — remove one not-yet-paid entry
router.delete('/api/admin/installment-plans/:planId/entries/:index', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), requireInstallmentWritesEnabled, async (req, res) => {
  try {
    const { planId } = req.params;
    const index = parseInt(req.params.index, 10);
    const [[plan]] = await pool.query(
      `SELECT ip.*, s.branch_id, s.assigned_cs_id, s.assigned_sales_id
         FROM installment_plans ip
         JOIN subscribers s ON s.id=ip.subscriber_id AND s.tenant_id=ip.tenant_id
        WHERE ip.id=? AND ip.tenant_id=? AND s.deleted_at IS NULL LIMIT 1`,
      [planId, req.tenantId]
    );
    if (!plan || !planMatchesScope(req, plan)) return res.status(404).json({ error: 'Plan not found' });

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
