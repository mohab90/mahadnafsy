'use strict';
// Token refresh and two-factor sign-in.
// One part of routes/auth.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  logger,
  jwt,
  pool,
  JWT_SECRET,
  signAccessToken,
  setAuthCookie,
  tokenExpiryMs,
  revokeToken,
  ADMIN_EMAILS,
  ADMIN_UIDS,
  requireAuth,
  invalidateIdentity,
  loginLimiter,
  otpLimiter,
  logLoginAttempt,
  getMfaPolicy,
  policyRequiresStaff,
  getClientIp,
  hashClientIp,
  rotateSingleSession,
} = require('./_shared');

const router = Router();

// NOTE: duplicate POST /api/auth/forgot-password (temp-password flow) removed.
// The OTP-based flow above (loginLimiter, sends OTP code) is the correct active handler.

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
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TOTP 2FA — Admin/Staff authenticator app support
// Uses otplib (RFC 6238) + qrcode for setup
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/auth/2fa/status — check if 2FA is enabled for current staff
router.get('/api/auth/2fa/status', requireAuth, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT totp_enabled FROM users WHERE tenant_id=? AND id=? LIMIT 1',
      [req.tenantId, req.user.uid]
    );
    res.json({ enabled: !!row?.totp_enabled });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/auth/2fa/setup — generate TOTP secret + QR code for current staff
router.post('/api/auth/2fa/setup', requireAuth, async (req, res) => {
  try {
    const { generateSecret, generateURI } = require('otplib');
    const QRCode = require('qrcode');
    const email = req.user.email?.toLowerCase().trim();
    const [[user]] = await pool.query(
      'SELECT id, name, totp_enabled FROM users WHERE tenant_id=? AND id=? AND is_active=1 LIMIT 1',
      [req.tenantId, req.user.uid]
    );
    if (!user) return res.status(403).json({ error: 'User account not found' });
    if (user.totp_enabled) {
      return res.status(409).json({ error: '2FA is already enabled; disable it before creating a new secret' });
    }

    const secret = generateSecret();
    const issuer = 'معهد الدراسات النفسية';
    const otpAuthUrl = generateURI({ label: email, issuer, secret });
    const qrDataUrl = await QRCode.toDataURL(otpAuthUrl);

    // Store secret but don't enable yet — only enable after first successful verify
    await pool.query(
      'UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=? AND tenant_id=?',
      [secret, user.id, req.tenantId]
    );
    await pool.query(
      'UPDATE staff SET totp_secret=?, totp_enabled=0 WHERE tenant_id=? AND LOWER(TRIM(email))=?',
      [secret, req.tenantId, email]
    ).catch(() => {});
    res.json({ secret, qrDataUrl, otpAuthUrl });
  } catch (e) {
    logger.error('[2fa/setup]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/2fa/enable — verify TOTP token and activate 2FA
router.post('/api/auth/2fa/enable', requireAuth, loginLimiter, async (req, res) => {
  try {
    const { token: totpToken } = req.body || {};
    if (!totpToken) return res.status(400).json({ error: 'TOTP token required' });
    const { verify } = require('otplib');
    const email = req.user.email?.toLowerCase().trim();
    const [[user]] = await pool.query(
      'SELECT id, totp_secret, session_version FROM users WHERE tenant_id=? AND id=? AND is_active=1 LIMIT 1',
      [req.tenantId, req.user.uid]
    );
    if (!user?.totp_secret) return res.status(400).json({ error: 'Setup not initiated — call /2fa/setup first' });

    const { valid } = await verify({
      token: String(totpToken), secret: user.totp_secret, epochTolerance: 30,
    });
    if (!valid) return res.status(400).json({ error: 'الرمز غير صحيح — تحقق من الوقت على جهازك' });

    await pool.query(
      'UPDATE users SET totp_enabled=1 WHERE id=? AND tenant_id=?',
      [user.id, req.tenantId]
    );
    await pool.query(
      'UPDATE staff SET totp_secret=?, totp_enabled=1 WHERE tenant_id=? AND LOWER(TRIM(email))=?',
      [user.totp_secret, req.tenantId, email]
    ).catch(() => {});
    const session = await rotateSingleSession(pool, {
      userId: user.id, tenantId: req.tenantId, req,
      allowConcurrent: req.user.is_staff === true,
    });
    invalidateIdentity(req.tenantId, user.id, email);
    const fullToken = signAccessToken({
      uid: user.id, email, tenantId: req.tenantId,
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: true,
      isStaff: req.user.is_staff === true,
    });
    setAuthCookie(res, fullToken);
    res.json({ ok: true, message: 'تم تفعيل المصادقة الثنائية بنجاح' });
  } catch (e) {
    logger.error('[2fa/enable]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/2fa/disable — disable 2FA (requires current TOTP or admin override)
router.post('/api/auth/2fa/disable', requireAuth, async (req, res) => {
  try {
    const { token: totpToken } = req.body || {};
    const email = req.user.email?.toLowerCase().trim();
    const [[user]] = await pool.query(
      'SELECT id, totp_secret, totp_enabled, session_version FROM users WHERE tenant_id=? AND id=? LIMIT 1',
      [req.tenantId, req.user.uid]
    );
    if (!user) return res.status(403).json({ error: 'User account not found' });
    const [[staff]] = await pool.query(
      'SELECT role, permissions_json FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? AND is_active=1 LIMIT 1',
      [req.tenantId, email]
    ).catch(() => [[null]]);
    const policy = await getMfaPolicy(req.tenantId);
    const forcedAdmin = ADMIN_EMAILS.includes(String(req.user.email || '').trim().toLowerCase()) || ADMIN_UIDS.includes(req.user.uid);
    if (policy.enabled && (forcedAdmin || policyRequiresStaff(policy, staff))) {
      return res.status(409).json({
        error: 'لا يمكن تعطيل المصادقة الثنائية لأن سياسة أمان المؤسسة تفرضها على هذا الحساب',
        code: 'MFA_POLICY_ENFORCED',
      });
    }

    if (user.totp_enabled) {
      if (!totpToken) return res.status(400).json({ error: 'TOTP token required to disable 2FA' });
      const { verify } = require('otplib');
      const { valid } = await verify({
        token: String(totpToken), secret: user.totp_secret, epochTolerance: 30,
      });
      if (!valid) return res.status(400).json({ error: 'الرمز غير صحيح' });
    }
    await pool.query(
      `UPDATE users
       SET totp_enabled=0, totp_secret=NULL
       WHERE id=? AND tenant_id=?`,
      [user.id, req.tenantId]
    );
    await pool.query(
      'UPDATE staff SET totp_enabled=0, totp_secret=NULL WHERE tenant_id=? AND LOWER(TRIM(email))=?',
      [req.tenantId, email]
    ).catch(() => {});
    const session = await rotateSingleSession(pool, {
      userId: user.id, tenantId: req.tenantId, req,
      allowConcurrent: req.user.is_staff === true,
    });
    invalidateIdentity(req.tenantId, user.id, email);
    const token = signAccessToken({
      uid: user.id, email, tenantId: req.tenantId,
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: false,
      isStaff: req.user.is_staff === true,
    });
    setAuthCookie(res, token);
    res.json({ ok: true, message: 'تم تعطيل المصادقة الثنائية' });
  } catch (e) {
    logger.error('[2fa/disable]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/2fa/verify — verify TOTP during login (returns full JWT)
// Called after successful password login when totp_enabled=1 for admin/staff
router.post('/api/auth/2fa/verify', otpLimiter, async (req, res) => {
  try {
    const { pendingToken, token: totpToken } = req.body || {};
    if (!pendingToken || !totpToken) return res.status(400).json({ error: 'pendingToken and token required' });
    const { verify } = require('otplib');

    // Decode the pending token (limited JWT issued before TOTP check)
    let payload;
    try {
      payload = jwt.verify(pendingToken, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (_) {
      return res.status(401).json({ error: 'رمز انتهت صلاحيته — أعد تسجيل الدخول' });
    }
    if (payload.purpose !== 'totp_pending') return res.status(400).json({ error: 'رمز غير صالح' });
    if (!payload.iph || payload.iph !== hashClientIp(getClientIp(req))) {
      return res.status(401).json({
        error: 'يجب إكمال التحقق من نفس عنوان الاتصال الذي بدأ تسجيل الدخول',
        code: 'SESSION_IP_MISMATCH',
      });
    }

    const tenantId = payload.tid || req.tenantId;
    const [[user]] = await pool.query(
      `SELECT session_version, totp_secret FROM users
       WHERE id=? AND tenant_id=? AND is_active=1 AND totp_enabled=1 LIMIT 1`,
      [payload.uid, tenantId]
    );
    if (!user?.totp_secret) return res.status(400).json({ error: 'TOTP not configured' });
    if (!user || Number(payload.sv) !== Number(user.session_version)) {
      return res.status(401).json({ error: 'انتهت صلاحية الجلسة — أعد تسجيل الدخول', code: 'SESSION_REVOKED' });
    }

    const { valid } = await verify({
      token: String(totpToken), secret: user.totp_secret, epochTolerance: 30,
    });
    if (!valid) return res.status(401).json({ error: 'رمز المصادقة غير صحيح' });

    // Issue full JWT. This is the door an operator with 2FA comes through, so
    // the concurrency claim has to be decided here too — the login route's copy
    // never runs for them.
    const [[staffRow]] = await pool.query(
      `SELECT 1 AS ok FROM staff WHERE tenant_id=? AND is_active=1
        AND email<>'' AND LOWER(TRIM(email))=LOWER(TRIM(?)) LIMIT 1`,
      [tenantId, payload.email || '']
    );
    const isOperator = Boolean(staffRow)
      || ADMIN_EMAILS.some(e => String(e).toLowerCase() === String(payload.email || '').toLowerCase())
      || ADMIN_UIDS.includes(payload.uid);
    const session = await rotateSingleSession(pool, {
      userId: payload.uid, tenantId, req, allowConcurrent: isOperator,
    });
    invalidateIdentity(tenantId, payload.uid, payload.email);
    const fullToken = signAccessToken({
      uid: payload.uid, email: payload.email, tenantId,
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: true,
      isStaff: isOperator,
    });
    setAuthCookie(res, fullToken);
    await logLoginAttempt({ userId: payload.uid, email: payload.email, req, tenantId: payload.tid || req.tenantId, status: '2fa_success' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'DEVICE_LIMIT') return res.status(403).json({ error: e.message, code: e.code });
    logger.error('[2fa/verify]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
