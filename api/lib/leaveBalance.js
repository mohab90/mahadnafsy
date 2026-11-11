'use strict';

// The employee's leave balance for a year: 21 days (the HR policy's annual_leave_days), of which one is the free day of every month. Three things spend it:
// an approved ANNUAL leave, a free day (attendance permit 'free_day', given by the policy or marked by HR) and an absence HR marks «من رصيد الإجازات»
// (permit 'leave_balance'). 3 Nov 2026: «واحسب رصيد اجازات 21 يوم لكل موظف منهم يوم اساسي كل شهر».

const { getEffectiveHrPolicy } = require('./hrPolicy');

const BALANCE_PERMITS = ['free_day', 'leave_balance'];

const dayText = value => String(value instanceof Date ? value.toISOString() : value || '').slice(0, 10);

/**
 * The days of a leave that fall in one calendar year (11 Nov 2026: a leave from 28 Dec to 4 Jan was counted whole in the year it started). A leave inside the year is its
 * own total_days; one that crosses a boundary counts its working days (weekly days off excluded, except maternity leave, as when the request was priced) in each year.
 */
function leaveDaysInYear({ type, start_date: startDate, end_date: endDate, total_days: totalDays }, year, weekendDays = [5]) {
  const start = dayText(startDate);
  const end = dayText(endDate);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (end < yearStart || start > yearEnd) return 0;
  if (start >= yearStart && end <= yearEnd) return Number(totalDays) || 0;
  const weekend = new Set(weekendDays.map(Number));
  let days = 0;
  const last = new Date(`${end < yearEnd ? end : yearEnd}T12:00:00Z`);
  for (const date = new Date(`${start > yearStart ? start : yearStart}T12:00:00Z`); date <= last; date.setUTCDate(date.getUTCDate() + 1)) {
    if (type === 'MATERNITY' || !weekend.has(date.getUTCDay())) days += 1;
  }
  return days;
}

/** @returns {Promise<Map<string, { entitlement: number, annualLeaveDays: number, freeDays: number, balanceDays: number, used: number, remaining: number }>>} */
async function leaveBalances(db, { tenantId, year, entitlement, staffIds = null }) {
  const scope = staffIds && staffIds.length ? ' AND staff_id IN (?)' : '';
  const scopeParams = staffIds && staffIds.length ? [staffIds] : [];
  // The annual leaves that touch the year, each counted for its days inside it.
  const weekendDays = (await getEffectiveHrPolicy(db, tenantId, `${year}-01-01`)).weekend_days_json;
  const [leaves] = await db.query(
    `SELECT staff_id, type, start_date, end_date, total_days FROM leaves
      WHERE tenant_id=? AND type='ANNUAL' AND status='APPROVED' AND start_date<=? AND end_date>=?${scope}`,
    [tenantId, `${year}-12-31`, `${year}-01-01`, ...scopeParams]);
  const annualDays = new Map();
  for (const leave of leaves) annualDays.set(leave.staff_id, (annualDays.get(leave.staff_id) || 0) + leaveDaysInYear(leave, year, weekendDays));
  const annual = [...annualDays].map(([staff_id, days]) => ({ staff_id, days }));
  const [marked] = await db.query(
    `SELECT staff_id, SUM(permit_used='free_day') AS free_days, SUM(permit_used='leave_balance') AS balance_days FROM attendance_logs
      WHERE tenant_id=? AND permit_used IN (?) AND YEAR(date)=?${scope} GROUP BY staff_id`,
    [tenantId, BALANCE_PERMITS, year, ...scopeParams]);
  const byStaff = new Map();
  const entry = staffId => {
    if (!byStaff.has(staffId)) byStaff.set(staffId, { entitlement, annualLeaveDays: 0, freeDays: 0, balanceDays: 0, used: 0, remaining: entitlement });
    return byStaff.get(staffId);
  };
  for (const row of annual) entry(row.staff_id).annualLeaveDays = Number(row.days) || 0;
  for (const row of marked) {
    const line = entry(row.staff_id);
    line.freeDays = Number(row.free_days) || 0;
    line.balanceDays = Number(row.balance_days) || 0;
  }
  for (const line of byStaff.values()) {
    line.used = line.annualLeaveDays + line.freeDays + line.balanceDays;
    line.remaining = Math.max(0, entitlement - line.used);
  }
  return byStaff;
}

/** The same for one employee, always answering (a person who never took a day has all of it). */
async function leaveBalanceOf(db, { tenantId, staffId, year, entitlement }) {
  const found = (await leaveBalances(db, { tenantId, year, entitlement, staffIds: [staffId] })).get(staffId);
  return found || { entitlement, annualLeaveDays: 0, freeDays: 0, balanceDays: 0, used: 0, remaining: entitlement };
}

module.exports = { leaveBalances, leaveBalanceOf, leaveDaysInYear, BALANCE_PERMITS };
