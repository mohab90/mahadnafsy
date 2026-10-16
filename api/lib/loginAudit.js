'use strict';
const logger = require('./logger');
const { pool } = require('./db');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');
const { getClientIp } = require('./clientContext');
const { toIdentity } = require('./phoneNumber');

/**
 * One row of the sign-in log. The address is the connection's own as the app resolves it
 * (trusted proxy hops, lib/clientContext.js getClientIp) — not the first value of a forwarded header,
 * which the client can write. `phone` is the number tried or the account's: a WhatsApp attempt has no
 * e-mail, and without it a failed one is a row of dashes.
 */
async function logLoginAttempt({ userId = null, email = null, phone = null, req, status, failureReason = null, tenantId }) {
  const ip = (getClientIp(req)
    || String(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '').replace(/^::ffff:/, '')).slice(0, 64);
  const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 512);
  const identity = phone ? (toIdentity(phone) || String(phone).replace(/\D/g, '').slice(-15)) : null;
  try {
    await pool.query(
      `INSERT INTO login_history
       (tenant_id,user_id,email,phone,ip,user_agent,status,failure_reason)
       VALUES (?,?,?,?,?,?,?,?)`,
      [tenantId || req?.tenantId || DEFAULT_TENANT, userId, email, identity || null, ip, userAgent, status, failureReason]
    );
  } catch (error) {
    // Authentication must not fail because audit storage is unavailable — but a
    // missing login-history row is the kind of gap a security question is
    // answered from, so it says so rather than vanishing.
    logger.warn('[login-audit] write failed', { email, status, err: error.message });
  }
}

module.exports = { logLoginAttempt };
