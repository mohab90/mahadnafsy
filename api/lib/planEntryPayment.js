'use strict';

// One scheduled instalment of an installment plan, paid by the client from their
// own dashboard — by card (Paymob) or by an uploaded transfer receipt.
//
// The second and third instalments could only be paid by writing to the
// institute on WhatsApp and waiting for the desk to record them. The client now
// opens an order for exactly one entry of their plan (routes/me-installments.js);
// the order says which entry in its notes — { payMode: 'plan_entry', planId,
// entryIndex } — and its amount is what that entry still owes, decided here from
// the plan, never from the browser. When the order is paid (lib/paymobFinalise.js
// or the receipt approval in routes/payment-proofs.js) settlePlanEntry marks the
// entry paid, the way the desk's «تسجيل قسط» does (routes/installments.js).

const { applyInstallmentPayment, tryJsonArr } = require('./installmentMath');
const { resolvePaymentAccess, accessModeOf, paidRatioOf } = require('./paymentEntitlementAccess');
const { grantCourseEntitlement } = require('./entitlements');
const { branchIdForBranch } = require('./branches');
const logger = require('./logger').child({ module: 'plan-entry-payment' });

const PLAN_ENTRY_MODE = 'plan_entry';

/** The plan entry an order pays, from its notes, or null for any other order. */
function planEntryOf(notes) {
  let parsed = notes;
  if (typeof notes === 'string') { try { parsed = JSON.parse(notes || '{}'); } catch { parsed = {}; } }
  if (!parsed || parsed.payMode !== PLAN_ENTRY_MODE || !parsed.planId) return null;
  const index = Number(parsed.entryIndex);
  return Number.isInteger(index) && index >= 0 ? { planId: String(parsed.planId), index } : null;
}

/**
 * What one entry still owes: its scheduled amount less what came in against it
 * already (a part paid at the desk). Throws { statusCode } when it owes nothing
 * or is not an entry of the plan.
 */
function entryDue(plan, index) {
  const amounts = tryJsonArr(plan.installment_amounts);
  const paidDates = tryJsonArr(plan.paid_dates);
  const paidAmounts = tryJsonArr(plan.paid_amounts);
  if (!Number.isInteger(index) || index < 0 || index >= amounts.length) {
    throw Object.assign(new Error('القسط ده مش موجود في خطتك'), { statusCode: 404, code: 'ENTRY_NOT_FOUND' });
  }
  if (paidDates[index]) {
    throw Object.assign(new Error('القسط ده مدفوع خلاص'), { statusCode: 409, code: 'ENTRY_ALREADY_PAID' });
  }
  const scheduled = Number(amounts[index]) || 0;
  const due = Math.round((scheduled - (Number(paidAmounts[index]) || 0)) * 100) / 100;
  if (!(due > 0)) {
    throw Object.assign(new Error('القسط ده مدفوع خلاص'), { statusCode: 409, code: 'ENTRY_ALREADY_PAID' });
  }
  return { amount: due, scheduled, currency: String(plan.currency || 'EGP').toUpperCase() };
}

/** The first entry still open at or after `index` — where money for a settled entry goes instead. */
function openEntryFrom(plan, index) {
  const amounts = tryJsonArr(plan.installment_amounts);
  const paidDates = tryJsonArr(plan.paid_dates);
  const order = [...amounts.keys()].filter(i => i >= index).concat([...amounts.keys()].filter(i => i < index));
  return order.find(i => !paidDates[i]) ?? null;
}

/**
 * Inside the payment's transaction, before its payments row is written: the plan
 * locked, the entry marked paid (or the money added to it, when it covers only
 * part), and what the payments row and the grant need back.
 *
 * Money that arrives for an entry the desk settled meanwhile goes to the plan's
 * next open entry; with none left it stays a payment on the course and the plan
 * is left alone — it was captured, so it is recorded, and the desk refunds it.
 * Refusing would only have the gateway send the same capture again forever.
 *
 * @returns {{ plan, update|null, courseExpected, payType, courseIds, index|null }}
 */
async function settlePlanEntry(conn, { tenantId, planId, index, subscriberId, paymentId, amount, currency, paidDay }) {
  const [[plan]] = await conn.query(
    `SELECT ip.*, s.branch, s.branch_id
       FROM installment_plans ip JOIN subscribers s ON s.id=ip.subscriber_id AND s.tenant_id=ip.tenant_id
      WHERE ip.id=? AND ip.tenant_id=? LIMIT 1 FOR UPDATE`,
    [planId, tenantId]
  );
  if (!plan) throw Object.assign(new Error('Installment plan not found'), { statusCode: 404 });
  // The order was opened by the plan's own client (routes/me-installments.js); a
  // payment for someone else's plan is not credited to it.
  if (subscriberId && String(plan.subscriber_id) !== String(subscriberId)) {
    throw Object.assign(new Error('Installment plan belongs to another client'), { statusCode: 403 });
  }
  if (String(plan.currency || 'EGP').toUpperCase() !== String(currency || 'EGP').toUpperCase()) {
    throw Object.assign(new Error('Installment currency changed'), { statusCode: 409 });
  }
  // The agreed price, as the desk's instalment records it (routes/installments.js):
  // a booking's price when one is on file, else the plan's total.
  const [[agreed]] = await conn.query(
    `SELECT MAX(course_expected) AS expected FROM payments
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND status='paid'
        AND course_id <=> ? AND bundle_id <=> ? AND course_expected > 0`,
    [tenantId, plan.subscriber_id, plan.course_id || null, plan.bundle_id || null]
  );
  const courseExpected = Number(agreed?.expected) > 0 ? Number(agreed.expected) : Number(plan.total_amount);
  const payType = plan.course_id ? 'COURSE' : (plan.bundle_id ? 'BUNDLE' : 'OTHER');
  const courseIds = plan.course_id ? [plan.course_id] : [];
  if (plan.bundle_id) {
    const [rows] = await conn.query('SELECT course_id FROM bundle_courses WHERE tenant_id=? AND bundle_id=?', [tenantId, plan.bundle_id]);
    courseIds.push(...rows.map(row => row.course_id));
  }

  const target = openEntryFrom(plan, index);
  let update = null;
  if (target !== null) {
    update = applyInstallmentPayment(plan, { index: target, paidAmount: Number(amount), paidDate: paidDay, paymentId });
    await conn.query(
      `UPDATE installment_plans SET paid_dates=?, payment_ids=?, paid_amounts=?, paid_count=?, status=?
        WHERE id=? AND tenant_id=?`,
      [JSON.stringify(update.paidDates), JSON.stringify(update.paymentIds), JSON.stringify(update.paidAmounts),
       update.paidCount, update.status, planId, tenantId]
    );
    if (target !== index) logger.warn('instalment paid after the desk settled it — applied to the next open one', { planId, index, target, paymentId });
  } else {
    logger.warn('instalment paid on a plan with nothing left open — recorded on the course only', { planId, index, paymentId });
  }
  return { plan, update, courseExpected, payType, courseIds: [...new Set(courseIds)], index: target };
}

/**
 * The lectures the payment opens, by the rule every instalment follows: the share
 * of the agreed price paid so far, the whole course once it is covered. Called
 * after the payments row exists.
 */
async function grantPlanEntryAccess(conn, { tenantId, settled, subscriberId, paymentId, amount, currency, source, actor }) {
  const { plan, courseExpected, courseIds } = settled;
  if (!courseIds.length) return null;
  let access;
  try {
    access = await resolvePaymentAccess({
      db: conn, tenantId, subscriberId,
      courseId: plan.course_id || null, bundleId: plan.bundle_id || null,
      currentPaymentId: paymentId, currentAmount: amount, currency, expectedAmount: courseExpected,
    });
  } catch (error) {
    // Mixed currencies or prices on the course: the money is recorded and the
    // desk sets the access, as it does for the same instalment paid in person.
    logger.warn('access left unchanged', { planId: plan.id, code: error.code || error.message });
    return null;
  }
  for (const courseId of courseIds) {
    await grantCourseEntitlement({
      tenantId, subscriberId, courseId, bundleId: plan.bundle_id || null,
      accessType: accessModeOf(access), lectureLimit: null, paidRatio: paidRatioOf(access),
      branchId: plan.branch_id || branchIdForBranch(plan.branch), source, actor,
    }, conn);
  }
  return access;
}

/** A payments-row note for an instalment paid this way. */
function planEntryNote(settled, requestedIndex) {
  const count = tryJsonArr(settled.plan.installment_amounts).length;
  const entry = settled.index === null ? requestedIndex : settled.index;
  const part = settled.update?.partial ? `جزء من القسط (الباقي ${settled.update.remaining}) — ` : '';
  return `${part}قسط رقم ${entry + 1} من ${count} — خطة ${settled.plan.title || settled.plan.id} (دفعه العميل من حسابه)`;
}

module.exports = { PLAN_ENTRY_MODE, planEntryOf, entryDue, openEntryFrom, settlePlanEntry, grantPlanEntryAccess, planEntryNote };
