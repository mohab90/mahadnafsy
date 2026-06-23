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

module.exports = { safeIsoString, safeDateOnly, monthRange };
