'use strict';

// Detects a password being shared around rather than a person changing networks.
//
// Single-session binding already limits an account to one live device, so
// sharing shows up as a chain of sign-outs rather than concurrent use — every
// individual login looks legitimate. What gives it away is the SPREAD: a real
// person cycles through a handful of networks (home, mobile, office), while a
// shared password accumulates distinct IPs quickly.
//
// The window matters. Counting distinct IPs forever would eventually lock out
// any long-lived legitimate account (phones re-IP constantly on CGNAT), so the
// count is always over a recent rolling window.

const { pool } = require('./db');
const logger = require('./logger');

const MAX_DISTINCT_IPS = Math.max(1, Number(process.env.ACCOUNT_MAX_DISTINCT_IPS || 3));
const WINDOW_HOURS = Math.max(1, Number(process.env.ACCOUNT_IP_WINDOW_HOURS || 24));
const LOCK_HOURS = Math.max(1, Number(process.env.ACCOUNT_SHARING_LOCK_HOURS || 24));

/**
 * Is this account currently serving a sharing lock?
 * Returns { locked, until, reason } — never throws, so it can't block a login
 * because of an unrelated database hiccup.
 */
async function getSharingLock(tenantId, userId) {
  try {
    const [[row]] = await pool.query(
      `SELECT sharing_locked_until, sharing_lock_reason
         FROM users
        WHERE id=? AND tenant_id=? AND sharing_locked_until IS NOT NULL
          AND sharing_locked_until > NOW() LIMIT 1`,
      [userId, tenantId]
    );
    if (!row) return { locked: false, until: null, reason: null };
    return { locked: true, until: row.sharing_locked_until, reason: row.sharing_lock_reason };
  } catch (error) {
    logger.warn('[sharing-guard] lock read failed', { error: error.message });
    return { locked: false, until: null, reason: null };
  }
}

/**
 * Count the distinct IPs this email has signed in from recently and, if that
 * exceeds the allowance, suspend the account for a cool-off period.
 * Call AFTER a login has been recorded so the current IP is included.
 * Returns { locked, distinctIps, until }.
 */
async function enforceSharingLimit({ tenantId, userId, email }) {
  if (!tenantId || !userId || !email) return { locked: false, distinctIps: 0, until: null };
  try {
    const [[stat]] = await pool.query(
      `SELECT COUNT(DISTINCT ip) AS distinct_ips
         FROM login_history
        WHERE tenant_id=? AND email=? AND status IN ('success','2fa_success')
          AND ip IS NOT NULL AND ip <> ''
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
      [tenantId, String(email).toLowerCase().trim(), WINDOW_HOURS]
    );
    const distinctIps = Number(stat?.distinct_ips || 0);
    if (distinctIps <= MAX_DISTINCT_IPS) return { locked: false, distinctIps, until: null };

    const reason = `تسجيل دخول من ${distinctIps} شبكات مختلفة خلال ${WINDOW_HOURS} ساعة`;
    // Bumping session_version in the same statement drops the live session too,
    // so locking the account also signs out whoever is currently using it.
    await pool.query(
      `UPDATE users
          SET sharing_locked_until = DATE_ADD(NOW(), INTERVAL ? HOUR),
              sharing_lock_reason = ?,
              sharing_lock_count = sharing_lock_count + 1,
              session_version = session_version + 1,
              active_session_id = NULL,
              active_session_ip_hash = NULL
        WHERE id=? AND tenant_id=?`,
      [LOCK_HOURS, reason.slice(0, 160), userId, tenantId]
    );
    logger.warn('[sharing-guard] account locked for suspected sharing', {
      userId, distinctIps, windowHours: WINDOW_HOURS, lockHours: LOCK_HOURS,
    });
    return { locked: true, distinctIps, until: new Date(Date.now() + LOCK_HOURS * 3600 * 1000) };
  } catch (error) {
    // A failure here must never deny a legitimate sign-in.
    logger.warn('[sharing-guard] enforcement failed', { error: error.message });
    return { locked: false, distinctIps: 0, until: null };
  }
}

module.exports = {
  getSharingLock,
  enforceSharingLimit,
  MAX_DISTINCT_IPS,
  WINDOW_HOURS,
  LOCK_HOURS,
};
