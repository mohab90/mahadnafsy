'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { uuidv4 } = require('../../lib/id');
const { pool } = require('../../lib/db');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { logPaymentAudit, postPaymentJournal, toEgp } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
const { transitionLead } = require('../../lib/leadState');
const { enqueueFinanceEvent } = require('../../lib/financeOutbox');
const { applyCertificatePayment } = require('../../lib/certificatePayments');
const { grantCourseEntitlement } = require('../../lib/entitlements');
const { financialRecordMatches, resolveFinancialScope } = require('../../lib/financialScope');
const { resolvePaymentAccess } = require('../../lib/paymentEntitlementAccess');
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
    if (becomingPaid) {
      const rawAmount = Number(payment.amount) || 0;
      if (rawAmount <= 0) throw new Error('Paid payment must have a positive amount');
      const journalId = await postPaymentJournal({
        paymentId: id, amount: rawAmount, currency: payment.currency, payType: payment.payment_type,
        date: String(payment.date || new Date().toISOString()).slice(0, 10), actor, tenantId,
      }, conn);
      if (!journalId) throw new Error('Payment journal posting failed');
    }

    await conn.query(
      `UPDATE payments
       SET status=?, note=CASE WHEN ?='' THEN note
         ELSE CONCAT(COALESCE(note,''),IF(COALESCE(note,'')='','',' | '),'Review: ',?) END
       WHERE id=? AND tenant_id=? AND deleted_at IS NULL`,
      [status, String(reviewNote || ''), String(reviewNote || ''), id, tenantId]
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
        if (payment.is_installment && Number(payment.course_expected) > 0) {
          accessType = await resolvePaymentAccess({
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
        }
        await grantCourseEntitlement({
          tenantId, subscriberId: payment.subscriber_id, courseId,
          bundleId: payment.bundle_id || null, accessType,
          lectureLimit: accessType === 'limited' ? 2 : null,
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
      const finalStaffId = payment.staff_id || subscriber?.assigned_sales_id || null;
      if (finalStaffId) {
        const [[staff]] = await conn.query(
          'SELECT id, commission_rate FROM staff WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1',
          [finalStaffId, tenantId]
        );
        const commissionRate = Number(staff?.commission_rate) || 0;
        if (commissionRate > 0) {
          const amountEgp = await toEgp(Number(payment.amount), payment.currency, tenantId);
          const commissionAmount = Number((amountEgp * commissionRate / 100).toFixed(2));
          const now = new Date();
          await conn.query(
            `INSERT INTO crm_commissions
               (id, staff_id, payment_id, client_id, client_type, payment_amount,
                commission_amount, calc_details, month, year, status, tenant_id, branch_id, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,'PENDING',?,?,NOW())
             ON DUPLICATE KEY UPDATE commission_amount=VALUES(commission_amount),
               tenant_id=VALUES(tenant_id), branch_id=VALUES(branch_id)`,
            [uuidv4(), finalStaffId, id, payment.subscriber_id, 'subscriber', amountEgp,
              commissionAmount, JSON.stringify({ rate: commissionRate, source: 'payment_status' }),
              now.getMonth() + 1, now.getFullYear(), tenantId, payment.branch_id || 'branch-other']
          );
        }
      }
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
              `Payment confirmed: ${payment.amount} ${payment.currency || 'EGP'}`, { tenantId });
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
