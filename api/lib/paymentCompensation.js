'use strict';

const { uuidv4 } = require('./id');
const { dateOnlyInTimeZone } = require('./dates');

function paymentPeriod(value) {
  const raw = String(value || '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (match) return { year: Number(match[1]), month: Number(match[2]) };
  const today = dateOnlyInTimeZone();
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

// Records sales commission and instructor revenue share from the immutable
// EGP snapshot written by postPaymentJournal(). It must run on the same
// transaction connection as the payment and ledger posting.
async function recordPaymentCompensation({ paymentId, tenantId, commissionStaffId = null, actor = 'system' }, db) {
  if (!paymentId || !tenantId || !db?.query) throw new Error('Payment compensation requires payment, tenant and transaction');
  const [[payment]] = await db.query(
    `SELECT p.id,p.subscriber_id,p.course_id,p.payment_type,p.amount,p.amount_egp,p.currency,
            p.is_installment,p.date,p.staff_id,p.branch_id,s.assigned_sales_id
       FROM payments p
       LEFT JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
      WHERE p.id=? AND p.tenant_id=? AND p.status IN ('paid','confirmed')
        AND p.deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [paymentId, tenantId],
  );
  if (!payment) throw new Error('Paid payment not found for compensation');
  const amountEgp = Number(payment.amount_egp);
  if (!Number.isFinite(amountEgp) || amountEgp <= 0) {
    throw new Error('Payment EGP snapshot is required before compensation');
  }
  const period = paymentPeriod(payment.date);
  const staffId = commissionStaffId || payment.assigned_sales_id || payment.staff_id || null;

  if (staffId) {
    const [[rule]] = await db.query(
      `SELECT id,percentage_value
         FROM commission_rules
        WHERE tenant_id=? AND is_active=1 AND calc_type='PERCENTAGE'
          AND (staff_id=? OR (staff_id IS NULL AND JSON_CONTAINS(
            COALESCE(apply_to_roles,'[]'),
            JSON_QUOTE((SELECT role FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1))
          )))
          AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
          AND (min_payment IS NULL OR min_payment<=?)
        ORDER BY staff_id DESC,priority ASC LIMIT 1`,
      [tenantId, staffId, staffId, tenantId, payment.date, payment.date, amountEgp],
    );
    let rate = Number(rule?.percentage_value) || 0;
    if (!rate) {
      const [[staff]] = await db.query(
        'SELECT commission_rate FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
        [staffId, tenantId],
      );
      rate = Number(staff?.commission_rate) || 0;
    }
    if (rate < 0 || rate > 100) throw new Error('Invalid staff commission rate');
    if (rate > 0) {
      const commissionAmount = Number((amountEgp * rate / 100).toFixed(2));
      await db.query(
        `INSERT INTO crm_commissions
           (id,tenant_id,branch_id,staff_id,payment_id,rule_id,client_id,client_type,
            payment_amount,commission_amount,calc_details,month,year,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',NOW())
         ON DUPLICATE KEY UPDATE commission_amount=VALUES(commission_amount),
           calc_details=VALUES(calc_details),rule_id=VALUES(rule_id)`,
        [
          uuidv4(), tenantId, payment.branch_id || 'branch-other', staffId, payment.id,
          rule?.id || null, payment.subscriber_id, 'subscriber', amountEgp, commissionAmount,
          JSON.stringify({
            rate, currency: 'EGP', originalAmount: Number(payment.amount),
            originalCurrency: payment.currency || 'EGP',
            isInstallment: Boolean(payment.is_installment),
          }),
          period.month, period.year,
        ],
      );
    }
  }

  if (String(payment.payment_type || '').toUpperCase() === 'COURSE' && payment.course_id) {
    const [[course]] = await db.query(
      `SELECT c.instructor_id,ir.revenue_share_pct
         FROM courses c
         LEFT JOIN instructor_rates ir ON ir.tenant_id=c.tenant_id AND ir.staff_id=c.instructor_id
        WHERE c.id=? AND c.tenant_id=? AND c.deleted_at IS NULL LIMIT 1`,
      [payment.course_id, tenantId],
    );
    const share = Number(course?.revenue_share_pct) || 0;
    if (share < 0 || share > 100) throw new Error('Invalid instructor revenue share');
    if (course?.instructor_id && share > 0) {
      const fee = Number((amountEgp * share / 100).toFixed(2));
      await db.query(
        `INSERT INTO instructor_fees
           (id,tenant_id,staff_id,course_id,source_payment_id,fee_type,fixed_amount,total_amount,
            currency,period_month,period_year,note,created_by)
         VALUES (?,?,?,?,?,'fixed',?,?, 'EGP',?,?,?,?)
         ON DUPLICATE KEY UPDATE total_amount=VALUES(total_amount),
           fixed_amount=VALUES(fixed_amount),note=VALUES(note)`,
        [
          uuidv4(), tenantId, course.instructor_id, payment.course_id, payment.id,
          fee, fee, period.month, period.year,
          `حصة تلقائية ${share}% من دفعة ${payment.id}`, actor,
        ],
      );
    }
  }
}

module.exports = { paymentPeriod, recordPaymentCompensation };
