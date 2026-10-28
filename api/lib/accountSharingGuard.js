'use strict';

// Detects a password being shared around rather than a person changing networks.
//
// Single-session binding already limits an account to one live device, so
// sharing shows up as a chain of sign-outs rather than concurrent use — every
// individual login looks legitimate. What gives it away is the SPREAD of DEVICES:
// a shared password accumulates distinct devices quickly.
//
// It counts devices, never networks (25 Oct 2026): «لو فتح الموقع مرتين من نفس
// الجهاز على شبكتين مختلفتين بيتقفل عليه». A phone changes IP address whenever it
// moves between WiFi and mobile data (CGNAT), so counting addresses locked out one
// person on one device. A device is the long-lived cookie of lib/customerDevices.js,
// kept as a keyed hash on each sign-in (login_history.device_hash): two devices
// count as two, two networks on one device count as one.
//
// The window matters. Counting devices forever would eventually lock out a
// long-lived legitimate account (a phone replaced, a browser cleared), so the
// count is always over a recent rolling window.

const { pool } = require('./db');
const logger = require('./logger');

const MAX_DISTINCT_DEVICES = Math.max(1, Number(process.env.ACCOUNT_MAX_DISTINCT_DEVICES || 3));
const WINDOW_HOURS = Math.max(1, Number(process.env.ACCOUNT_DEVICE_WINDOW_HOURS || 24));
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
 * Count the distinct devices this email has signed in from recently and, if that
 * exceeds the allowance, suspend the account for a cool-off period.
 * Call AFTER a login has been recorded so the current device is included.
 * A sign-in with no device (staff, who are never device-counted) is not counted.
 * Returns { locked, distinctDevices, until }.
 */
async function enforceSharingLimit({ tenantId, userId, email }) {
  if (!tenantId || !userId || !email) return { locked: false, distinctDevices: 0, until: null };
  try {
    const [[stat]] = await pool.query(
      `SELECT COUNT(DISTINCT device_hash) AS distinct_devices
         FROM login_history
        WHERE tenant_id=? AND email=? AND status IN ('success','2fa_success')
          AND device_hash IS NOT NULL
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
      [tenantId, String(email).toLowerCase().trim(), WINDOW_HOURS]
    );
    const distinctDevices = Number(stat?.distinct_devices || 0);
    if (distinctDevices <= MAX_DISTINCT_DEVICES) return { locked: false, distinctDevices, until: null };

    const reason = `تسجيل دخول من ${distinctDevices} أجهزة مختلفة خلال ${WINDOW_HOURS} ساعة`;
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
      userId, distinctDevices, windowHours: WINDOW_HOURS, lockHours: LOCK_HOURS,
    });
    return { locked: true, distinctDevices, until: new Date(Date.now() + LOCK_HOURS * 3600 * 1000) };
  } catch (error) {
    // A failure here must never deny a legitimate sign-in.
    logger.warn('[sharing-guard] enforcement failed', { error: error.message });
    return { locked: false, distinctDevices: 0, until: null };
  }
}

module.exports = {
  getSharingLock,
  enforceSharingLimit,
  MAX_DISTINCT_DEVICES,
  WINDOW_HOURS,
  LOCK_HOURS,
};
