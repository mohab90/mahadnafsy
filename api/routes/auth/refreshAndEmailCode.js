'use strict';
// Token refresh and the emailed sign-in code.
// One part of routes/auth.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  logger,
  pool,
  signAccessToken,
  setAuthCookie,
  tokenExpiryMs,
  revokeToken,
  isInstituteOwner,
  requireAuth,
  invalidateIdentity,
  otpLimiter,
  logLoginAttempt,
  rotateSingleSession,
  getSharingLock,
  enforceSharingLimit,
} = require('./_shared');
const { checkLoginCode, readPendingToken, sendLoginCode, CODE_TTL_MINUTES, RESEND_AFTER_SECONDS } = require('../../lib/loginEmailCode');

const router = Router();

// POST /api/auth/refresh — rotate the access token and revoke the previous jti.
router.post('/api/auth/refresh', requireAuth, async (req, res) => {
  try {
    const { jti: oldJti } = req.user || {};
    if (oldJti) await revokeToken(oldJti, tokenExpiryMs(req.user));
    const token = signAccessToken({
      uid: req.user.uid, email: req.user.email, tenantId: req.tenantId,
      sessionVersion: req.user.session_version, sessionId: req.user.session_id,
      mfaVerified: req.user.mfa_verified,
      // Preserved from the presented token. Dropping it here re-applied the
      // one-device rule to an operator on the first refresh, which is exactly
      // how "it logs me out again after a few minutes" survived a fix at login.
      isStaff: req.user.is_staff === true,
    });
    setAuthCookie(res, token);
    // The account's list of sign-ins shows when each device was last in use.
    pool.query('UPDATE user_sessions SET last_seen_at=NOW() WHERE tenant_id=? AND session_id=?', [req.tenantId, req.user.session_id])
      .catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The code sent to the email — the second step of an important account's sign-in
// (lib/loginEmailCode.js). /api/auth/login and the WhatsApp sign-in answer
// `emailCodeRequired` with a pendingToken instead of a session; these two finish
// or repeat that step.
// ─────────────────────────────────────────────────────────────────────────────

// The account a pending token stands for, or the answer to send back instead.
async function pendingAccount(req) {
  const { pendingToken } = req.body || {};
  if (!pendingToken) return { status: 400, body: { error: 'pendingToken required' } };
  let payload;
  try {
    payload = readPendingToken(pendingToken);
  } catch (error) {
    return { status: error.statusCode || 401, body: { error: error.message, code: error.code } };
  }
  const tenantId = payload.tid || req.tenantId;
  const [[user]] = await pool.query(
    'SELECT id, email, name, session_version FROM users WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1', [payload.uid, tenantId]);
  if (!user || Number(payload.sv) !== Number(user.session_version)) {
    return { status: 401, body: { error: 'انتهت صلاحية الجلسة — أعد تسجيل الدخول', code: 'SESSION_REVOKED' } };
  }
  return { tenantId, user };
}

// POST /api/auth/login/email-code/verify  { pendingToken, code } — the right code is the session.
router.post('/api/auth/login/email-code/verify', otpLimiter, async (req, res) => {
  try {
    const found = await pendingAccount(req);
    if (!found.user) return res.status(found.status).json(found.body);
    const { tenantId, user } = found;
    if (!req.body?.code) return res.status(400).json({ error: 'اكتب الكود اللي وصلك على البريد' });

    const checked = await checkLoginCode(pool, { tenantId, userId: user.id, code: req.body.code });
    if (!checked.ok) {
      await logLoginAttempt({ userId: user.id, email: user.email, req, tenantId, status: 'failed', failureReason: checked.reason === 'expired' ? 'email_code_expired' : 'email_code_wrong' });
      return checked.reason === 'expired'
        ? res.status(401).json({ error: 'الكود انتهى أو اتحرق — اطلب كود جديد', code: 'EMAIL_CODE_EXPIRED' })
        : res.status(401).json({ error: 'الكود غير صحيح', code: 'EMAIL_CODE_WRONG' });
    }

    // The sharing lock refuses an account at the password step; one raised since is still refused here.
    const activeLock = await getSharingLock(tenantId, user.id);
    if (activeLock.locked) {
      await logLoginAttempt({ userId: user.id, email: user.email, req, tenantId, status: 'failed', failureReason: 'sharing_locked' });
      return res.status(423).json({
        error: `الحساب موقوف مؤقتاً (${activeLock.reason || 'مشاركة الحساب'}). حاول لاحقاً أو تواصل مع الدعم.`,
        code: 'ACCOUNT_SHARING_LOCKED',
      });
    }

    // The same session the password path issues: an operator may have several devices, so the concurrency claim is decided here too.
    const [[staffRow]] = await pool.query(
      `SELECT 1 AS ok FROM staff WHERE tenant_id=? AND is_active=1
        AND email<>'' AND LOWER(TRIM(email))=LOWER(TRIM(?)) LIMIT 1`, [tenantId, user.email || '']);
    const isOperator = Boolean(staffRow) || isInstituteOwner({ email: user.email, uid: user.id, tenantId });
    const session = await rotateSingleSession(pool, { userId: user.id, tenantId, req, allowConcurrent: isOperator });
    invalidateIdentity(tenantId, user.id, user.email);
    const token = signAccessToken({
      uid: user.id, email: user.email, tenantId,
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: true,
      isStaff: isOperator,
    });
    pool.query('UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login = NOW() WHERE id=? AND tenant_id=?', [user.id, tenantId])
      .catch(() => {});
    setAuthCookie(res, token);
    await logLoginAttempt({ userId: user.id, email: user.email, req, tenantId, status: '2fa_success' });
    const sharing = await enforceSharingLimit({ tenantId, userId: user.id, email: user.email });
    if (sharing.locked) {
      await logLoginAttempt({ userId: user.id, email: user.email, req, tenantId, status: 'failed', failureReason: 'sharing_limit_locked' });
      return res.status(423).json({
        error: `تم إيقاف الحساب مؤقتاً بعد تسجيل الدخول من ${sharing.distinctDevices} أجهزة مختلفة. تواصل مع الدعم.`,
        code: 'ACCOUNT_SHARING_LOCKED',
      });
    }
    res.json({ ok: true, user: { uid: user.id, email: user.email, displayName: user.name || '' } });
  } catch (e) {
    if (e.code === 'DEVICE_LIMIT') return res.status(403).json({ error: e.message, code: e.code });
    logger.error('[login/email-code/verify]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login/email-code/resend  { pendingToken } — a new code; the one before stops working.
router.post('/api/auth/login/email-code/resend', otpLimiter, async (req, res) => {
  try {
    const found = await pendingAccount(req);
    if (!found.user) return res.status(found.status).json(found.body);
    await sendLoginCode(pool, { tenantId: found.tenantId, userId: found.user.id, email: found.user.email, name: found.user.name });
    res.json({ ok: true, expiresInMinutes: CODE_TTL_MINUTES, resendAfterSeconds: RESEND_AFTER_SECONDS });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message, code: e.code });
    logger.error('[login/email-code/resend]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
