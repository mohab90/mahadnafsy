'use strict';

// A month's pay for someone who joined or left during it (11 Nov 2026, the owner: «الموظف بيتحاسب على الأيام اللي حضرها فقط»).
//
// He is paid for the calendar days of the month he belonged to: from his hire date (staff.hire_date) and up to his last working day (staff.termination_date, which the
// offboarding flow sets) — a thirtieth of the salary for each, capped at thirty, allowances pro-rated the same way. A month he belonged to from first to last day is a full
// month whatever its length (February included), as the 30-day rule always made it. The days outside his employment are not absences or lateness: attendance outside the
// window is not read. Someone with no hire date is paid the full month and named in the run's warnings.

const { PAY_MONTH_DAYS } = require('./payrollCalc');

const dayText = value => (value == null || value === '' ? null : String(value).slice(0, 10));
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * @param {{ hireDate?: string|null, terminationDate?: string|null, isActive?: boolean|number, year: number, month: number }} input
 * @returns {{ include: boolean, partial: boolean, noHireDate: boolean, monthDays: number, fromDay: number, toDay: number, fromDate: string, toDate: string, paidDays: number, factor: number, joinedInMonth: boolean, leftInMonth: boolean }}
 */
function employmentWindow({ hireDate, terminationDate, isActive = true, year, month }) {
  const monthDays = daysInMonth(year, month);
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const first = `${key}-01`;
  const last = `${key}-${String(monthDays).padStart(2, '0')}`;
  const hired = dayText(hireDate);
  let ended = dayText(terminationDate);
  // A leaving date older than the month on someone still active is a stale entry (rehired), not a leaving.
  if (ended && Number(isActive) === 1 && ended < first) ended = null;
  const result = { include: true, partial: false, noHireDate: !hired, monthDays, fromDay: 1, toDay: monthDays, fromDate: first, toDate: last, paidDays: PAY_MONTH_DAYS, factor: 1, joinedInMonth: false, leftInMonth: false };
  // Not yet hired at the month's end, or gone before it began: not in this month's run.
  if ((hired && hired > last) || (ended && ended < first)) return { ...result, include: false, paidDays: 0, factor: 0 };
  if (hired && hired > first) { result.fromDay = Number(hired.slice(8, 10)); result.fromDate = hired; result.joinedInMonth = true; }
  if (ended && ended < last) { result.toDay = Number(ended.slice(8, 10)); result.toDate = ended; result.leftInMonth = true; }
  result.partial = result.joinedInMonth || result.leftInMonth;
  if (result.partial) {
    result.paidDays = Math.max(0, Math.min(PAY_MONTH_DAYS, result.toDay - result.fromDay + 1));
    result.factor = result.paidDays / PAY_MONTH_DAYS;
  }
  return result;
}

module.exports = { employmentWindow };
