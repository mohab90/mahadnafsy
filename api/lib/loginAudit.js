'use strict';
const logger = require('./logger');
const { pool } = require('./db');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

async function logLoginAttempt({ userId = null, email = null, req, status, failureReason = null, tenantId }) {
  const ip = String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || req?.connection?.remoteAddress || '')
    .split(',')[0].trim().slice(0, 64);
  const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 512);
  try {
    await pool.query(
      `INSERT INTO login_history
       (tenant_id,user_id,email,ip,user_agent,status,failure_reason)
       VALUES (?,?,?,?,?,?,?)`,
      [tenantId || req?.tenantId || DEFAULT_TENANT, userId, email, ip, userAgent, status, failureReason]
    );
  } catch (error) {
    // Authentication must not fail because audit storage is unavailable — but a
    // missing login-history row is the kind of gap a security question is
    // answered from, so it says so rather than vanishing.
    logger.warn('[login-audit] write failed', { email, status, err: error.message });
  }
}

module.exports = { logLoginAttempt };
