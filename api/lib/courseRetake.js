'use strict';

// «إعادة»: a client takes a course they took before, again, at 50% off.
//
// «في زر حجز وادفع محتاجين نضيف بجانب جديد وقسط وتكملة زر اسمه إعادة، ودا بيخلي العميل يعيد
// نفس كورس واحده قبل كدا بخصم 50%» (14 Oct 2026). The price is the course's list price in the
// payment's currency, halved — read here from the catalogue, never from the caller — and it is
// ADDED to what the client agreed for that course, so the retake is chased by the collections
// list like any other remainder, and the course's lectures stay open (the client already holds it).
//
// Two rules keep the books honest:
//   · the client must have taken the course (an enrolment, a completion, or money paid for it);
//   · the first run must be paid up — a retake on a course with a remainder would bury it.

const { agreedPrice } = require('./agreedPrice');
const { resolveCatalogPrice } = require('./catalogPrice');

const RETAKE_PERCENT_OFF = 50;
const TOLERANCE = 1;

const refusal = (status, code, error) => ({ ok: false, status, code, error });

/**
 * @returns {Promise<{ok: true, half: number, expected: number, note: string} | {ok: false, status: number, code: string, error: string}>}
 */
async function planRetake(db, { tenantId, subscriberId, courseId, currency = 'EGP', amount }) {
  if (!subscriberId || !courseId) return refusal(400, 'RETAKE_NEEDS_COURSE', 'اختار الكورس اللي العميل هيعيده.');
  const [[enrolled]] = await db.query(
    `SELECT 1 AS ok FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND course_id=? AND status IN ('active','completed') LIMIT 1`,
    [tenantId, subscriberId, courseId]);
  // A finished course counts too: its certificate is issued, whether or not an enrolment row is left.
  const [[completed]] = await db.query(
    `SELECT 1 AS ok FROM course_completions WHERE tenant_id=? AND subscriber_id=? AND course_id=? AND status='active' LIMIT 1`,
    [tenantId, subscriberId, courseId]);
  // Taken, in any currency; what is paid and agreed is read in the retake's own.
  const [[paidFor]] = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN status='paid' AND currency=? THEN amount ELSE 0 END), 0) AS paid, COUNT(*) AS rows_count FROM payments
      WHERE tenant_id=? AND subscriber_id=? AND course_id=? AND deleted_at IS NULL AND payment_type='COURSE'`,
    [currency, tenantId, subscriberId, courseId]);
  if (!enrolled && !completed && !Number(paidFor?.rows_count)) {
    return refusal(409, 'RETAKE_NOT_TAKEN', 'العميل ماخدش الكورس ده قبل كده — الإعادة للكورس اللي خلّصه بس. اختار «حجز جديد».');
  }
  const list = await resolveCatalogPrice(db, { type: 'course', itemId: courseId, currency, tenantId }).catch(() => null);
  const half = Math.round((Number(list) || 0) * (100 - RETAKE_PERCENT_OFF) / 100);
  if (!(half > 0)) return refusal(400, 'RETAKE_NO_PRICE', `الكورس ده مالوش سعر بالـ${currency} — حط سعره من صفحة الكورس الأول.`);
  const agreed = Number(await agreedPrice(db, { tenantId, subscriberId, courseId, currency }).catch(() => null)) || 0;
  const paid = Number(paidFor?.paid) || 0;
  const remaining = agreed - paid;
  if (remaining > TOLERANCE) {
    return refusal(409, 'RETAKE_PREVIOUS_UNPAID', `العميل لسه عليه متبقي ${Math.round(remaining).toLocaleString('en-US')} ${currency} في الكورس ده — اقفله الأول قبل الإعادة.`);
  }
  if (Number(amount) > half + TOLERANCE) {
    return refusal(400, 'RETAKE_AMOUNT_TOO_HIGH', `سعر الإعادة ${half.toLocaleString('en-US')} ${currency} (خصم ${RETAKE_PERCENT_OFF}%) — المبلغ أكبر منه.`);
  }
  return {
    ok: true,
    half,
    // What the client now owes for the course: what it was, and the retake on top.
    expected: Math.max(agreed, paid) + half,
    note: `إعادة كورس بخصم ${RETAKE_PERCENT_OFF}% (سعر الإعادة ${half} ${currency})`,
  };
}

module.exports = { planRetake, RETAKE_PERCENT_OFF };
