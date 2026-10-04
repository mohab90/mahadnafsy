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

// Money going back as a row of its own, negative, out of the box it leaves
// from. Every figure in the system sums this column — the customer's paid
// total, the vault, the branch P&L, the reports — so this one row makes all of
// them right, and whatever payment did happen keeps saying what was paid.
async function insertRefundRow(conn, {
  tenantId, subscriberId, courseId, bundleId, amount, currency, paymentType, method,
  branch, branchId, date, note, actor, sourcePaymentId = null,
}) {
  const refundId = uuidv4();
  await conn.query(
    `INSERT INTO payments
       (id, tenant_id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
        payment_method, transaction_id, is_installment, date, note, status, staff_name,
        source, branch, branch_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,'paid',?,'refund',?,?,NOW())`,
    [
      refundId, tenantId, subscriberId, courseId || null, bundleId || null,
      -amount, currency || 'EGP', paymentType || 'OTHER',
      method || null, null, date, note, actor || null,
      branch || null, branchId || null,
    ],
  );
  await logPaymentAudit(refundId, 'create', null, 'paid', -amount, subscriberId, actor, tenantId, conn, true);
  await postPaymentJournal({
    paymentId: refundId, amount: -amount, currency: currency || 'EGP',
    payType: paymentType || 'OTHER', date, actor, tenantId,
    branch: branch || null, branchId: branchId || null,
  }, conn);
  await conn.query(
    `INSERT INTO refunds (id, tenant_id, payment_id, subscriber_id, amount, currency, reason,
                          status, requested_by, approved_by, journal_posted, created_at, resolved_at)
     VALUES (?,?,?,?,?,?,?, 'done', ?, ?, 1, NOW(), NOW())`,
    [uuidv4(), tenantId, sourcePaymentId || refundId, subscriberId, amount, currency || 'EGP',
      sourcePaymentId ? 'استرداد جزئي' : 'استرداد بدون دفعة مسجّلة', actor || null, actor || null],
  ).catch(() => { /* the ledger row is a record, not the refund itself */ });
  return refundId;
}

// «عند الاسترداد لازم يتحدد دفعه العميل … مش لازم الخطوه دي ممكن نلغيها لان في
// عملاء مش متسجلها دفعات». A refund for a course with no payment recorded
// behind it — money a sheet said was paid, or paid before the system. It leaves
// from the box named on the request, against the course it was for, and the
// client keeps the course: taking it off is a separate decision
// (lib/clientCourseActions.js).
async function applyUnlinkedRefund({ subscriberId, item, refundAmount, refundCurrency, method, tenantId, actor, reason = null }, conn) {
  const amount = Math.round(Number(refundAmount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error('مبلغ الاسترداد لازم يكون أكبر من صفر');
    error.status = 400;
    throw error;
  }
  const [[subscriber]] = await conn.query(
    'SELECT branch, branch_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [subscriberId, tenantId]);
  if (!subscriber) {
    const error = new Error('العميل غير موجود');
    error.status = 404;
    throw error;
  }
  const refundDate = dateOnlyInTimeZone();
  await assertWritable(refundDate, conn, tenantId);
  const key = String(item || '');
  const bundleId = key.startsWith('bundle:') ? key.slice(7) : null;
  const refundPaymentId = await insertRefundRow(conn, {
    tenantId, subscriberId, courseId: bundleId ? null : (key || null), bundleId,
    amount, currency: refundCurrency, paymentType: bundleId ? 'BUNDLE' : (key ? 'COURSE' : 'OTHER'), method,
    branch: subscriber.branch, branchId: subscriber.branch_id, date: refundDate, actor,
    note: `استرداد${reason ? ` — ${String(reason).slice(0, 180)}` : ''}`,
  });
  return { refundPaymentId, refunded: amount, partial: true };
}


// What has already gone back against one payment.
//
// A partial refund leaves the payment itself saying what was paid and writes a
// negative row of its own, so "how much is left to refund" is not on the payment.
// It used to be computed from nothing: every partial refund was checked against
// the ORIGINAL amount, so two refunds of 700 on a payment of 1000 both passed
// and 1400 went back — each time with a journal line, and with the commission
// scaled again on top of the last scaling. Read from both places a refund is
// recorded (the `refunds` ledger row, and the negative payment row whose note
// names the payment) and take the larger, so one of them failing to write — the
// ledger insert is allowed to — cannot hide a refund from the next check.
async function refundedSoFar(conn, tenantId, pay) {
  let viaLedger = 0;
  let viaRows = 0;
  try {
    const [ledger] = await conn.query(
      "SELECT COALESCE(SUM(amount),0) AS total FROM refunds WHERE tenant_id=? AND payment_id=? AND status IN ('done','approved','refunded')",
      [tenantId, pay.id],
    );
    viaLedger = Number(ledger?.[0]?.total) || 0;
  } catch (_) { /* the ledger is only one of the two sources */ }
  try {
    const [rows] = await conn.query(
      "SELECT COALESCE(-SUM(amount),0) AS total FROM payments WHERE tenant_id=? AND subscriber_id=? AND source='refund' AND amount<0 AND deleted_at IS NULL AND note LIKE ?",
      [tenantId, pay.subscriber_id, `%من دفعة ${pay.id}%`],
    );
    viaRows = Number(rows?.[0]?.total) || 0;
  } catch (_) { /* as above */ }
  return Math.round(Math.max(viaLedger, viaRows) * 100) / 100;
}


// A commission that has already been PAID cannot be cancelled or scaled — the
// money has left. The refund used to touch only PENDING and INCLUDED rows, so a
// rep kept the full commission on a sale the customer then got back, with
// nothing to say so. It is taken back as an approved deduction in the month the
// refund happens, which the next payroll run subtracts (payroll.js reads
// employee_bonuses type 'deduction'). `share` is the part of the payment that
// went back: 1 for all of it.
async function clawBackPaidCommission(conn, { tenantId, paymentId, share, actor, refundDate, reason }) {
  let rows = [];
  try {
    [rows] = await conn.query(
      "SELECT id, staff_id, commission_amount FROM crm_commissions WHERE payment_id=? AND tenant_id=? AND status='PAID'",
      [paymentId, tenantId],
    );
  } catch (_) { return 0; }
  const month = Number(String(refundDate).slice(5, 7));
  const year = Number(String(refundDate).slice(0, 4));
  let clawed = 0;
  for (const row of rows || []) {
    const amount = Math.round(Number(row.commission_amount) * Math.min(1, Math.max(0, share)) * 100) / 100;
    if (!(amount > 0)) continue;
    await conn.query(
      `INSERT INTO employee_bonuses (id, tenant_id, staff_id, type, amount, status, currency, reason, for_month, for_year, created_by, approved_by, approved_at)
       VALUES (?,?,?,'deduction',?,'APPROVED','EGP',?,?,?,?,?,NOW())`,
      [uuidv4(), tenantId, row.staff_id, amount,
        `استرجاع عمولة اتصرفت قبل كده — دفعة ${paymentId} اتردّ منها ${Math.round(Math.min(1, share) * 100)}%${reason ? ` (${String(reason).slice(0, 120)})` : ''}`,
        month, year, actor || null, actor || null],
    );
    clawed += amount;
  }
  return clawed;
}

// The retention bonus a payment earned its instructor (lib/instructorPay.js)
// goes when the payment does. A paid one is left, as the instructor's share is.
async function rejectRetentionBonus(conn, { tenantId, paymentId }) {
  await conn.query(
    `UPDATE instructor_fees SET status='rejected'
      WHERE trigger_payment_id=? AND tenant_id=? AND fee_type='retention'
        AND status IN ('pending','approved','included_in_payroll')`,
    [paymentId, tenantId]
  );
}

// A refunded payment's courses close unless another payment still covers them.
// Refund rows are negative 'paid' rows on the same course; they cover nothing
// (`p.amount > 0`) — counted as a grant they kept access open after partial
// refunds had returned the whole payment.
async function revokeAccessWithoutOtherGrant(conn, { tenantId, pay, actor }) {
  if (!pay.course_id && !pay.bundle_id) return;
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
         AND p.status IN ('paid','confirmed') AND p.deleted_at IS NULL AND p.amount > 0
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
  const alreadyRefunded = await refundedSoFar(conn, tenantId, pay);
  const refundable = Math.round((paidAmount - alreadyRefunded) * 100) / 100;
  if (requestedAmount - refundable > 0.01) {
    const error = new Error(alreadyRefunded > 0.01
      ? `مبلغ الاسترداد أكبر من المتبقي القابل للاسترداد (${refundable}) — اتسترد ${alreadyRefunded} من ${paidAmount} قبل كده`
      : `مبلغ الاسترداد أكبر من المدفوع (${paidAmount})`);
    error.status = 409;
    throw error;
  }
  // After any earlier refund this is a partial one whatever its size: the full
  // path rewrites the payment as 'refunded' and reverses all of it, which would
  // count the part that already went back a second time.
  const isPartial = alreadyRefunded > 0.01 || paidAmount - requestedAmount > 0.01;
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
    // Part of the money back, out of the box the money was taken into.
    const refundedAmount = Math.round(requestedAmount * 100) / 100;
    const refundId = await insertRefundRow(conn, {
      tenantId, subscriberId: pay.subscriber_id, courseId: pay.course_id, bundleId: pay.bundle_id,
      amount: refundedAmount, currency: pay.currency, paymentType: pay.payment_type,
      method: pay.payment_method, branch: pay.branch, branchId: pay.branch_id, date: refundDate, actor,
      note: `استرداد جزئي من دفعة ${pay.id}${reason ? ` — ${String(reason).slice(0, 180)}` : ''}`,
      sourcePaymentId: pay.id,
    });

    // The commission follows the money that stayed. The enrolment does not
    // move: the customer has paid for part of this course and keeps it.
    await clawBackPaidCommission(conn, {
      tenantId, paymentId: pay.id, share: refundedAmount / (paidAmount || 1), actor, refundDate, reason,
    });
    // Of what is left to refund, not of the original: the commission already
    // carries the earlier refunds.
    const keptRatio = Math.max(0, (refundable - refundedAmount) / (refundable || 1));
    await conn.query(
      `UPDATE crm_commissions
          SET payment_amount = ROUND(payment_amount * ?, 2),
              commission_amount = ROUND(commission_amount * ?, 2),
              note = CONCAT(COALESCE(note,''),' | خُفّضت بعد استرداد جزئي')
        WHERE payment_id=? AND tenant_id=? AND status IN ('PENDING','INCLUDED_IN_PAYROLL')`,
      [keptRatio, keptRatio, pay.id, tenantId],
    );
    // The instructor's share follows the same money. Only the commission was
    // scaled: the fee kept its full amount, and when partial refunds added up
    // to the whole payment it stayed approved at 30% of money the institute
    // had given back — payroll pays approved fees. A fee already 'paid' is
    // left alone, as on the full refund below.
    await conn.query(
      `UPDATE instructor_fees
          SET total_amount = ROUND(total_amount * ?, 2),
              fixed_amount = ROUND(COALESCE(fixed_amount, 0) * ?, 2),
              status = IF(? <= 0, 'rejected', status),
              note = CONCAT(COALESCE(note,''),' | خُفّضت بعد استرداد جزئي')
        WHERE source_payment_id=? AND tenant_id=? AND status IN ('pending','approved','included_in_payroll')`,
      [keptRatio, keptRatio, keptRatio, pay.id, tenantId],
    );

    // Partial refunds that add up to the whole payment are a full refund in
    // all but the bookkeeping: the customer keeps nothing they paid for, so
    // nothing they paid for stays open — as when it goes back in one go.
    if (refundable - refundedAmount <= 0.01) {
      await revokeAccessWithoutOtherGrant(conn, { tenantId, pay, actor });
      await rejectRetentionBonus(conn, { tenantId, paymentId: pay.id });
    }

    return {
      paymentId: pay.id, refundPaymentId: refundId, partial: true,
      refunded: refundedAmount, remaining: Math.round((refundable - refundedAmount) * 100) / 100,
      fullyRefunded: refundable - refundedAmount <= 0.01,
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
  await clawBackPaidCommission(conn, { tenantId, paymentId: pay.id, share: 1, actor, refundDate, reason });
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
  await rejectRetentionBonus(conn, { tenantId, paymentId: pay.id });

  await revokeAccessWithoutOtherGrant(conn, { tenantId, pay, actor });

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

module.exports = { applyRefundReversal, applyUnlinkedRefund };
