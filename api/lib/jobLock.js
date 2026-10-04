'use strict';

const { pool } = require('./db');
const logger = require('./logger');

/**
 * Run `fn` only if no other process is running the job of the same name.
 *
 * The timer-driven jobs (Dokki session reminders, lead retargeting, waitlist
 * and drip messages, the sheet syncs…) had nothing stopping two API processes
 * running them at the same moment. Each marks what it sent, but both read the
 * unmarked rows before either marks them, so every customer got the message
 * twice — wherever two processes reach one database (a rolling restart, a
 * second instance, staging pointed at the same DB). A named lock that is not
 * waited for lets the first run it and the other skip this round.
 *
 * Same mechanism as lib/scheduledTenants.js forEachActiveTenant.
 */
async function withJobLock(name, fn, db = pool) {
  const key = `job:${String(name).slice(0, 56)}`;
  let conn = null;
  try {
    conn = await db.getConnection();
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 0) AS acquired', [key]);
    if (Number(lock?.acquired) !== 1) {
      logger.info(`[jobs] ${name} is running in another process — skipped here`);
      return { skipped: true };
    }
  } catch (error) {
    if (conn) conn.release();
    logger.warn(`[jobs] ${name} could not take its lock:`, error.message);
    return { skipped: true };
  }
  try {
    return await fn();
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [key]).catch(() => {});
    conn.release();
  }
}

/** A job function wrapped in withJobLock, for a timer to call. */
const lockedJob = (name, fn) => () => withJobLock(name, fn)
  .catch(error => logger.warn(`[jobs] ${name} failed:`, error.message));

module.exports = { withJobLock, lockedJob };
