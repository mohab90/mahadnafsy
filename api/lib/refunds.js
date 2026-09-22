'use strict';
/**
 * Unified refund-reversal logic (PAY-04, PAY-05, PAY-14).
 *
 * Before this, the exact same ~60 lines of reversal logic were duplicated in
 * two places — api/routes/finance.js (PUT /api/admin/finance/refunds/:id,
 * the one actually called by CustomerInboxTab.tsx) and api/routes/
 * admin-utils.js (PATCH /api/admin/refund-requests/:id, confirmed unused by
 * any frontend caller and removed). Neither copy called assertWritable, so a
 * refund could mutate a financially closed accounting period with no
 * warning (PAY-04) — every other financial write path in the codebase does
 * check this. Neither copy updated orders.status, so a refunded Paymob/
 * manual-transfer order stayed marked "paid" forever, contradicting the
 * project's own "orders is the online twin of payments" invariant (PAY-05).
 * Also logs a lead_timeline entry when the subscriber has a linked lead
 * (FIN-02) — previously a refund left no trace there, so sales/CRM staff
 * would keep treating a refunded customer as a normal paying convert.
 */
const { logPaymentAudit, postJournalEntry, postPaymentJournal, _paymentAccountCode, toEgp } = require('./finance');
const { uuidv4 } = require('./id');
const { assertWritable } = require('./periodLock');
const { logLeadEvent } = require('./crm');
const { revokeCourseEntitlement } = require('./entitlements');
const { revokeCertificate } = require('./certificateLifecycle');
const { dateOnlyInTimeZone } = require('./dates');
const { ensureInvoiceForPayment, issueFinancialDocument } = require('./financialDocuments');

// Must run inside an existing transaction on `conn`. Call after the caller
// has already row-locked and updated the refund_requests row itself — this
// only handles the payment-side reversal. Returns { journalId, orderUpdated }
// or null if there was no linked payment to reverse.
async function applyRefundReversal({ paymentId, subscriberId, refundAmount, refundCurrency, tenantId, actor, reason = null }, conn) {
  if (!paymentId) return null;

  const [[pay]] = await conn.query(
    `SELECT id, subscriber_id, course_id, bundle_id, amount, amount_egp, currency, payment_type,
            payment_method, source, status, transaction_id, branch, branch_id, date, created_at
       FROM payments WHERE id = ? AND tenant_id = ? ${subscriberId ? 'AND subscriber_id = ?' : ''} AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    subscriberId ? [paymentId, tenantId, subscriberId] : [paymentId, tenantId]
  );
  if (!pay) return null;
  if (!['paid', 'confirmed'].includes(String(pay.status || '').toLowerCase())) {
    const error = new Error('Payment is not eligible for refund or was already refunded');
    error.status = 409;
    throw error;
  }
  if (/paymob/i.test(`${pay.payment_method || ''} ${pay.source || ''}`)) {
    const error = new Error('Paymob refunds are suspended until the gateway review is complete');
    error.status = 409;
    throw error;
  }
  // How much is going back, and whether that is all of it.
  //
  // Anything short of the full amount used to be refused outright, because the
  // only refund this function could express was "the payment did not happen":
  // status 'refunded', enrolment revoked, commission cancelled. Part of the
  // money coming back is a different event, and it is recorded below as its
  // own row rather than by rewriting the payment that did happen.
  const requestedAmount = Number(refundAmount);
  const paidAmount = Number(pay.amount);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    const error = new Error('مبلغ الاسترداد لازم يكون أكبر من صفر');
    error.status = 400;
    throw error;
  }
  if (requestedAmount - paidAmount > 0.01) {
    const error = new Error(`مبلغ الاسترداد أكبر من المدفوع (${paidAmount})`);
    error.status = 409;
    throw error;
  }
  const isPartial = paidAmount - requestedAmount > 0.01;
  if (String(refundCurrency || '').toUpperCase() !== String(pay.currency || 'EGP').toUpperCase()) {
    const error = new Error('Refund currency must match the payment currency');
    error.status = 409;
    throw error;
  }

  // Fail closed if this payment's date falls in a financially closed period —
  // every other write path that touches `payments` does this same check.
  const refundDate = dateOnlyInTimeZone();
  await assertWritable(refundDate, conn, tenantId);

  if (isPartial) {
    // Part of the money back: a row of its own, negative, out of the box the
    // money was taken into. Every figure in the system sums this column — the
    // customer's paid total, the vault, the branch P&L, the reports — so this
    // one row makes all of them right, and the payment that did happen keeps
    // saying what was paid.
    const refundedAmount = Math.round(requestedAmount * 100) / 100;
    const refundId = uuidv4();
    await conn.query(
      `INSERT INTO payments
         (id, tenant_id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
          payment_method, transaction_id, is_installment, date, note, status, staff_name,
          source, branch, branch_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,'paid',?,'refund',?,?,NOW())`,
      [
        refundId, tenantId, pay.subscriber_id, pay.course_id, pay.bundle_id,
        -refundedAmount, pay.currency || 'EGP', pay.payment_type || 'OTHER',
        pay.payment_method || null, null, refundDate,
        `استرداد جزئي من دفعة ${pay.id}${reason ? ` — ${String(reason).slice(0, 180)}` : ''}`, actor || null,
        pay.branch || null, pay.branch_id || null,
      ],
    );
    await logPaymentAudit(
      refundId, 'create', null, 'paid', -refundedAmount,
      pay.subscriber_id, actor, tenantId, conn, true,
    );
    await postPaymentJournal({
      paymentId: refundId, amount: -refundedAmount, currency: pay.currency || 'EGP',
      payType: pay.payment_type || 'OTHER', date: refundDate, actor, tenantId,
      branch: pay.branch || null, branchId: pay.branch_id || null,
    }, conn);

    // The commission follows the money that stayed. The enrolment does not
    // move: the customer has paid for part of this course and keeps it.
    const keptRatio = Math.max(0, (paidAmount - refundedAmount) / (paidAmount || 1));
    await conn.query(
      `UPDATE crm_commissions
          SET payment_amount = ROUND(payment_amount * ?, 2),
              commission_amount = ROUND(commission_amount * ?, 2),
              note = CONCAT(COALESCE(note,''),' | خُفّضت بعد استرداد جزئي')
        WHERE payment_id=? AND tenant_id=? AND status IN ('PENDING','INCLUDED_IN_PAYROLL')`,
      [keptRatio, keptRatio, pay.id, tenantId],
    );
    await conn.query(
      `INSERT INTO refunds (id, tenant_id, payment_id, subscriber_id, amount, currency, reason,
                            status, requested_by, approved_by, journal_posted, created_at, resolved_at)
       VALUES (?,?,?,?,?,?,?, 'done', ?, ?, 1, NOW(), NOW())`,
      [uuidv4(), tenantId, pay.id, pay.subscriber_id, refundedAmount, pay.currency || 'EGP',
        'استرداد جزئي', actor || null, actor || null],
    ).catch(() => { /* the ledger row is a record, not the refund itself */ });

    return {
      paymentId: pay.id, refundPaymentId: refundId, partial: true,
      refunded: refundedAmount, remaining: Math.round((paidAmount - refundedAmount) * 100) / 100,
    };
  }

  await conn.query(
    `UPDATE payments SET status='refunded',
        note=CONCAT(COALESCE(note,''), IF(note IS NOT NULL AND note!='',' | ',''), 'Refunded by ', ?)
      WHERE id=? AND tenant_id=?`,
    [actor, pay.id, tenantId]
  );
  await logPaymentAudit(
    pay.id, 'update', pay.status || null, 'refunded', pay.amount,
    pay.subscriber_id, actor, tenantId, conn, true,
  );
  await conn.query(
    `UPDATE crm_commissions SET status='CANCELLED', note=CONCAT(COALESCE(note,''),' | Cancelled because payment was refunded')
      WHERE payment_id=? AND tenant_id=? AND status IN ('PENDING','INCLUDED_IN_PAYROLL')`,
    [pay.id, tenantId]
  );
  // The instructor's share goes with the salesperson's, for the same reason.
  //
  // Only the commission was being cancelled. A payment whose instructor fee had
  // been approved stayed approved through the refund, and payroll pays approved
  // fees — so the institute returned the customer's money and paid the
  // instructor for that same enrolment out of the next run. There is no
  // 'cancelled' in this enum; 'rejected' is its terminal state.
  //
  // A fee already 'paid' is left alone: the money has gone, and reversing it is
  // a payroll correction rather than a status change.
  await conn.query(
    `UPDATE instructor_fees SET status='rejected'
      WHERE source_payment_id=? AND tenant_id=? AND status IN ('pending','approved','included_in_payroll')`,
    [pay.id, tenantId]
  );

  if (pay.course_id || pay.bundle_id) {
    let courseIds = pay.course_id ? [pay.course_id] : [];
    if (pay.bundle_id) {
      const [rows] = await conn.query(
        `SELECT bc.course_id FROM bundle_courses bc
         JOIN bundles b ON b.id=bc.bundle_id AND b.tenant_id=bc.tenant_id
         WHERE bc.tenant_id=? AND bc.bundle_id=?`,
        [tenantId, pay.bundle_id]
      );
      courseIds = rows.map(row => row.course_id);
    }
    for (const courseId of [...new Set(courseIds)]) {
      const [[otherGrant]] = await conn.query(
        `SELECT p.id FROM payments p
         WHERE p.tenant_id=? AND p.subscriber_id=? AND p.id<>?
           AND p.status IN ('paid','confirmed') AND p.deleted_at IS NULL
           AND (p.course_id=? OR EXISTS (
             SELECT 1 FROM bundle_courses bc
              WHERE bc.tenant_id=p.tenant_id AND bc.bundle_id=p.bundle_id AND bc.course_id=?
           )) LIMIT 1`,
        [tenantId, pay.subscriber_id, pay.id, courseId, courseId]
      );
      if (!otherGrant) {
        await revokeCourseEntitlement({
          tenantId, subscriberId: pay.subscriber_id, courseId,
          source: 'refund', actor, reason: `Payment ${pay.id} refunded`,
        }, conn);
        const [[completion]] = await conn.query(
          `SELECT id FROM course_completions
           WHERE tenant_id=? AND subscriber_id=? AND course_id=? AND status='active'
           LIMIT 1 FOR UPDATE`,
          [tenantId, pay.subscriber_id, courseId]
        );
        if (completion) {
          await revokeCertificate({
            tenantId, completionId: completion.id, actor,
            reason: `Payment ${pay.id} refunded and no other paid entitlement remains`,
          }, conn);
        }
      }
    }
  }

  // orders is the "online twin" of payments — a refund must flip it too, or
  // the order stays "paid" forever and every order-facing view (list, CSV
  // export, reconciliation) disagrees with the payment it was created from.
  // Matches the same linking convention the reconciliation check in
  // core/payops.js already relies on: direct id match, or shared
  // transaction_id (set to the same value on both rows by every payment
  // entry point — Paymob, manual transfer proof).
  const [orderUpdateResult] = await conn.query(
    `UPDATE orders SET status='refunded'
      WHERE tenant_id=? AND status='paid' AND (id = ? OR (transaction_id IS NOT NULL AND transaction_id = ?))`,
    [tenantId, pay.id, pay.transaction_id || pay.id]
  );

  let journalId = null;
  const amt = Number(pay.amount) || 0;
  if (amt > 0) {
    const [revCode, revName] = _paymentAccountCode(String(pay.payment_type || 'OTHER').toUpperCase());
    const amtEgp = Number(pay.amount_egp) > 0 ? Number(pay.amount_egp) : await toEgp(amt, pay.currency, tenantId);
    journalId = await postJournalEntry(
      'refund', pay.id, refundDate,
      `استرداد مبلغ ${amt} ${pay.currency || 'EGP'} (= ${amtEgp} EGP) — موافقة بواسطة ${actor}`,
      [
        { account_code: revCode, account_name: revName, debit: amtEgp, credit: 0 },
        { account_code: '1100', account_name: 'نقدية وبنوك', debit: 0, credit: amtEgp },
      ],
      actor, conn, tenantId, { branch: pay.branch || null, branchId: pay.branch_id || null }
    );
    if (!journalId) throw new Error('Refund journal posting failed');
    const invoice = await ensureInvoiceForPayment(conn, {
      ...pay,
      tenant_id: tenantId,
      date: pay.date || pay.created_at || refundDate,
    }, actor);
    await issueFinancialDocument(conn, {
      tenantId,
      branchId: pay.branch_id || null,
      documentType: 'credit_note',
      sourceType: 'payment_refund',
      sourceId: pay.id,
      relatedDocumentId: invoice.id,
      amount: amt,
      currency: pay.currency || 'EGP',
      issuedAt: refundDate,
      actor,
    });
  }

  // A subscriber without a lead is valid. A database failure while recording
  // the CRM trace is not: the refund, ledger and customer timeline must commit
  // together so every department sees the same outcome.
  const [[subRow]] = await conn.query(
    'SELECT lead_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
    [pay.subscriber_id, tenantId],
  );
  if (subRow?.lead_id) {
    await logLeadEvent(
      subRow.lead_id,
      'payment_refunded',
      `تم استرداد دفعة بمبلغ ${amt} ${pay.currency || 'EGP'} — بواسطة ${actor}`,
      { paymentId: pay.id },
      tenantId,
      conn,
    );
  }

  return { journalId, orderUpdated: orderUpdateResult.affectedRows > 0 };
}

module.exports = { applyRefundReversal };
