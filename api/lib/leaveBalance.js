'use strict';

// The employee's leave balance for a year: 21 days (the HR policy's annual_leave_days), of which one is the free day of every month. Three things spend it:
// an approved ANNUAL leave, a free day (attendance permit 'free_day', given by the policy or marked by HR) and an absence HR marks «من رصيد الإجازات»
// (permit 'leave_balance'). 3 Nov 2026: «واحسب رصيد اجازات 21 يوم لكل موظف منهم يوم اساسي كل شهر».

const BALANCE_PERMITS = ['free_day', 'leave_balance'];

/** @returns {Promise<Map<string, { entitlement: number, annualLeaveDays: number, freeDays: number, balanceDays: number, used: number, remaining: number }>>} */
async function leaveBalances(db, { tenantId, year, entitlement, staffIds = null }) {
  const scope = staffIds && staffIds.length ? ' AND staff_id IN (?)' : '';
  const scopeParams = staffIds && staffIds.length ? [staffIds] : [];
  const [annual] = await db.query(
    `SELECT staff_id, COALESCE(SUM(total_days), 0) AS days FROM leaves
      WHERE tenant_id=? AND type='ANNUAL' AND status='APPROVED' AND YEAR(start_date)=?${scope} GROUP BY staff_id`,
    [tenantId, year, ...scopeParams]);
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

module.exports = { leaveBalances, leaveBalanceOf, BALANCE_PERMITS };
