'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { logPaymentAudit, postPaymentJournal } = require('../../lib/finance');
const { recordPaymentCompensation } = require('../../lib/paymentCompensation');
const { assertWritable } = require('../../lib/periodLock');
const { transitionLead } = require('../../lib/leadState');
const { enqueueFinanceEvent } = require('../../lib/financeOutbox');
const { applyCertificatePayment } = require('../../lib/certificatePayments');
const { grantCourseEntitlement } = require('../../lib/entitlements');
const { financialRecordMatches, resolveFinancialScope } = require('../../lib/financialScope');
const { resolvePaymentAccess, accessModeOf, paidRatioOf } = require('../../lib/paymentEntitlementAccess');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');

// This is the only manual status transition endpoint for an existing payment.
// Refunds are deliberately handled by the refund workflow because they require
// approval and a reversing journal entry.
router.patch('/api/admin/payments/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { id } = req.params;
    const { status, reviewNote } = req.body || {};
    const scope = resolveFinancialScope(req, { requestedBranch: req.body.branch || null });
    if (!['paid', 'failed', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status; use the refund workflow for refunds' });
    }
    if (String(reviewNote || '').length > 2000) return res.status(400).json({ error: 'reviewNote is too long' });
    const tenantId = req.tenantId;
    const actor = req.user?.email || req.user?.uid || 'admin';
    await conn.beginTransaction();
    transactionStarted = true;
    const [[payment]] = await conn.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
              payment_method, transaction_id, is_installment, course_expected, \`date\`,
              note, status, staff_id, staff_name, branch_id, source, item_title, cert_type,
              certificate_request_id
       FROM payments
       WHERE id=? AND tenant_id=? AND deleted_at IS NULL FOR UPDATE`,
      [id, tenantId]
    );
    if (!payment) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Payment not found' });
    }
    if (!financialRecordMatches(scope, payment)) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(403).json({ error: 'Payment is outside your financial scope' });
    }
    await assertWritable(payment.date, conn, tenantId);
    const oldStatus = payment.status || 'pending';
    if (oldStatus === 'refunded') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Refunded payments are immutable' });
    }
    if (oldStatus === 'paid' && status !== 'paid') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Paid payments require a refund/reversal workflow' });
    }
    if (oldStatus === status) {
      await conn.commit(); transactionStarted = false;
      return res.json({ ok: true, id, status, unchanged: true });
    }

    const becomingPaid = status === 'paid';
    // Approving is the other way a payment reaches paid, and it is the moment
    // the accounts team says the money arrived — so it is where the method has
    // to be known. Recording one already refuses to settle without it; without
    // the same rule here a pending row with no method would simply be approved
    // into the same unreconcilable state (see subscriber-payments.js).
    //
    // Nothing can edit a stored method, so an approver who finds one missing is
    // asked for it here rather than being left with a row they cannot approve.
    const suppliedMethod = String(req.body.paymentMethod || req.body.payment_method || '').trim().slice(0, 100);
    const settledMethod = String(payment.payment_method || '').trim() || suppliedMethod;
    if (becomingPaid && !settledMethod) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'لازم تحدد طريقة الدفع قبل ما تأكد السداد. من غيرها مش هيبقى معروف الفلوس وصلت إزاي.' });
    }
    if (becomingPaid) {
      const rawAmount = Number(payment.amount) || 0;
      if (rawAmount <= 0) throw new Error('Paid payment must have a positive amount');
      const journalId = await postPaymentJournal({
        paymentId: id, amount: rawAmount, currency: payment.currency, payType: payment.payment_type,
        // Passed as it came out of the row. payments.date is DATETIME, so this
        // is a Date, and slicing its string form gave «Wed Jul 15» — which the
        // journal rejected, making every approval answer 500. postPaymentJournal
        // normalises whichever form it is handed.
        date: payment.date || new Date(), actor, tenantId,
      }, conn);
      if (!journalId) throw new Error('Payment journal posting failed');
    }

    await conn.query(
      `UPDATE payments
       SET status=?, payment_method=?, note=CASE WHEN ?='' THEN note
         ELSE CONCAT(COALESCE(note,''),IF(COALESCE(note,'')='','',' | '),'Review: ',?) END
       WHERE id=? AND tenant_id=? AND deleted_at IS NULL`,
      [status, settledMethod || payment.payment_method || null,
        String(reviewNote || ''), String(reviewNote || ''), id, tenantId]
    );

    if (becomingPaid && payment.subscriber_id) {
      const courseIds = [];
      if (payment.course_id) courseIds.push(payment.course_id);
      if (payment.bundle_id) {
        const [bundleCourses] = await conn.query(
          `SELECT bc.course_id FROM bundle_courses bc
           JOIN bundles b ON b.id=bc.bundle_id AND b.tenant_id=bc.tenant_id
           WHERE bc.tenant_id=? AND bc.bundle_id=?`,
          [tenantId, payment.bundle_id]
        );
        courseIds.push(...bundleCourses.map(row => row.course_id));
      }
      for (const courseId of [...new Set(courseIds)]) {
        let accessType = 'full';
        let paidRatio = null;
        if (payment.is_installment && Number(payment.course_expected) > 0) {
          const resolved = await resolvePaymentAccess({
            db: conn,
            tenantId,
            subscriberId: payment.subscriber_id,
            courseId: payment.course_id || null,
            bundleId: payment.bundle_id || null,
            currentPaymentId: id,
            currentAmount: payment.amount,
            currency: payment.currency,
            expectedAmount: payment.course_expected,
          });
          accessType = accessModeOf(resolved);
          paidRatio = paidRatioOf(resolved);
        }
        await grantCourseEntitlement({
          tenantId, subscriberId: payment.subscriber_id, courseId,
          bundleId: payment.bundle_id || null, accessType,
          // Was a flat 2 lectures for anyone short of the full price, so 90%
          // paid and 6% paid opened the same two. The ratio sizes it instead;
          // lectureLimit stays null so grantCourseEntitlement derives it from
          // the course's own published count.
          lectureLimit: null,
          paidRatio,
          branchId: payment.branch_id || 'branch-other',
          source: 'payment_status_review', actor,
        }, conn);
      }
      await conn.query(
        `UPDATE subscribers SET is_active=1, updated_at=NOW()
         WHERE id=? AND tenant_id=?`,
        [payment.subscriber_id, tenantId]
      );
      if (String(payment.payment_type || '').toUpperCase() === 'CERTIFICATE') {
        await applyCertificatePayment(payment, conn, tenantId);
      }

      const [[subscriber]] = await conn.query(
        'SELECT assigned_sales_id, lead_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
        [payment.subscriber_id, tenantId]
      );
      // The same commission the other path pays.
      //
      // Approving a pending payment used to compute its own: it read
      // staff.commission_rate directly and never consulted commission_rules,
      // so a role on a 5% rule whose staff row said 10 earned double here than
      // it would have on a payment recorded as paid outright. It also filed the
      // row under the server clock's month rather than the payment's own date,
      // so a payment dated 30 September approved on 1 October landed in
      // October and missed the September payroll run that pays it. And it never
      // wrote the instructor's share at all.
      //
      // recordPaymentCompensation is that rule, and it is now the only copy.
      await recordPaymentCompensation({
        paymentId: id,
        tenantId,
        commissionStaffId: payment.staff_id || subscriber?.assigned_sales_id || null,
        actor,
      }, conn);
      if (subscriber?.lead_id) {
        await transitionLead({
          tenantId,
          leadId: subscriber.lead_id,
          toStatus: 'converted',
          db: conn,
          actor,
          reason: 'Lead converted after manual payment approval',
          metadata: { subscriberId: payment.subscriber_id, paymentId: id },
        });
      }
      await enqueueFinanceEvent({
        tenantId,
        eventType: 'sync_lead_deal_value',
        refType: 'payment',
        refId: id,
        payload: { subscriberId: payment.subscriber_id },
      }, conn);
    }

    await conn.query(
      `UPDATE orders SET status=?, updated_at=NOW()
       WHERE (id=? OR transaction_id=?) AND tenant_id=? AND deleted_at IS NULL
         AND branch_id <=> ?`,
      [status, id, payment.transaction_id || id, tenantId, payment.branch_id || null]
    );
    await logPaymentAudit(id, 'update', oldStatus, status, payment.amount, payment.subscriber_id, actor, tenantId, conn, true);
    await conn.commit();
    transactionStarted = false;

    if (becomingPaid && payment.subscriber_id) {
      setImmediate(async () => {
        try {
          const [[subscriber]] = await pool.query(
            'SELECT phone FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
            [payment.subscriber_id, tenantId]
          );
          if (subscriber?.phone) {
            await sendWhatsApp(subscriber.phone.replace(/\D/g, ''),
              `Payment confirmed: ${payment.amount} ${payment.currency || 'EGP'}`, { tenantId, category: 'payment' });
          }
        } catch (error) {
          logger.warn('[patch-payment] confirmation notification failed:', error.message);
        }
      });
    }
    res.json({ ok: true, id, status });
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[patch-payment]', error.message);
    const statusCode = error.statusCode || error.status || 500;
    res.status(statusCode).json({ error: statusCode < 500 ? error.message : 'Internal server error' });
  } finally {
    conn.release();
  }
});

module.exports = router;
