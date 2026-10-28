'use strict';

const { uuidv4 } = require('./id');
const { getClientIp, hashClientIp } = require('./clientContext');
const { registerCustomerDevice } = require('./customerDevices');

function createSessionBinding(req) {
  const ip = getClientIp(req);
  if (!ip) throw new Error('A valid client IP is required to create a session');
  return { sessionId: uuidv4(), ipHash: hashClientIp(ip) };
}

/**
 * @param {boolean} allowConcurrent  Keep other devices signed in.
 *   session_version is the revocation counter — every issued token carries it,
 *   so bumping it invalidates ALL of an account's tokens. Doing that on every
 *   login means one live device per account, which is the point for customers
 *   (a shared password must not multiply access to paid video) but wrong for
 *   staff: it silently signed the owner out of his laptop whenever he opened the
 *   dashboard on a phone, or the public site under the same account. Staff pass
 *   true here; the new session id is still recorded so the sessions view and the
 *   sharing guard keep working.
 */
async function rotateSingleSession(pool, {
  userId, tenantId, req, countryCode = null, currency = null, allowConcurrent = false,
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
    // A customer's third device is refused here, before anything changes, so
    // the devices already signed in stay signed in.
    if (!allowConcurrent) await registerCustomerDevice(conn, { tenantId, userId, req });
    const sessionVersion = allowConcurrent
      ? Number(user.session_version)
      : Number(user.session_version) + 1;
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
    await recordSession(pool, { tenantId, userId, sessionId: binding.sessionId, sessionVersion, req });
    return { ...binding, sessionVersion };
  } catch (error) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

// What the account's own «where am I signed in» list shows of an address: the
// network, not the house — enough to tell «my office» from «not me».
function ipHint(ip) {
  const value = String(ip || '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return value.split('.').slice(0, 2).join('.') + '.x.x';
  if (value.includes(':')) return value.split(':').slice(0, 3).join(':') + ':…';
  return null;
}

// Rows older than this are of no use to the list (no token lives that long).
const SESSION_ROW_DAYS = 30;

/**
 * One row per sign-in, for routes/auth/sessions.js. Best-effort: a sign-in is
 * never refused because its row could not be written; the token is the
 * authority, this is the account's view of it.
 */
async function recordSession(pool, { tenantId, userId, sessionId, sessionVersion, req }) {
  try {
    await pool.query(
      `INSERT INTO user_sessions (tenant_id, session_id, user_id, session_version, ip_hint, user_agent)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE session_version=VALUES(session_version), last_seen_at=NOW()`,
      [tenantId, sessionId, userId, sessionVersion, ipHint(getClientIp(req)),
        String(req?.headers?.['user-agent'] || '').slice(0, 255) || null]
    );
    await pool.query(
      'DELETE FROM user_sessions WHERE tenant_id=? AND user_id=? AND last_seen_at < NOW() - INTERVAL ? DAY',
      [tenantId, userId, SESSION_ROW_DAYS]
    );
  } catch (error) {
    require('./logger').warn('[sessions] could not record a sign-in', { err: error.message });
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
  await pool.query(
    'UPDATE user_sessions SET revoked_at=COALESCE(revoked_at, NOW()) WHERE tenant_id=? AND session_id=?',
    [tenantId, sessionId]
  ).catch(() => {});
  return result.affectedRows === 1;
}

module.exports = { createSessionBinding, rotateSingleSession, closeSingleSession, recordSession, ipHint };
