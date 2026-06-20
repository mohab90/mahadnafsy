'use strict';
/**
 * Accounting period lock (Top10 #7). Once a period is closed, transactions dated
 * inside it must be immutable. Call assertWritable(date) before inserting/editing
 * payments or expenses. Fail-open if the table is missing (single-tenant bootstrap).
 */
const { pool } = require('./db');
const logger = require('./logger');

// Returns the closed period row covering YYYY-MM-DD, or null.
async function closedPeriodFor(dateStr) {
  if (!dateStr) return null;
  try {
    const label = String(dateStr).slice(0, 7); // YYYY-MM
    const [[row]] = await pool.query(
      "SELECT id, period_label FROM accounting_periods WHERE status='closed' AND period_label=? LIMIT 1",
      [label]
    );
    return row || null;
  } catch (e) { logger.warn('[periodLock] check failed', { err: e.message }); return null; }
}

// Throws a 409 if the date falls inside a closed period.
async function assertWritable(dateStr) {
  const p = await closedPeriodFor(dateStr);
  if (p) {
    const e = new Error(`الفترة المحاسبية ${p.period_label} مقفولة — لا يمكن إضافة/تعديل حركة بداخلها`);
    e.status = 409;
    throw e;
  }
}

module.exports = { closedPeriodFor, assertWritable };
