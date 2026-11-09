'use strict';

// What the screens show of a month's bonus, from the one computation (lib/monthlyBonuses.js computeMonthlyBonuses) so that the month sheet, the employee's page and
// the payroll all read the same figures (9 Nov 2026):
//
//   sheetFiguresOf     one employee's month for the payroll month sheet: each round with its bookings and bonus (the owner's figure beside the plan's), the total, the
//                      collector's level — the sheet writes «11 حجز → 1,000» from it
//   roundProgressOf    a rep's current round: its dates, the bookings counted so far (weighted), the next step and how many bookings reach it, the rounds already over
//
// Pure: they take the computation's result, so a route works the month out once for as many people as it answers.

const { ladderBonus } = require('./bonusPlan');

const round2 = value => Math.round((Number(value) || 0) * 100) / 100;

/** One round as the screens read it. */
const roundOf = round => ({
  round: round.round || 1, label: round.label, from: round.from || null, to: round.to || null,
  bookings: round.bookings, amount: round.amount, computedAmount: round.computedAmount ?? round.amount,
  override: round.override ? { id: round.override.id, amount: round.override.amount, reason: round.override.reason, by: round.override.by } : null,
});

/** The employee's month for the sheet; null for someone on no scheme. */
function sheetFiguresOf(employee) {
  if (!employee || employee.scheme === 'NONE') return null;
  return {
    scheme: employee.scheme, schemeLabel: employee.schemeLabel,
    rounds: employee.ladder ? employee.ladder.rounds.map(roundOf) : null,
    // The ladder is a month's (not half months') when it has one period only.
    halfMonths: Boolean(employee.ladder && employee.ladder.rounds.length > 1),
    splitDay: employee.splitDay, splitSource: employee.splitSource,
    collection: employee.collection ? { collected: employee.collection.collected, amount: employee.collection.amount, from: employee.collection.level ? employee.collection.level.from : null } : null,
    deskBonus: employee.deskBonus,
    computedTotal: employee.computedTotal, total: employee.total,
    totalOverride: employee.override ? { id: employee.override.id, amount: employee.override.amount, reason: employee.override.reason, by: employee.override.by } : null,
  };
}

/**
 * A rep's current round on `today` («YYYY-MM-DD», in the month the computation is for).
 * @returns {{ onRounds: false, scheme: string } | object}
 */
function roundProgressOf(result, staffId, today) {
  const employee = result.employees.find(item => item.staffId === staffId);
  if (!employee || employee.scheme !== 'SALES_BOOKINGS' || !employee.ladder) return { onRounds: false, scheme: employee ? employee.scheme : 'NONE' };
  const rounds = employee.ladder.rounds.map(roundOf);
  const index = Math.max(0, rounds.findIndex(item => today >= item.from && today <= item.to));
  const current = rounds[index];
  const firstTarget = employee.ladder.firstTarget;
  const steps = result.plan.bookingLadder.filter(tier => firstTarget == null || tier.bookings >= firstTarget);
  const nextStep = steps.find(tier => tier.bookings > current.bookings) || null;
  // Past the last step each booking adds the amount of the band it falls in.
  const nextBooking = nextStep ? null : round2(ladderBonus(result.plan, current.bookings + 1, firstTarget).amount - ladderBonus(result.plan, current.bookings, firstTarget).amount);
  const reached = ladderBonus(result.plan, current.bookings, firstTarget);
  return {
    onRounds: true, scheme: employee.scheme, month: `${result.year}-${String(result.month).padStart(2, '0')}`, today,
    halfMonths: rounds.length > 1, firstTarget,
    current: {
      ...current,
      stepReached: reached.tier ? { bookings: reached.tier.bookings, amount: reached.tier.amount } : null,
      nextStep: nextStep ? { bookings: nextStep.bookings, amount: nextStep.amount, remaining: round2(nextStep.bookings - current.bookings) } : null,
      nextBookingWorth: nextBooking,
    },
    // The rounds already over this month (round 1 once round 2 has begun), with what they paid.
    previous: rounds.slice(0, index),
    monthBookings: employee.ladder.bookings, monthTotal: employee.total,
  };
}

module.exports = { sheetFiguresOf, roundProgressOf };
