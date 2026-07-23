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

module.exports = { applyInstallmentPayment, removeInstallmentEntry, tryJsonArr };
