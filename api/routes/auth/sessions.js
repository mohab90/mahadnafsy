'use strict';
// Where an account is signed in, and signing the other devices out:
// GET /api/auth/sessions, POST /api/auth/sessions/logout-others.
// One part of routes/auth.js, which puts the parts back together in order.
//
// A member of staff may be signed in on several devices at once
// (lib/singleSession.js), and until now there was no way to see them or to end
// the others short of changing the password: a laptop left signed in at a
// branch stayed signed in for its whole session.
const { Router } = require('express');
const {
  logger,
  pool,
  signAccessToken,
  setAuthCookie,
  tokenExpiryMs,
  revokeToken,
  requireAuth,
  invalidateIdentity,
  JWT_MAX_AGE_SECONDS,
} = require('./_shared');
const { writeAuditEvent } = require('../../lib/auditTrail');

const router = Router();

// The browser and system, in a word or two, from the user agent.
function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return null;
  const os = /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/i.test(ua) ? 'iPhone'
      : /Windows/i.test(ua) ? 'Windows'
        : /Mac OS X|Macintosh/i.test(ua) ? 'Mac'
          : /Linux/i.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Safari\//.test(ua) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 60);
}

// GET /api/auth/sessions — the account's live sign-ins: same session_version
// as the account, not revoked, used within a token's lifetime.
router.get('/api/auth/sessions', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.session_id, s.ip_hint, s.user_agent, s.created_at, s.last_seen_at
         FROM user_sessions s
         JOIN users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id
        WHERE s.tenant_id=? AND s.user_id=? AND s.revoked_at IS NULL
          AND s.session_version=u.session_version
          AND s.last_seen_at > NOW() - INTERVAL ? SECOND
        ORDER BY s.last_seen_at DESC LIMIT 50`,
      [req.tenantId, req.user.uid, JWT_MAX_AGE_SECONDS]
    );
    res.json({
      sessions: rows.map(row => ({
        id: String(row.session_id).slice(0, 8),
        current: row.session_id === req.user.session_id,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        ipHint: row.ip_hint || null,
        device: deviceLabel(row.user_agent),
      })),
    });
  } catch (e) {
    logger.error('[auth/sessions]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/sessions/logout-others — every other token of this account
// stops working; this one is re-issued and carries on. session_version is the
// revocation counter every token is checked against (middleware/auth.js), so
// one increment ends them all, on every server, at once.
router.post('/api/auth/sessions/logout-others', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[user]] = await conn.query(
      'SELECT session_version FROM users WHERE id=? AND tenant_id=? AND is_active=1 FOR UPDATE',
      [req.user.uid, req.tenantId]
    );
    if (!user || Number(user.session_version) !== Number(req.user.session_version)) {
      await conn.rollback();
      return res.status(401).json({ error: 'Session expired, please sign in again', code: 'SESSION_REVOKED' });
    }
    const sessionVersion = Number(user.session_version) + 1;
    await conn.query(
      'UPDATE users SET session_version=?, active_session_id=? WHERE id=? AND tenant_id=?',
      [sessionVersion, req.user.session_id, req.user.uid, req.tenantId]
    );
    const [ended] = await conn.query(
      `UPDATE user_sessions SET revoked_at=NOW()
        WHERE tenant_id=? AND user_id=? AND session_id<>? AND revoked_at IS NULL`,
      [req.tenantId, req.user.uid, req.user.session_id]
    );
    await conn.query(
      'UPDATE user_sessions SET session_version=?, last_seen_at=NOW() WHERE tenant_id=? AND session_id=?',
      [sessionVersion, req.tenantId, req.user.session_id]
    );
    await writeAuditEvent({
      req, db: conn, action: 'auth.sessions.logout_others', entityType: 'user', entityId: req.user.uid, severity: 'warning',
      metadata: { ended: Number(ended?.affectedRows || 0) },
    });
    await conn.commit();
    if (req.user.jti) await revokeToken(req.user.jti, tokenExpiryMs(req.user));
    invalidateIdentity(req.tenantId, req.user.uid, req.user.email);
    const token = signAccessToken({
      uid: req.user.uid, email: req.user.email, tenantId: req.tenantId,
      sessionVersion, sessionId: req.user.session_id,
      mfaVerified: req.user.mfa_verified === true,
      isStaff: req.user.is_staff === true,
    });
    setAuthCookie(res, token);
    res.json({ ok: true, signedOut: Number(ended?.affectedRows || 0) });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[auth/sessions/logout-others]', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

module.exports = router;
module.exports._test = { deviceLabel };
