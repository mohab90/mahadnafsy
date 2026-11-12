'use strict';

// The periods of the owner's management reports (11 Nov 2026: «تقرير شهري وأسبوعي تفصيلي»): today, this week, this month, last week,
// last month, or a custom range of Cairo days. Every period comes with the PREVIOUS EQUAL one it is compared with: a month or week
// still running is compared with the same number of days of the one before (1-11 Nov against 1-11 Oct), never with a whole month,
// which would show every unfinished month as a collapse.

const { addDaysToDateOnly, cairoToday, isValidDateOnly } = require('./dates');
const { weekStartOf } = require('./weeklyBranchReport');

const MAX_DAYS = 93;
const PERIODS = Object.freeze(['today', 'week', 'last_week', 'month', 'last_month', 'custom']);

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const monthStart = day => `${day.slice(0, 7)}-01`;
const previousMonthStart = day => addDaysToDateOnly(monthStart(day), -1).slice(0, 7) + '-01';
const lastDayOfMonth = day => addDaysToDateOnly(addDaysToDateOnly(monthStart(day), 40).slice(0, 7) + '-01', -1);

/** { key, from, to, days, previous: { from, to } } for ?period= (and ?from=&to= when custom). */
function resolvePeriod(query = {}, today = cairoToday()) {
  const key = PERIODS.includes(query.period) ? query.period : 'month';
  let from; let to; let previous;
  const shifted = (start, length) => ({ from: start, to: addDaysToDateOnly(start, length - 1) });
  if (key === 'today') {
    from = today; to = today;
    previous = shifted(addDaysToDateOnly(today, -1), 1);
  } else if (key === 'week' || key === 'last_week') {
    const start = key === 'week' ? weekStartOf(today) : addDaysToDateOnly(weekStartOf(today), -7);
    from = start;
    to = key === 'week' ? today : addDaysToDateOnly(start, 6);
    previous = shifted(addDaysToDateOnly(start, -7), daysBetween(from, to) + 1);
  } else if (key === 'month' || key === 'last_month') {
    from = key === 'month' ? monthStart(today) : previousMonthStart(today);
    to = key === 'month' ? today : lastDayOfMonth(from);
    const before = previousMonthStart(from);
    // A finished month is compared with the whole month before it; one still running, with the same days of it.
    const beforeDays = daysBetween(before, lastDayOfMonth(before)) + 1;
    previous = shifted(before, key === 'last_month' ? beforeDays : Math.min(daysBetween(from, to) + 1, beforeDays));
  } else {
    to = isValidDateOnly(query.to) ? query.to : today;
    from = isValidDateOnly(query.from) ? query.from : to;
    if (from > to) from = to;
    const earliest = addDaysToDateOnly(to, -(MAX_DAYS - 1));
    if (from < earliest) from = earliest;
    const length = daysBetween(from, to) + 1;
    previous = shifted(addDaysToDateOnly(from, -length), length);
  }
  return { key, from, to, days: daysBetween(from, to) + 1, previous };
}

/** Change of `now` against `before`: { before, change, changePct (null when before is 0) }. */
function compare(now, before) {
  const current = Number(now) || 0;
  const earlier = Number(before) || 0;
  return {
    before: earlier,
    change: Math.round((current - earlier) * 100) / 100,
    changePct: earlier > 0 ? Math.round(((current - earlier) / earlier) * 1000) / 10 : null,
  };
}

module.exports = { MAX_DAYS, PERIODS, compare, daysBetween, lastDayOfMonth, monthStart, previousMonthStart, resolvePeriod };
