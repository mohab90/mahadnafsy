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
 * The offset is read at noon, well clear of Egypt's midnight daylight-saving
 * change, so the one day a year the clock jumps still gets the right start.
 */
function cairoDayStartUtc(dateOnly = cairoToday()) {
  if (!DATE_ONLY.test(String(dateOnly))) throw new Error(`not a date: ${dateOnly}`);
  const [y, m, d] = dateOnly.split('-').map(Number);
  const offset = cairoOffsetMinutes(new Date(Date.UTC(y, m - 1, d, 12)));
  const start = new Date(Date.UTC(y, m - 1, d) - offset * 60000);
  return start.toISOString().slice(0, 19).replace('T', ' ');
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
  cairoClock,
  cairoOffsetMinutes,
  cairoDayStartUtc,
  sqlCairoToday,
  sqlCairoDayStartUtc,
};
