'use strict';

// The employee's own payslip, line by line (9 Nov 2026): «بعد ما المرتب يتعتمد من الإدارة الموظف يشوف كل التفاصيل — الأساسي، خصم التأخير، خصم الغياب والإجازات، الخصم
// الإداري، كل مكافأة بسببها (الروند الأول، الروند التاني، اليدوي)، والصافي». Pure: the route hands it the payroll item and the month's approved bonus rows.
//
// A bonus row written by the bonus plan (employee_bonuses.source 'BONUS_PLAN') carries what it was worked out from (calc_json): each round of a rep with its bookings
// and, when the owner set the round's figure, the reason; a collector's level. Whatever of the row's amount those lines do not explain (the course page's bonus, a
// total the owner set) is one more line with the row's own reason, so the lines always add up to the bonus on the payslip.

const money = value => Math.round((Number(value) || 0) * 100) / 100;
const ROUND_NAME = { 1: 'الأول', 2: 'التاني' };

const parseJson = value => {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
};

/** The lines of one approved bonus (type 'bonus') row. */
function linesOfBonus(row) {
  const amount = money(row.amount);
  const base = { id: row.id, currency: row.currency || 'EGP' };
  // 11 Nov 2026, the owner: the leave balance does not carry over — what is left at the year's end is paid, and the payslip names it (api/lib/leaveEncashment.js).
  if (row.source === 'LEAVE_ENCASHMENT') return [{ ...base, kind: 'leave_encashment', label: 'بدل رصيد الإجازات', amount, reason: row.reason || null }];
  if (row.source !== 'BONUS_PLAN') return [{ ...base, kind: 'manual', label: 'مكافأة', amount, reason: row.reason || null }];
  const calc = parseJson(row.calc_json) || {};
  const lines = [];
  const rounds = (calc.ladder && Array.isArray(calc.ladder.rounds)) ? calc.ladder.rounds : [];
  for (const [index, round] of rounds.entries()) {
    if (!(money(round.amount) > 0) && !round.override) continue;
    const split = rounds.length > 1;
    const bookings = `${Number(round.bookings) || 0} حجز`;
    lines.push({
      ...base, kind: 'round', round: round.round || index + 1,
      label: split ? `مكافأة الروند ${ROUND_NAME[round.round || index + 1] || index + 1} (${round.label})` : 'مكافأة الحجوزات (الشهر)',
      amount: money(round.amount),
      reason: round.override ? `${bookings} — اتعدلت من الإدارة: ${round.override.reason}` : bookings,
    });
  }
  if (calc.collection && money(calc.collection.amount) > 0) {
    lines.push({ ...base, kind: 'plan', label: 'مكافأة التحصيل', amount: money(calc.collection.amount), reason: `تحصيل ${money(calc.collection.collected)} ج.م` });
  }
  if (money(calc.deskBonus) > 0) lines.push({ ...base, kind: 'plan', label: 'مكافأة الحجوزات (الريسبشن)', amount: money(calc.deskBonus), reason: null });
  const rest = money(amount - lines.reduce((sum, line) => sum + line.amount, 0));
  if (Math.abs(rest) >= 0.01) lines.push({ ...base, kind: 'plan', label: lines.length ? 'مكافآت وتعديلات أخرى' : 'مكافأة الشهر', amount: rest, reason: row.reason || null });
  return lines;
}

/**
 * @param item   the payroll item { base_salary, total_allowances, commission, bonus, bonus_note, late_deductions, absence_deductions, advance_deductions, other_deductions, deductions_note, net_salary, calculation_details }
 * @param rows   the employee's APPROVED employee_bonuses of the month { id, type, amount, currency, reason, source, calc_json }
 */
function payslipBreakdown(item, rows, runStatus) {
  const calc = parseJson(item.calculation_details) || {};
  // The plan's lines first (the rounds in order), the ones typed by hand after.
  const bonusLines = rows.filter(row => row.type === 'bonus').sort((x, y) => Number(y.source === 'BONUS_PLAN') - Number(x.source === 'BONUS_PLAN')).flatMap(linesOfBonus);
  const deductionLines = rows.filter(row => row.type === 'deduction').map(row => ({ id: row.id, label: 'خصم إداري', amount: money(row.amount), reason: row.reason || null, currency: row.currency || 'EGP' }));
  // A bonus approved after the run was calculated is not in the payslip yet, and one the run took may have been changed since: the payslip's own total is the truth, so the
  // difference is said as a line rather than left out.
  const explainedBonus = money(bonusLines.reduce((sum, line) => sum + line.amount, 0));
  if (Math.abs(money(item.bonus) - explainedBonus) >= 0.01) {
    bonusLines.push({ id: null, kind: 'plan', label: 'مكافآت أخرى اتحسبت في المسير', amount: money(money(item.bonus) - explainedBonus), reason: item.bonus_note || null, currency: 'EGP' });
  }
  return {
    status: runStatus,
    base: money(item.base_salary), allowances: money(item.total_allowances), commission: money(item.commission), overtime: money(calc.overtimePay),
    // Teaching fees the run paid with the salary (approved instructor fees): without this line an instructor's payslip did not add up to its net.
    teachingFees: money(calc.instructorEarnings),
    bonus: money(item.bonus), bonusNote: item.bonus_note || null,
    lateDeduction: money(item.late_deductions), absenceDeduction: money(item.absence_deductions), advanceDeduction: money(item.advance_deductions),
    // Which advances this payslip took from and what is still owed on them afterwards (11 Nov 2026): the split the run recorded, in each advance's own currency.
    advances: (Array.isArray(calc.advances) ? calc.advances : []).filter(line => money(line.applied) > 0 || money(line.owedAfter) > 0).map(line => ({
      id: line.id, currency: line.currency || 'EGP', amount: money(line.amount), dueMonth: line.dueMonth || null, dueYear: line.dueYear || null,
      applied: money(line.applied), owedAfter: money(line.owedAfter),
    })),
    advanceOwedAfter: money(calc.advanceOwedAfter),
    // Joined or left during the month (11 Nov 2026): paid for the days he belonged to, «من يوم X» / «لحد يوم Y», with the pro-rated basic above and the whole month's behind it.
    proration: calc.proration && calc.proration.partial
      ? { paidDays: Number(calc.proration.paidDays) || 0, monthDays: Number(calc.proration.monthDays) || 30, fromDay: calc.proration.fromDay || null, toDay: calc.proration.toDay || null, fullBase: money(calc.proration.fullBase) }
      : null,
    // The manager's deductions (penalties); the rest of «other» is insurance and tax.
    administrativeDeduction: money(calc.deductionTotal),
    insuranceAndTax: money(Number(calc.dedSocial || 0) + Number(calc.dedTax || 0)),
    otherDeduction: money(item.other_deductions), deductionsNote: item.deductions_note || null,
    bonusLines, deductionLines,
    net: money(item.net_salary),
  };
}

module.exports = { payslipBreakdown, linesOfBonus };
