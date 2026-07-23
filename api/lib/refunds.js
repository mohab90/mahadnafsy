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
const { uuidv4 } = require('./id');
const { postJournalEntry, _paymentAccountCode, toEgp } = require('./finance');
const { assertWritable } = require('./periodLock');
const { logLeadEvent } = require('./crm');
const { notifyWaitlistForFreedSeats } = require('./courseWaitlist');

// Must run inside an existing transaction on `conn`. Call after the caller
// has already row-locked and updated the refund_requests row itself — this
// only handles the payment-side reversal. Returns { journalId, orderUpdated }
// or null if there was no linked payment to reverse.
async function applyRefundReversal({ paymentId, subscriberId, tenantId, actor }, conn) {
  if (!paymentId) return null;

  const [[pay]] = await conn.query(
    `SELECT id, subscriber_id, course_id, bundle_id, amount, amount_egp, currency, payment_type, status, transaction_id
       FROM payments WHERE id = ? AND tenant_id = ? ${subscriberId ? 'AND subscriber_id = ?' : ''} LIMIT 1 FOR UPDATE`,
    subscriberId ? [paymentId, tenantId, subscriberId] : [paymentId, tenantId]
  );
  if (!pay) return null;

  // Fail closed if this payment's date falls in a financially closed period —
  // every other write path that touches `payments` does this same check.
  await assertWritable(new Date().toISOString().slice(0, 10), conn, tenantId);

  await conn.query(
    `UPDATE payments SET status='refunded',
        note=CONCAT(COALESCE(note,''), IF(note IS NOT NULL AND note!='',' | ',''), 'Refunded by ', ?)
      WHERE id=? AND tenant_id=?`,
    [actor, pay.id, tenantId]
  );
  await conn.query(
    `INSERT INTO payment_audit_log (id, payment_id, action, old_status, new_status, amount, subscriber_id, actor)
     VALUES (?,?,?,?,?,?,?,?)`,
    [uuidv4(), pay.id, 'update', pay.status || null, 'refunded', pay.amount || null, pay.subscriber_id || null, actor]
  ).catch(() => {});
  await conn.query(
    `UPDATE crm_commissions SET status='CANCELLED', note=CONCAT(COALESCE(note,''),' | Cancelled because payment was refunded')
      WHERE payment_id=? AND tenant_id=? AND status IN ('PENDING','INCLUDED_IN_PAYROLL')`,
    [pay.id, tenantId]
  ).catch(() => {});

  if (pay.course_id || pay.bundle_id) {
    await conn.query(
      'DELETE FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND course_id<=>? AND bundle_id<=>? LIMIT 1',
      [tenantId, pay.subscriber_id, pay.course_id || null, pay.bundle_id || null]
    ).catch(() => {});
    // SUB-02: a refund frees a seat — auto-notify the waitlist instead of
    // leaving it to an admin to notice and trigger manually.
    if (pay.course_id) await notifyWaitlistForFreedSeats(tenantId, pay.course_id, conn).catch(() => {});
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
      'refund', pay.id, new Date().toISOString().slice(0, 10),
      `استرداد مبلغ ${amt} ${pay.currency || 'EGP'} (= ${amtEgp} EGP) — موافقة بواسطة ${actor}`,
      [
        { account_code: revCode, account_name: revName, debit: amtEgp, credit: 0 },
        { account_code: '1100', account_name: 'نقدية وبنوك', debit: 0, credit: amtEgp },
      ],
      actor, conn, tenantId
    );
    if (!journalId) throw new Error('Refund journal posting failed');
  }

  // Best-effort: a missing lead_id (no matching lead, or subscriber wasn't
  // converted from one) is normal, not an error — never let this block the
  // financial reversal that already committed above.
  try {
    const [[subRow]] = await conn.query('SELECT lead_id FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [pay.subscriber_id, tenantId]);
    if (subRow?.lead_id) {
      await logLeadEvent(subRow.lead_id, 'payment_refunded', `تم استرداد دفعة بمبلغ ${amt} ${pay.currency || 'EGP'} — بواسطة ${actor}`, { paymentId: pay.id }, tenantId, conn);
    }
  } catch { /* best-effort CRM trace, never blocks the refund */ }

  return { journalId, orderUpdated: orderUpdateResult.affectedRows > 0 };
}

module.exports = { applyRefundReversal };
