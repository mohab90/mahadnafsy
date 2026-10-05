'use strict';

const { pool } = require('./db');
const logger = require('./logger');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

/**
 * Run a scheduled job for every active tenant.
 *
 * Two things this did not do:
 *  - One tenant's failure ended the loop: every tenant after it had no daily
 *    report and no payment reminders that day, and the rejection went
 *    unhandled (every caller fires it without awaiting).
 *  - Nothing stopped two API processes running the same job at the same
 *    minute. Staging runs with NODE_ENV=production on purpose, background jobs
 *    included, so wherever two processes reach one database each customer got
 *    each reminder twice. A named lock that is not waited for lets the first
 *    process run the job and the other skip it.
 */
async function forEachActiveTenant(task, db = pool) {
  const job = String(task.name || 'job').slice(0, 40);
  // Per database: named locks are server-wide (lib/lockName.js).
  const lockKey = require('./lockName').scopedLockName(`scheduled:${job}`);
  let lockConn = null;
  try {
    lockConn = await db.getConnection();
    const [[lock]] = await lockConn.query('SELECT GET_LOCK(?, 0) AS acquired', [lockKey]);
    if (Number(lock?.acquired) !== 1) {
      logger.info(`[scheduled] ${job} is running in another process — skipped here`);
      return;
    }
    let tenantIds = [DEFAULT_TENANT];
    try {
      const [rows] = await db.query("SELECT id FROM tenants WHERE status='active'");
      if (rows.length) tenantIds = rows.map((row) => row.id);
    } catch (_) { /* SaaS schema may not be installed during early bootstrap. */ }
    for (const tenantId of tenantIds) {
      try {
        await task(tenantId);
      } catch (error) {
        logger.error(`[scheduled] ${job} failed for a tenant`, { tenantId, error: error.message });
      }
    }
  } catch (error) {
    logger.error(`[scheduled] ${job} could not start`, { error: error.message });
  } finally {
    if (lockConn) {
      await lockConn.query('SELECT RELEASE_LOCK(?)', [lockKey]).catch(() => {});
      lockConn.release();
    }
  }
}

module.exports = { forEachActiveTenant };
