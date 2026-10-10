'use strict';
/**
 * Correcting a payment entered by mistake: «مش بقدر امسح دفعه لعميل ولما حبيت
 * اغيرها ضاف التغيير كانه دفعه جديدة … تغيير او مسح دفعه او تغيير كورس لازم يكون
 * من المدير فقط».
 *
 * There was no way to do either. The only delete refused any paid payment (the
 * books must keep its trace), and «changing» one meant recording it again, so
 * the client owed nothing and had paid twice.
 *
 * Voiding keeps the trace and undoes the effects, the way a refund does but
 * without money going back — because none really came in:
 *   - a journal entry reversing exactly the lines the payment posted,
 *   - its commission and instructor share cancelled (clawed back if paid),
 *   - the course closed again when nothing else pays for it,
 *   - the booking bonuses cancelled when it was the item's only payment,
 *   - the row archived (deleted_at) with who and why, in the payment audit.
 *
 * Editing changes the method, date, note and transaction number in place. A
 * different amount, currency or course is a different payment: the corrected
 * one is recorded through the same path as any payment (commission, books and
 * access follow it), then the old one is voided.
 *
 * Managers only: the owner, ADMIN and MANAGER (canCorrectPayments).
 */
const { pool } = require('./db');
const { postJournalEntry, logPaymentAudit, logFinancialAudit } = require('./finance');
const { assertWritable } = require('./periodLock');
const { dateOnlyInTimeZone } = require('./dates');
const { clawBackPaidCommission, rejectRetentionBonus, revokeAccessWithoutOtherGrant } = require('./refunds');

const CORRECTING_ROLES = new Set(['admin', 'manager']);

function canCorrectPayments(req) {
  return Boolean(req.isSuperAdmin || CORRECTING_ROLES.has(String(req.staffRecord?.role || '').toLowerCase()));
}

const refuse = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, code });

/** Void one payment inside the caller's transaction. */
async function voidPayment(conn, { tenantId, paymentId, actor, reason }) {
  const why = String(reason || '').trim().slice(0, 300);
  if (!why) throw refuse(400, 'اكتب سبب المسح', 'REASON_REQUIRED');
  const [[pay]] = await conn.query(
    `SELECT id, subscriber_id, course_id, bundle_id, amount, amount_egp, currency, payment_type, status,
            branch, branch_id, date
       FROM payments WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [paymentId, tenantId]);
  if (!pay) throw refuse(404, 'الدفعة مش موجودة أو اتمسحت قبل كده', 'NOT_FOUND');
  const status = String(pay.status || '').toLowerCase();
  if (status === 'refunded') throw refuse(409, 'الدفعة دي اتعملها استرداد — مينفعش تتمسح', 'REFUNDED');
  const [[refunded]] = await conn.query(
    `SELECT COUNT(*) AS n FROM refunds WHERE tenant_id=? AND payment_id=? AND status IN ('approved','done')`, [tenantId, paymentId])
    .catch(() => [[{ n: 0 }]]);
  if (Number(refunded.n) > 0) throw refuse(409, 'الدفعة دي عليها استرداد — اعمل الاسترداد بدل المسح', 'HAS_REFUND');

  const today = dateOnlyInTimeZone();
  const wasPaid = ['paid', 'confirmed'].includes(status);
  let journalId = null;
  if (wasPaid) {
    await assertWritable(today, conn, tenantId);
    // Exactly what the payment posted, the other way round.
    const [lines] = await conn.query(
      `SELECT jel.account_code, jel.account_name, jel.debit, jel.credit
         FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id = je.id
        WHERE je.tenant_id=? AND je.ref_type='payment' AND je.ref_id=?`, [tenantId, paymentId]);
    const [[alreadyVoided]] = await conn.query(
      "SELECT id FROM journal_entries WHERE tenant_id=? AND ref_type='payment_void' AND ref_id=? LIMIT 1", [tenantId, paymentId]);
    if (lines.length && !alreadyVoided) {
      journalId = await postJournalEntry('payment_void', paymentId, today,
        `إلغاء دفعة اتسجلت بالغلط ${pay.amount} ${pay.currency || 'EGP'} — ${why}`,
        lines.map(line => ({ account_code: line.account_code, account_name: line.account_name, debit: Number(line.credit), credit: Number(line.debit) })),
        actor, conn, tenantId, { branch: pay.branch || null, branchId: pay.branch_id || null });
      if (!journalId) throw new Error('void journal posting failed');
    }
    await conn.query(
      `UPDATE crm_commissions SET status='CANCELLED', note=CONCAT(COALESCE(note,''),' | اتلغت مع مسح الدفعة')
        WHERE payment_id=? AND tenant_id=? AND status IN ('PENDING','INCLUDED_IN_PAYROLL')`, [paymentId, tenantId]);
    await clawBackPaidCommission(conn, { tenantId, paymentId, share: 1, actor, refundDate: today, reason: why });
    await conn.query(
      `UPDATE instructor_fees SET status='rejected', note=CONCAT(COALESCE(note,''),' | اتلغت مع مسح الدفعة')
        WHERE source_payment_id=? AND tenant_id=? AND status IN ('pending','approved','included_in_payroll')`, [paymentId, tenantId]);
    await rejectRetentionBonus(conn, { tenantId, paymentId });
  }

  await conn.query(
    `UPDATE payments SET deleted_at=NOW(),
        note=CONCAT(COALESCE(note,''), IF(note IS NULL OR note='', '', ' | '), ?)
      WHERE id=? AND tenant_id=?`, [`اتمسحت بواسطة ${actor}: ${why}`.slice(0, 400), paymentId, tenantId]);
  await conn.query('UPDATE orders SET deleted_at=NOW() WHERE id=? AND tenant_id=? AND deleted_at IS NULL', [paymentId, tenantId]);
  // The transfer it was confirmed against is free again — it stayed «linked» to
  // a payment that no longer exists, and nothing else could use the money.
  await require('./incomingTransfers').releaseTransfer(conn, { tenantId, paymentId });

  if (wasPaid) {
    // After the row is archived, so it no longer counts as the course's grant.
    await revokeAccessWithoutOtherGrant(conn, { tenantId, pay, actor });
    const itemId = pay.bundle_id || pay.course_id;
    if (itemId) {
      const [[other]] = await conn.query(
        `SELECT id FROM payments WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND status IN ('paid','confirmed')
            AND (course_id=? OR bundle_id=?) LIMIT 1`, [tenantId, pay.subscriber_id, itemId, itemId]);
      if (!other) {
        // The booking bonuses were for booking this item; with no payment left, there is no booking.
        await conn.query(
          `UPDATE crm_commissions SET status='CANCELLED', note=CONCAT(COALESCE(note,''),' | اتلغت مع مسح الدفعة')
            WHERE tenant_id=? AND payment_id IN (?, ?) AND status IN ('PENDING','INCLUDED_IN_PAYROLL')`,
          [tenantId, `booking:sales:${pay.subscriber_id}:${itemId}`.slice(0, 100), `booking:service:${pay.subscriber_id}:${itemId}`.slice(0, 100)]);
        await conn.query(
          `UPDATE instructor_fees SET status='rejected' WHERE tenant_id=? AND source_key=? AND status IN ('pending','approved')`,
          [tenantId, `booking:${pay.subscriber_id}:${itemId}`]);
      }
    }
  }

  await logPaymentAudit(paymentId, 'void', pay.status, null, pay.amount, pay.subscriber_id, actor, tenantId, conn, true);
  await logFinancialAudit({
    entityType: 'payment', entityId: paymentId, action: 'void',
    oldData: { amount: Number(pay.amount), currency: pay.currency, status: pay.status, date: pay.date }, newData: { reason: why },
    amount: Number(pay.amount_egp) || Number(pay.amount) || 0, actor, tenantId, db: conn,
  }).catch(() => {});
  return { voided: true, journalId, subscriberId: pay.subscriber_id };
}

/** Method, date, note, transaction number — the parts of a payment that are not its money. */
async function editPaymentDetails(conn, { tenantId, paymentId, actor, reason, changes }) {
  const [[pay]] = await conn.query(
    `SELECT id, subscriber_id, payment_method, date, note, transaction_id, status, amount
       FROM payments WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [paymentId, tenantId]);
  if (!pay) throw refuse(404, 'الدفعة مش موجودة', 'NOT_FOUND');
  const sets = []; const params = []; const before = {}; const after = {};
  const put = (column, value) => { sets.push(`${column}=?`); params.push(value); before[column] = pay[column]; after[column] = value; };
  if (changes.paymentMethod !== undefined) put('payment_method', String(changes.paymentMethod || '').slice(0, 100) || null);
  if (changes.transactionId !== undefined) put('transaction_id', String(changes.transactionId || '').slice(0, 191) || null);
  if (changes.note !== undefined) put('note', String(changes.note || '').slice(0, 2000) || null);
  let newDate = null;
  if (changes.date !== undefined) {
    newDate = String(changes.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) throw refuse(400, 'التاريخ مش صحيح', 'BAD_DATE');
    const oldDate = dateOnlyInTimeZone(new Date(pay.date));
    if (newDate !== oldDate) {
      // Both periods have to be open: the money leaves one and lands in the other.
      await assertWritable(oldDate, conn, tenantId);
      await assertWritable(newDate, conn, tenantId);
      put('date', `${newDate} 12:00:00`);
    } else newDate = null;
  }
  if (!sets.length) return { changed: false };
  await conn.query(`UPDATE payments SET ${sets.join(', ')} WHERE id=? AND tenant_id=?`, [...params, paymentId, tenantId]);
  if (newDate) {
    await conn.query("UPDATE journal_entries SET entry_date=? WHERE tenant_id=? AND ref_type='payment' AND ref_id=?", [newDate, tenantId, paymentId]);
  }
  await logFinancialAudit({
    entityType: 'payment', entityId: paymentId, action: 'edit', oldData: before, newData: { ...after, reason: String(reason || '').slice(0, 300) },
    amount: Number(pay.amount) || 0, actor, tenantId, db: conn,
  }).catch(() => {});
  return { changed: true };
}

module.exports = { canCorrectPayments, voidPayment, editPaymentDetails };
