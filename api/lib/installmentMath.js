'use strict';
/**
 * Pure logic for confirming one installment-plan entry as paid — no DB
 * calls, so it's trivially unit-testable. Used by routes/installments.js.
 */
function tryJsonArr(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch { return []; }
}

// installment_plans stores one plan as parallel JSON arrays. Everything that
// reads a plan has to walk them in step; this is that walk, in the shape both
// dashboards declare. Kept here so the customer's view of a plan and the
// admin's are computed from one place.
function planEntries(plan) {
  const amounts = tryJsonArr(plan.installment_amounts);
  const dueDates = tryJsonArr(plan.due_dates);
  const paidDates = tryJsonArr(plan.paid_dates);
  const paidAmounts = tryJsonArr(plan.paid_amounts);
  const count = Number(plan.installments_count) || dueDates.length;
  const fallback = count > 0 ? (Number(plan.total_amount) || 0) / count : 0;
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (!dueDates[i]) continue;
    entries.push({
      id: `${plan.id}-${i + 1}`,
      amount: Number(amounts[i] ?? fallback) || 0,
      currency: plan.currency || 'EGP',
      dueDate: String(dueDates[i]).slice(0, 10),
      paidAt: paidDates[i] ? String(paidDates[i]).slice(0, 10) : undefined,
      paidAmount: paidDates[i] && paidAmounts[i] != null ? Number(paidAmounts[i]) : undefined,
    });
  }
  return entries;
}

function mapInstallmentPlan(plan) {
  return {
    id: plan.id,
    courseId: plan.course_id || undefined,
    courseTitle: plan.course_title || plan.title || undefined,
    totalAmount: Number(plan.total_amount) || 0,
    currency: plan.currency || 'EGP',
    entries: planEntries(plan),
    notes: plan.notes || undefined,
    createdAt: plan.created_at,
  };
}

// Throws a { statusCode } error for invalid input, otherwise returns the new
// column values to persist plus a summary of what happened.
function applyInstallmentPayment(plan, { index, paidAmount, paidDate, paymentId }) {
  if (!Number.isInteger(index) || index < 0) {
    const e = new Error('Invalid entry index'); e.statusCode = 400; throw e;
  }
  if (!paidAmount || paidAmount <= 0) {
    const e = new Error('amount must be positive'); e.statusCode = 400; throw e;
  }

  const amounts = tryJsonArr(plan.installment_amounts);
  const dueDates = tryJsonArr(plan.due_dates);
  const paidDates = tryJsonArr(plan.paid_dates);
  const paymentIds = tryJsonArr(plan.payment_ids);
  const paidAmounts = tryJsonArr(plan.paid_amounts);

  if (index >= amounts.length) {
    const e = new Error('Entry index out of range'); e.statusCode = 400; throw e;
  }
  if (paidDates[index]) {
    const e = new Error('This installment is already paid'); e.statusCode = 409; throw e;
  }

  paidDates[index] = paidDate;
  paymentIds[index] = paymentId;
  paidAmounts[index] = paidAmount;
  const paidCount = paidDates.filter(Boolean).length;
  const status = paidCount >= amounts.length ? 'completed' : 'active';

  return {
    installmentAmounts: amounts, dueDates, paidDates, paymentIds, paidAmounts,
    paidCount, status, scheduledAmount: amounts[index],
  };
}

// Removes one not-yet-paid scheduled entry (e.g. the admin over-scheduled).
// Refuses to touch an entry that's already been paid — that would silently
// detach a real payments row from its plan's schedule.
function removeInstallmentEntry(plan, { index }) {
  if (!Number.isInteger(index) || index < 0) {
    const e = new Error('Invalid entry index'); e.statusCode = 400; throw e;
  }
  const amounts = tryJsonArr(plan.installment_amounts);
  const dueDates = tryJsonArr(plan.due_dates);
  const paidDates = tryJsonArr(plan.paid_dates);
  const paymentIds = tryJsonArr(plan.payment_ids);
  const paidAmounts = tryJsonArr(plan.paid_amounts);

  if (index >= amounts.length) {
    const e = new Error('Entry index out of range'); e.statusCode = 400; throw e;
  }
  if (paidDates[index]) {
    const e = new Error('Cannot remove an entry that has already been paid'); e.statusCode = 409; throw e;
  }

  amounts.splice(index, 1);
  dueDates.splice(index, 1);
  paidDates.splice(index, 1);
  paymentIds.splice(index, 1);
  paidAmounts.splice(index, 1);
  const totalAmount = amounts.reduce((sum, a) => sum + (Number(a) || 0), 0);

  return {
    installmentAmounts: amounts, dueDates, paidDates, paymentIds, paidAmounts,
    installmentsCount: amounts.length, totalAmount,
  };
}

module.exports = { applyInstallmentPayment, removeInstallmentEntry, tryJsonArr, planEntries, mapInstallmentPlan };
