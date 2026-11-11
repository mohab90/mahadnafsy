'use strict';

// A month of fingerprint punches → each working day's attendance, under the
// company's policy (hr_policy_versions, migration 243):
//
//   • weekly days off (Friday)              → not a working day; worked (punches on it) → overtime, at the policy's
//                                             weekend_overtime_days (1, 1.5, 2 …) a day, which HR can change per day
//   • working day 11:00–18:30               → lateness is minutes after the
//                                             start, early leave minutes before
//                                             the end
//   • lateness tiers: >5 min ¼ day (2 h of the 8), >30 ½ (4 h), >130 a whole day (and the same
//     tiers for leaving early, unless the policy turns that off)
//   • a monthly morning permission (arrive up to 2 h late) and evening one
//     (leave up to 1.5 h early): any HR approved as LATE_PERMIT / EARLY_LEAVE
//     are honoured, and what is left of the month's allowance is spent by the
//     system on the days where it saves the most
//   • no punch on a working day             → ABSENT (payroll deducts the day)
//   • one punch only                        → present, flagged for HR, no
//                                             deduction guessed
//   • free days: an employee who has worked the policy's months (six) gets one
//     paid day off a month (editable, per employee too); it is spent on the
//     month's first absent working day(s), which then cost nothing
//
// Pure: no database. lib/attendanceImport.js feeds it and writes the result.

const { UNEXCUSED_ABSENCE_DAYS } = require('./payrollCalc');

const DEFAULT_TIERS = Object.freeze([
  { over: 5, days: 0.25 }, { over: 30, days: 0.5 }, { over: 130, days: 1 },
]);

const toMinutes = value => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const toHHMM = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function parseTiers(value) {
  let tiers = value;
  try { if (typeof value === 'string') tiers = JSON.parse(value); } catch { tiers = null; }
  if (!Array.isArray(tiers)) return [...DEFAULT_TIERS];
  return tiers
    .map(t => ({ over: Number(t.over), days: Number(t.days) }))
    .filter(t => Number.isFinite(t.over) && t.over >= 0 && Number.isFinite(t.days) && t.days > 0 && t.days <= 1)
    .sort((a, b) => a.over - b.over);
}

/** The policy row (or DEFAULT_POLICY) in the shape the engine reads. */
function normalizePolicy(policy = {}) {
  const weekend = Array.isArray(policy.weekend_days_json) ? policy.weekend_days_json
    : (() => { try { return JSON.parse(policy.weekend_days_json); } catch { return [5]; } })();
  return {
    start: toMinutes(policy.work_start_time) ?? toMinutes('11:00'),
    end: toMinutes(policy.work_end_time) ?? toMinutes('18:30'),
    weekend: new Set((Array.isArray(weekend) ? weekend : [5]).map(Number)),
    morningPermit: Number(policy.morning_permit_minutes ?? 120),
    eveningPermit: Number(policy.evening_permit_minutes ?? 90),
    morningPerMonth: Number(policy.morning_permits_per_month ?? 1),
    eveningPerMonth: Number(policy.evening_permits_per_month ?? 1),
    tiers: parseTiers(policy.late_tiers_json ?? DEFAULT_TIERS),
    earlyTiered: policy.early_leave_tiered === undefined ? true : Boolean(Number(policy.early_leave_tiered)),
    freeDays: Number(policy.free_day_per_month ?? 1),
    freeAfterMonths: Number(policy.free_day_after_months ?? 6),
    // A weekly day off that was worked is overtime worth this many days' pay (8 Nov 2026: «بيوم ولا يوم ونص ولا يومين»).
    weekendOvertimeDays: Number(policy.weekend_overtime_days ?? 1),
  };
}

/** The fraction of a day the minutes cost: the highest tier they pass. */
function tierDays(minutes, tiers) {
  let days = 0;
  for (const tier of tiers) if (minutes > tier.over) days = tier.days;
  return days;
}

/**
 * The free days an employee has in `month`: their own number when HR set one, else the policy's once they have worked the policy's months
 * (hired on or before the same day-of-month that many months before the month's last day). No hire date = not eligible until HR sets a number.
 */
function freeDaysFor({ policy, month, hired = null, override = null }) {
  if (override !== null && override !== undefined && override !== '' && Number.isFinite(Number(override))) return Math.max(0, Math.floor(Number(override)));
  const p = normalizePolicy(policy);
  if (!hired || !p.freeDays) return 0;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0));
  // The same day-of-month N months earlier, held to that month's last day (31 Oct − 6 months = 30 Apr, not 1 May).
  const earlier = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth() - p.freeAfterMonths, 1));
  const needed = new Date(Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), Math.min(lastDay.getUTCDate(), new Date(Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth() + 1, 0)).getUTCDate())));
  return String(hired).slice(0, 10) <= needed.toISOString().slice(0, 10) ? p.freeDays : 0;
}

/** Every date of the month, as YYYY-MM-DD, with its weekday (0 = Sunday). */
function monthDates(month) {
  const [y, m] = month.split('-').map(Number);
  const out = [];
  for (let d = new Date(Date.UTC(y, m - 1, 1)); d.getUTCMonth() === m - 1; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push({ date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() });
  }
  return out;
}

/**
 * @param {object} args
 *   policy          hr policy row
 *   month           'YYYY-MM'
 *   punches         { 'YYYY-MM-DD': ['HH:MM', …] } for one employee
 *   approvedPermits [{ date, type: 'LATE_PERMIT'|'EARLY_LEAVE', startTime, endTime }]
 *   skipDates       Set of dates that are already decided (approved leave, manual entry)
 *   firstDate       first date to judge (hire date); lastDate last one (today)
 *   freeDays        free days the employee has this month (freeDaysFor), less any already given by hand
 * @returns {{ days: object[], summary: object }}
 */
function evaluateMonth({ policy, month, punches = {}, approvedPermits = [], skipDates = new Set(), firstDate = null, lastDate = null, freeDays = 0 }) {
  const p = normalizePolicy(policy);
  const permitsOn = new Map();
  for (const permit of approvedPermits) {
    const window = (toMinutes(permit.endTime) ?? 0) - (toMinutes(permit.startTime) ?? 0);
    permitsOn.set(`${permit.date}|${permit.type}`, window > 0 ? window
      : (permit.type === 'LATE_PERMIT' ? p.morningPermit : p.eveningPermit));
  }
  const days = [];
  const overtime = [];
  for (const { date, weekday } of monthDates(month)) {
    if (skipDates.has(date)) continue;
    if (firstDate && date < firstDate) continue;
    if (lastDate && date > lastDate) continue;
    const times = [...new Set((punches[date] || []).map(toMinutes).filter(v => v !== null))].sort((a, b) => a - b);
    // A weekly day off is no working day: nobody is absent or late on it. Punched on, it was worked: overtime, judged no further.
    if (p.weekend.has(weekday)) {
      if (times.length) {
        overtime.push({
          date, status: 'PRESENT', checkIn: times.length >= 2 ? times[0] : null, checkOut: times.length >= 2 ? times[times.length - 1] : (times.length ? times[0] : null),
          lateMinutes: 0, earlyLeaveMinutes: 0, permit: null, deductionDays: 0, punches: times.map(toHHMM),
          flag: times.length === 1 ? 'single_punch' : null, overtimeDays: p.weekendOvertimeDays,
        });
      }
      continue;
    }
    const day = {
      date, status: 'ABSENT', checkIn: null, checkOut: null, lateMinutes: 0, earlyLeaveMinutes: 0,
      permit: null, deductionDays: 0, punches: times.map(toHHMM), flag: null,
    };
    if (times.length >= 2) {
      day.checkIn = times[0];
      day.checkOut = times[times.length - 1];
      day.lateMinutes = Math.max(0, day.checkIn - p.start);
      day.earlyLeaveMinutes = Math.max(0, p.end - day.checkOut);
      day.status = 'PRESENT';
    } else if (times.length === 1) {
      // One punch: which one is unknowable for certain, so nothing is deducted
      // and HR is told. Before the middle of the day it reads as the arrival.
      const middle = (p.start + p.end) / 2;
      if (times[0] <= middle) { day.checkIn = times[0]; day.lateMinutes = Math.max(0, times[0] - p.start); day.flag = 'missing_check_out'; }
      else { day.checkOut = times[0]; day.flag = 'missing_check_in'; }
      day.status = 'PRESENT';
    }
    // Approved permits are honoured whatever the allowance says: HR said yes.
    const lateCredit = permitsOn.get(`${date}|LATE_PERMIT`) || 0;
    const earlyCredit = permitsOn.get(`${date}|EARLY_LEAVE`) || 0;
    day.approvedLate = lateCredit;
    day.approvedEarly = earlyCredit;
    if (lateCredit) day.permit = 'morning_approved';
    if (earlyCredit) day.permit = day.permit ? 'both_approved' : 'evening_approved';
    days.push(day);
  }

  // The free days are spent on the first absences of the month: those days are paid.
  let freeLeft = Math.max(0, Math.floor(Number(freeDays) || 0));
  for (const d of days) {
    if (freeLeft && d.status === 'ABSENT') { d.status = 'HOLIDAY'; d.permit = 'free_day'; freeLeft -= 1; }
  }

  const judged = days.filter(d => d.status !== 'ABSENT' && d.status !== 'HOLIDAY' && !d.flag);
  const deduction = (late, early) => Math.min(1, tierDays(late, p.tiers) + (p.earlyTiered ? tierDays(early, p.tiers) : 0));
  const effLate = d => Math.max(0, d.lateMinutes - d.approvedLate - (d.autoLate || 0));
  const effEarly = d => Math.max(0, d.earlyLeaveMinutes - d.approvedEarly - (d.autoEarly || 0));

  // Spend what is left of the month's allowance where it saves the most; a
  // tie goes to the earlier day.
  const spend = (kind, perMonth, permitMinutes) => {
    const approvedCount = days.filter(d => (kind === 'late' ? d.approvedLate : d.approvedEarly) > 0).length;
    let left = Math.max(0, perMonth - approvedCount);
    if (!left || !permitMinutes) return;
    const saving = d => {
      const before = deduction(effLate(d), effEarly(d));
      if (kind === 'late') d.autoLate = permitMinutes; else d.autoEarly = permitMinutes;
      const after = deduction(effLate(d), effEarly(d));
      if (kind === 'late') d.autoLate = 0; else d.autoEarly = 0;
      return before - after;
    };
    const candidates = judged
      .filter(d => (kind === 'late' ? d.lateMinutes > d.approvedLate : d.earlyLeaveMinutes > d.approvedEarly))
      .map(d => ({ d, save: saving(d) }))
      .filter(c => c.save > 0)
      .sort((a, b) => b.save - a.save || a.d.date.localeCompare(b.d.date));
    for (const { d } of candidates) {
      if (!left) break;
      if (kind === 'late') { d.autoLate = permitMinutes; d.permit = d.permit ? `${d.permit}+morning` : 'morning'; }
      else { d.autoEarly = permitMinutes; d.permit = d.permit ? `${d.permit}+evening` : 'evening'; }
      left -= 1;
    }
  };
  spend('late', p.morningPerMonth, p.morningPermit);
  spend('early', p.eveningPerMonth, p.eveningPermit);

  for (const d of days) {
    if (d.status === 'ABSENT' || d.status === 'HOLIDAY') continue;
    if (d.flag) { d.deductionDays = 0; continue; }
    d.deductionDays = deduction(effLate(d), effEarly(d));
    d.effectiveLateMinutes = effLate(d);
    d.effectiveEarlyMinutes = effEarly(d);
    if (d.effectiveLateMinutes > 0) d.status = 'LATE';
  }

  const summary = {
    workDays: days.length,
    present: days.filter(d => d.status !== 'ABSENT' && d.status !== 'HOLIDAY').length,
    freeDaysUsed: days.filter(d => d.permit === 'free_day').length,
    absent: days.filter(d => d.status === 'ABSENT').length,
    lateDays: days.filter(d => d.deductionDays > 0).length,
    deductionDays: Math.round(days.reduce((s, d) => s + d.deductionDays, 0) * 100) / 100,
    flagged: days.filter(d => d.flag).length,
    morningPermitsUsed: days.filter(d => /morning/.test(d.permit || '')).length,
    eveningPermitsUsed: days.filter(d => /evening/.test(d.permit || '')).length,
    weekendWorked: overtime.length,
    overtimeDays: overtime.reduce((sum, d) => sum + d.overtimeDays, 0),
  };
  return {
    days: [...days, ...overtime].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
      date: d.date, status: d.status,
      checkIn: d.checkIn == null ? null : toHHMM(d.checkIn), checkOut: d.checkOut == null ? null : toHHMM(d.checkOut),
      lateMinutes: d.lateMinutes, earlyLeaveMinutes: d.earlyLeaveMinutes,
      permit: d.permit, deductionDays: d.deductionDays, punches: d.punches, flag: d.flag, overtimeDays: d.overtimeDays || 0,
    })),
    summary,
  };
}

/**
 * The days of pay a manually entered day costs. `typed` is what HR wrote in the day's deduction box (null when blank), `computed` what the policy's tiers
 * make of its times. An absence is charged by payroll at the policy's rate (two days without permission, one with) unless HR typed another figure: a
 * number above zero replaces that rate (0.5, 1 or 2: a day missed without permission may cost up to UNEXCUSED_ABSENCE_DAYS); blank or zero keeps it.
 * Any other day is capped at one. An absent day used to drop what was typed (it stored 0) and anything above one was refused, so two days was
 * rejected and half a day or one day was saved as the full default.
 * @returns {{ days: number } | { error: string }}
 */
function manualDayDeduction({ status, typed, computed }) {
  // A free day, a leave-balance day, a holiday and overtime cost nothing whatever is typed: a figure left in the box from the day's earlier status is not an error.
  if (status === 'HOLIDAY' || status === 'OVERTIME') return { days: 0 };
  const absent = status === 'ABSENT';
  const most = absent ? UNEXCUSED_ABSENCE_DAYS : 1;
  if (typed !== null && !(Number.isFinite(typed) && typed >= 0 && typed <= most)) {
    return { error: absent ? 'خصم الغياب لازم يكون من صفر ليومين' : 'الخصم لازم يكون من صفر ليوم كامل' };
  }
  if (absent) return { days: typed || 0 };
  // A half day costs half a day (payroll's HALF_DAY_CHARGED_DAYS) unless a figure is typed; the lateness of its punches is not charged on top. A typed zero, like a blank, leaves the rule.
  if (status === 'HALF_DAY') return { days: typed || 0 };
  return { days: typed ?? computed };
}

module.exports = { evaluateMonth, freeDaysFor, normalizePolicy, tierDays, parseTiers, monthDates, toMinutes, manualDayDeduction, DEFAULT_TIERS };
