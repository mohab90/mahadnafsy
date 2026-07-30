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
};
