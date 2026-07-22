'use strict';
/**
 * Accounting period lock (Top10 #7). Once a period is closed, transactions dated
 * inside it must be immutable. Call assertWritable(date) before inserting/editing
 * payments or expenses. Financial writes fail closed if the lock cannot be checked.
 */
const { pool } = require('./db');
const logger = require('./logger');

// Returns the closed period row covering YYYY-MM-DD, or null. `db` is injectable
// (defaults to the shared pool) so the logic is unit-testable with a mock.
async function closedPeriodFor(dateStr, db = pool, tenantId = 'tenant-default') {
  if (!dateStr) return null;
  try {
    const label = String(dateStr).slice(0, 7); // YYYY-MM
    const [[row]] = await db.query(
      "SELECT id, period_label, status FROM accounting_periods WHERE tenant_id=? AND period_label=? LIMIT 1 FOR UPDATE",
      [tenantId, label]
    );
    return row?.status === 'closed' ? row : null;
  } catch (cause) {
    logger.error('[periodLock] check failed', { err: cause.message, tenantId });
    const error = new Error('Accounting period lock is unavailable');
    error.status = 503;
    error.code = 'ACCOUNTING_PERIOD_LOCK_UNAVAILABLE';
    throw error;
  }
}

// Throws a 409 if the date falls inside a closed period.
async function assertWritable(dateStr, db = pool, tenantId = 'tenant-default') {
  const p = await closedPeriodFor(dateStr, db, tenantId);
  if (p) {
    const e = new Error(`الفترة المحاسبية ${p.period_label} مقفولة — لا يمكن إضافة/تعديل حركة بداخلها`);
    e.status = 409;
    throw e;
  }
}

module.exports = { closedPeriodFor, assertWritable };
