'use strict';

// A month of fingerprint punches → each working day's attendance, under the
// company's policy (hr_policy_versions, migration 243):
//
//   • weekly days off (Friday)              → not a working day
//   • working day 11:00–18:30               → lateness is minutes after the
//                                             start, early leave minutes before
//                                             the end
//   • lateness tiers: >10 min ¼ day, >30 ½, >120 a whole day (and the same
//     tiers for leaving early, unless the policy turns that off)
//   • a monthly morning permission (arrive up to 2 h late) and evening one
//     (leave up to 1.5 h early): any HR approved as LATE_PERMIT / EARLY_LEAVE
//     are honoured, and what is left of the month's allowance is spent by the
//     system on the days where it saves the most
//   • no punch on a working day             → ABSENT (payroll deducts the day)
//   • one punch only                        → present, flagged for HR, no
//                                             deduction guessed
//
// Pure: no database. lib/attendanceImport.js feeds it and writes the result.

const DEFAULT_TIERS = Object.freeze([
  { over: 10, days: 0.25 }, { over: 30, days: 0.5 }, { over: 120, days: 1 },
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
  };
}

/** The fraction of a day the minutes cost: the highest tier they pass. */
function tierDays(minutes, tiers) {
  let days = 0;
  for (const tier of tiers) if (minutes > tier.over) days = tier.days;
  return days;
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
 * @returns {{ days: object[], summary: object }}
 */
function evaluateMonth({ policy, month, punches = {}, approvedPermits = [], skipDates = new Set(), firstDate = null, lastDate = null }) {
  const p = normalizePolicy(policy);
  const permitsOn = new Map();
  for (const permit of approvedPermits) {
    const window = (toMinutes(permit.endTime) ?? 0) - (toMinutes(permit.startTime) ?? 0);
    permitsOn.set(`${permit.date}|${permit.type}`, window > 0 ? window
      : (permit.type === 'LATE_PERMIT' ? p.morningPermit : p.eveningPermit));
  }
  const days = [];
  for (const { date, weekday } of monthDates(month)) {
    if (p.weekend.has(weekday) || skipDates.has(date)) continue;
    if (firstDate && date < firstDate) continue;
    if (lastDate && date > lastDate) continue;
    const times = [...new Set((punches[date] || []).map(toMinutes).filter(v => v !== null))].sort((a, b) => a - b);
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

  const judged = days.filter(d => d.status !== 'ABSENT' && !d.flag);
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
    if (d.status === 'ABSENT') continue;
    if (d.flag) { d.deductionDays = 0; continue; }
    d.deductionDays = deduction(effLate(d), effEarly(d));
    d.effectiveLateMinutes = effLate(d);
    d.effectiveEarlyMinutes = effEarly(d);
    if (d.effectiveLateMinutes > 0) d.status = 'LATE';
  }

  const summary = {
    workDays: days.length,
    present: days.filter(d => d.status !== 'ABSENT').length,
    absent: days.filter(d => d.status === 'ABSENT').length,
    lateDays: days.filter(d => d.deductionDays > 0).length,
    deductionDays: Math.round(days.reduce((s, d) => s + d.deductionDays, 0) * 100) / 100,
    flagged: days.filter(d => d.flag).length,
    morningPermitsUsed: days.filter(d => /morning/.test(d.permit || '')).length,
    eveningPermitsUsed: days.filter(d => /evening/.test(d.permit || '')).length,
  };
  return {
    days: days.map(d => ({
      date: d.date, status: d.status,
      checkIn: d.checkIn == null ? null : toHHMM(d.checkIn), checkOut: d.checkOut == null ? null : toHHMM(d.checkOut),
      lateMinutes: d.lateMinutes, earlyLeaveMinutes: d.earlyLeaveMinutes,
      permit: d.permit, deductionDays: d.deductionDays, punches: d.punches, flag: d.flag,
    })),
    summary,
  };
}

module.exports = { evaluateMonth, normalizePolicy, tierDays, parseTiers, monthDates, toMinutes, DEFAULT_TIERS };
