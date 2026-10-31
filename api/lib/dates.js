'use strict';

function safeIsoString(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('0000-00-00')) return '';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function safeDateOnly(value) {
  return safeIsoString(value).slice(0, 10);
}

// Returns the half-open date range [startDate, endDate) for a 'YYYY-MM' month
// label: startDate = first day of that month, endDate = first day of the NEXT
// month. Pure + string-based (no timezone drift). Used by accounting period
// close so revenue/expense snapshots query `WHERE date >= start AND date < end`.
// Returns null on malformed input so callers can reject it explicitly.
function monthRange(yyyyMm) {
  const m = String(yyyyMm || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10); // 1–12
  if (month < 1 || month > 12) return null;
  const startDate = `${m[1]}-${m[2]}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endDate = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
  return { startDate, endDate };
}

function zonedDateTimeParts(value = new Date(), timeZone = 'Africa/Cairo') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const result = {};
  for (const part of parts) {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
  }
  return result;
}

function dateOnlyInTimeZone(value = new Date(), timeZone = 'Africa/Cairo') {
  const { year, month, day } = zonedDateTimeParts(value, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The institute's clock.
 *
 * The server, MariaDB and the Node process all run in UTC, and must: every
 * DATETIME written with NOW() holds a UTC wall-clock time, and mysql2 reads those
 * back as UTC because the process has no TZ. Moving any of the three to Cairo
 * would reinterpret every stored row by two or three hours. So storage stays UTC
 * and the *day* is asked for in Cairo terms, here.
 *
 * What went wrong without this: CURDATE() is the UTC date, so Cairo's day began at
 * 02:00 or 03:00, and HOUR(NOW()) is the UTC hour, so an employee who checked in at
 * 09:00 was recorded as arriving at 06:00 — and never late, because 06:00 is before
 * any shift starts. The database has no time-zone tables (CONVERT_TZ with
 * 'Africa/Cairo' returns NULL), so the zone arithmetic happens in JS, where Intl
 * carries Egypt's daylight-saving rules.
 */
const CAIRO = 'Africa/Cairo';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const pad2 = n => String(n).padStart(2, '0');

/** Cairo's calendar date, e.g. '2026-09-24'. */
function cairoToday(now = new Date()) {
  return dateOnlyInTimeZone(now, CAIRO);
}

/**
 * The month it is in Cairo, as the default for a report or a payroll run.
 * `new Date().getMonth()` is the server's month, and the server runs in UTC: for
 * the first three hours of a month in Cairo it still answered the month before,
 * so a payroll opened at 1 a.m. on the 1st defaulted to last month.
 */
function cairoYearMonth(now = new Date()) {
  const [year, month] = cairoToday(now).split('-').map(Number);
  return { year, month };
}

/**
 * 'YYYY-MM-01' for the Cairo month N months before this one (negative looks
 * ahead) — the default start of a «هذا الشهر» or «آخر 3 شهور» report.
 * `new Date(now.getFullYear(), now.getMonth(), 1)` is the server's month, which
 * is UTC: on the 1st before 02:00/03:00 Cairo it named the month just ended.
 */
function cairoMonthStart(monthsBack = 0, now = new Date()) {
  const { year, month } = cairoYearMonth(now);
  return new Date(Date.UTC(year, month - 1 - monthsBack, 1)).toISOString().slice(0, 10);
}

/** Cairo's wall clock: the date, 'HH:MM', and minutes since midnight. */
function cairoClock(now = new Date()) {
  const p = zonedDateTimeParts(now, CAIRO);
  return {
    date: cairoToday(now),
    time: `${pad2(p.hour)}:${pad2(p.minute)}`,
    minutes: p.hour * 60 + p.minute,
  };
}

/** Minutes Cairo is ahead of UTC at a given instant — 120 in winter, 180 in summer. */
function cairoOffsetMinutes(instant) {
  const p = zonedDateTimeParts(instant, CAIRO);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - instant.getTime()) / 60000);
}

/**
 * The UTC instant at which a Cairo calendar day begins, as a MySQL DATETIME
 * string. This is what to compare a UTC-instant column against: `created_at >=
 * CURDATE()` meant "since UTC midnight", which is 02:00 or 03:00 in Cairo.
 *
 * Egypt changes its clocks at local midnight, so on those two days a year the
 * offset in force at 00:00 is not the one in force at noon. Reading it at noon
 * alone put the start of Friday 24 April 2026 at 21:00 UTC — an hour that was
 * still Thursday 23:00 in Cairo, because the clocks jumped from 00:00 straight
 * to 01:00 and the day began at 22:00 UTC. So both offsets that could apply
 * (yesterday's and today's) are tried, and the earliest instant that Cairo
 * actually calls this day wins.
 */
function cairoDayStartUtc(dateOnly = cairoToday()) {
  if (!DATE_ONLY.test(String(dateOnly))) throw new Error(`not a date: ${dateOnly}`);
  const [y, m, d] = dateOnly.split('-').map(Number);
  const midnight = Date.UTC(y, m - 1, d);
  const offsets = new Set([
    cairoOffsetMinutes(new Date(midnight - 12 * 3600000)),
    cairoOffsetMinutes(new Date(midnight + 12 * 3600000)),
  ]);
  let start = null;
  for (const offset of offsets) {
    const candidate = midnight - offset * 60000;
    if (cairoToday(new Date(candidate)) === dateOnly && (start === null || candidate < start)) start = candidate;
  }
  if (start === null) start = midnight - cairoOffsetMinutes(new Date(midnight + 12 * 3600000)) * 60000;
  return new Date(start).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * The UTC instant at which the clock in Cairo reads `hour`:`minute` on a calendar day, as a MySQL DATETIME string — for an hour between
 * 01:00 and 23:59, where the offset in force is the one at that wall time (Egypt changes its clocks at midnight, which
 * cairoDayStartUtc handles for a day's start). The owner's business day ends at 19:00, not at midnight.
 */
function cairoWallUtc(dateOnly, hour = 0, minute = 0) {
  if (!DATE_ONLY.test(String(dateOnly))) throw new Error(`not a date: ${dateOnly}`);
  const [y, m, d] = dateOnly.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hour, minute);
  // Both offsets that can apply around that day (as cairoDayStartUtc tries them); the one whose instant Cairo's clock reads back as
  // this wall time is the answer.
  const candidates = new Set([
    cairoOffsetMinutes(new Date(wallAsUtc - 12 * 3600000)),
    cairoOffsetMinutes(new Date(wallAsUtc + 12 * 3600000)),
  ]);
  for (const offset of candidates) {
    const instant = wallAsUtc - offset * 60000;
    const read = zonedDateTimeParts(new Date(instant), CAIRO);
    if (read.year === y && read.month === m && read.day === d && read.hour === hour && read.minute === minute) {
      return new Date(instant).toISOString().slice(0, 19).replace('T', ' ');
    }
  }
  throw new Error(`Cairo has no ${hour}:${minute} on ${dateOnly}`);
}

/**
 * [start, end) in UTC for the Cairo days `from` … `to`, both included — the
 * bounds to hold a column written with NOW() against.
 *
 * Routes compared `created_at >= '2026-10-12' AND created_at < DATE_ADD('2026-10-12',
 * INTERVAL 1 DAY)`, i.e. UTC midnight to UTC midnight: Cairo's 03:00 to 03:00 in
 * summer. A payment taken at 01:00 counted in yesterday's report and today's
 * dropped it. Each bound is a Cairo midnight found on its own, so a range that
 * crosses a daylight-saving change is right at both ends.
 *
 * Accepts a value whose first ten characters are a date ('2026-10-12' or
 * '2026-10-12T…'), which is what the report screens send; anything else is a 400.
 */
function cairoDayBoundsUtc(from, to = from) {
  const day = value => (String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T ])/) || [])[1] || '';
  const first = day(from);
  const last = day(to);
  if (!isValidDateOnly(first) || !isValidDateOnly(last)) {
    const error = new Error('تاريخ غير صحيح — الشكل المطلوب YYYY-MM-DD');
    error.statusCode = 400;
    throw error;
  }
  return [cairoDayStartUtc(first), cairoDayStartUtc(addDaysToDateOnly(last, 1))];
}

/**
 * The Cairo day a stored or submitted value falls on, 'YYYY-MM-DD', or ''.
 *
 * A bare date is taken as written. Anything with a time is an instant — a
 * DATETIME from the pool, an ISO string from a browser — and is placed on
 * Cairo's calendar, not sliced: '2026-10-11T22:30:00Z' is the 12th in Cairo.
 * A picked day stored at midnight (payments.date) stays on its day, because
 * Cairo is ahead of UTC.
 */
function cairoDayOf(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') {
    const raw = value.trim();
    if (DATE_ONLY.test(raw)) return isValidDateOnly(raw) ? raw : '';
    if (raw.startsWith('0000-00-00')) return '';
    // Zoneless 'YYYY-MM-DD HH:MM[:SS]' is a stored UTC wall clock.
    const naive = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
    const instant = new Date(naive ? `${naive[1]}T${naive[2]}Z` : raw);
    return Number.isNaN(instant.getTime()) ? '' : cairoToday(instant);
  }
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.getTime()) ? '' : cairoToday(instant);
}

/**
 * Milliseconds from `now` until the next HH:MM on Cairo's wall clock.
 *
 * The daily jobs were armed with `setHours(7, 0, 0, 0)` on the server's clock,
 * which is UTC — so «7 الصبح» was 10:00 in Cairo in summer and 09:00 in winter —
 * and then repeated every 24 hours, which cannot follow a clock change. Callers
 * re-arm from this after every run instead.
 */
function msUntilCairoTime(hour, minute = 0, now = new Date()) {
  const target = hour * 60 + minute;
  const clock = cairoClock(now);
  let day = clock.date;
  if (clock.minutes >= target) day = addDaysToDateOnly(day, 1);
  // The day's start plus the wall-clock minutes, corrected for an offset that
  // changes between midnight and the target (only ever on a DST night).
  const start = Date.parse(`${cairoDayStartUtc(day).replace(' ', 'T')}Z`);
  let at = start + target * 60000;
  const drift = cairoClock(new Date(at)).minutes - target;
  if (drift) at -= drift * 60000;
  return Math.max(1000, at - now.getTime());
}

/**
 * Drop-in replacements for CURDATE() inside SQL text.
 *
 * Inlined rather than bound as parameters so a query keeps its placeholders in
 * the order they were written — sixty-odd statements could otherwise each gain a
 * positional bug. It is safe to inline: both values are produced here from Intl's
 * digits and re-checked against a strict pattern, and neither ever carries input.
 *
 *   sqlCairoToday()       — against a calendar date (a DATE column, or a
 *                           DATETIME that stores a picked day at midnight)
 *   sqlCairoDayStartUtc() — against a column written with NOW() (a UTC instant)
 */
function sqlCairoToday(now = new Date()) {
  const day = cairoToday(now);
  if (!DATE_ONLY.test(day)) throw new Error(`refusing to inline ${day}`);
  return `DATE('${day}')`;
}

function sqlCairoDayStartUtc(now = new Date()) {
  const start = cairoDayStartUtc(cairoToday(now));
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(start)) throw new Error(`refusing to inline ${start}`);
  return `'${start}'`;
}

/**
 * Where today ends in Cairo: tomorrow's start, inlined like the one above.
 * `${sqlCairoDayStartUtc()} + INTERVAL 1 DAY` is 24 hours, and the two days a
 * year Egypt changes its clocks are 23 and 25 hours long.
 */
function sqlCairoDayEndUtc(now = new Date()) {
  const end = cairoDayStartUtc(addDaysToDateOnly(cairoToday(now), 1));
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(end)) throw new Error(`refusing to inline ${end}`);
  return `'${end}'`;
}

/*
 * Cairo's wall clock inside SQL, for grouping rows by the institute's day or
 * month.
 *
 * DATE(created_at) and DATE_FORMAT(created_at, '%Y-%m') bucket a UTC instant by
 * the UTC calendar, so everything from Cairo's midnight to 02:00/03:00 lands on
 * the day — and on the 1st, the month — before. CONVERT_TZ cannot help: this
 * database has no time-zone tables. So the summers are listed here, from Intl,
 * and the expression adds 180 minutes inside one and 120 outside. Each bound is
 * the exact instant the clocks change (Egypt changes at local midnight), so the
 * hour the autumn change repeats is placed on the Thursday it belongs to.
 */
let summersUtc = null;
let summersUntilYear = 0;

function egyptSummersUtc(untilYear) {
  if (summersUtc && summersUntilYear >= untilYear) return summersUtc;
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  });
  const offsetAtNoon = utcMidnight => {
    const at = utcMidnight + 12 * 3600000;
    const p = {};
    for (const part of format.formatToParts(new Date(at))) p[part.type] = Number(part.value);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour) - at) / 60000);
  };
  const ranges = [];
  // Egypt has kept two kinds of year since 2011: none, and summers that start
  // and end at a local midnight (2014's Ramadan break included).
  let day = Date.UTC(2014, 0, 1);
  const last = Date.UTC(untilYear, 11, 31);
  let previous = offsetAtNoon(day);
  let openedAt = null;
  for (day += 86400000; day <= last; day += 86400000) {
    const offset = offsetAtNoon(day);
    if (offset !== previous) {
      const switchAt = day - previous * 60000;
      if (offset > previous) openedAt = switchAt;
      else if (openedAt !== null) { ranges.push([openedAt, switchAt]); openedAt = null; }
      previous = offset;
    }
  }
  if (openedAt !== null) ranges.push([openedAt, last + 86400000]);
  summersUtc = ranges.map(([a, b]) => [a, b].map(t => new Date(t).toISOString().slice(0, 19).replace('T', ' ')));
  summersUntilYear = untilYear;
  return summersUtc;
}

/**
 * SQL for the Cairo wall clock of a UTC DATETIME column, e.g.
 *   `DATE_FORMAT(${sqlCairoWall('l.created_at')}, '%Y-%m')`
 * The column is inlined, so only a plain (optionally qualified) column name is
 * accepted; the instants come from egyptSummersUtc() and are re-checked.
 */
function sqlCairoWall(column, now = new Date()) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(String(column))) {
    throw new Error(`refusing to inline column ${column}`);
  }
  const untilYear = Number(cairoToday(now).slice(0, 4)) + 1;
  const stamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const whens = egyptSummersUtc(untilYear).map(([from, to]) => {
    if (!stamp.test(from) || !stamp.test(to)) throw new Error('refusing to inline a summer bound');
    return `WHEN ${column} >= '${from}' AND ${column} < '${to}' THEN 180`;
  });
  if (!whens.length) return `(${column} + INTERVAL 120 MINUTE)`;
  return `(${column} + INTERVAL (CASE ${whens.join(' ')} ELSE 120 END) MINUTE)`;
}

function addDaysToDateOnly(dateOnly, days) {
  if (!isValidDateOnly(dateOnly) || !Number.isInteger(days)) return '';
  const value = new Date(`${dateOnly}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isValidDateOnly(value) {
  const raw = String(value || '');
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() + 1 === Number(match[2])
    && parsed.getUTCDate() === Number(match[3]);
}

module.exports = {
  safeIsoString,
  safeDateOnly,
  monthRange,
  zonedDateTimeParts,
  dateOnlyInTimeZone,
  addDaysToDateOnly,
  isValidDateOnly,
  cairoToday,
  cairoYearMonth,
  cairoMonthStart,
  cairoClock,
  cairoOffsetMinutes,
  cairoDayStartUtc,
  cairoWallUtc,
  cairoDayBoundsUtc,
  cairoDayOf,
  msUntilCairoTime,
  sqlCairoToday,
  sqlCairoDayStartUtc,
  sqlCairoDayEndUtc,
  sqlCairoWall,
};
