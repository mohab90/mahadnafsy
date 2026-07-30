'use strict';

const { uuidv4 } = require('./id');
const { getClientIp, hashClientIp } = require('./clientContext');

function createSessionBinding(req) {
  const ip = getClientIp(req);
  if (!ip) throw new Error('A valid client IP is required to create a session');
  return { sessionId: uuidv4(), ipHash: hashClientIp(ip) };
}

async function rotateSingleSession(pool, {
  userId, tenantId, req, countryCode = null, currency = null,
}) {
  const binding = createSessionBinding(req);
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    await conn.beginTransaction();
    transactionStarted = true;
    const [[user]] = await conn.query(
      'SELECT session_version FROM users WHERE id=? AND tenant_id=? AND is_active=1 FOR UPDATE',
      [userId, tenantId]
    );
    if (!user) throw new Error('Active user not found');
    const sessionVersion = Number(user.session_version) + 1;
    const [updated] = await conn.query(
      `UPDATE users
          SET session_version=?, active_session_id=?, active_session_ip_hash=?,
              active_session_started_at=NOW(), active_session_last_seen_at=NOW(),
              last_country_code=COALESCE(?,last_country_code),
              preferred_currency=COALESCE(?,preferred_currency),
              last_geo_at=CASE WHEN ? IS NULL THEN last_geo_at ELSE NOW() END
        WHERE id=? AND tenant_id=? AND is_active=1`,
      [sessionVersion, binding.sessionId, binding.ipHash, countryCode, currency,
        countryCode, userId, tenantId]
    );
    if (updated.affectedRows !== 1) throw new Error('Could not rotate user session');
    await conn.commit();
    transactionStarted = false;
    return { ...binding, sessionVersion };
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

async function closeSingleSession(pool, { userId, tenantId, sessionId }) {
  if (!sessionId) return false;
  const [result] = await pool.query(
    `UPDATE users
        SET session_version=session_version+1, active_session_id=NULL,
            active_session_ip_hash=NULL, active_session_started_at=NULL,
            active_session_last_seen_at=NULL
      WHERE id=? AND tenant_id=? AND active_session_id=?`,
    [userId, tenantId, sessionId]
  );
  return result.affectedRows === 1;
}

module.exports = { createSessionBinding, rotateSingleSession, closeSingleSession };
