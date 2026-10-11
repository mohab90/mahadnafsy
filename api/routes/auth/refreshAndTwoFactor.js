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
  isInstituteOwner,
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
const {
  clearRecoveryCodes,
  consumeRecoveryCode,
  readTotpSecret,
  recoveryCodesLeft,
  replaceRecoveryCodes,
  sealLegacySecret,
  sealTotpSecret,
} = require('../../lib/twoFactor');
const { writeAuditEvent } = require('../../lib/auditTrail');

const router = Router();

// The secret in totp_secret is sealed now (lib/twoFactor.js); one written
// before that is plain text and is still accepted. `legacy` tells the caller to
// seal it once it has proved itself, `unreadable` that the sealing key changed.
async function checkTotp(stored, token) {
  const { secret, legacy, unreadable } = readTotpSecret(stored);
  if (!secret || !token) return { valid: false, legacy, unreadable, secret: null };
  const { verify } = require('otplib');
  const { valid } = await verify({ token: String(token), secret, epochTolerance: 30 });
  return { valid, legacy, unreadable, secret };
}

const UNREADABLE_SECRET = {
  error: 'تعذّر قراءة مفتاح المصادقة على السيرفر — استخدم كود استرجاع، أو اطلب من المدير يشيل التحقق الثنائي',
  code: 'TOTP_UNREADABLE',
};

// A best-effort note in the audit trail: signing in must not fail because the
// trail could not be written, but it says so in the log.
function auditQuietly(event) {
  return writeAuditEvent(event).catch(error => logger.warn('[2fa] audit write failed', { action: event.action, err: error.message }));
}

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
    const enabled = !!row?.totp_enabled;
    // How many one-time codes are left, so the screen can say «فاضل ٢ بس».
    const left = enabled ? await recoveryCodesLeft(pool, { tenantId: req.tenantId, userId: req.user.uid }).catch(() => null) : null;
    res.json({ enabled, recoveryCodesLeft: left });
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

    // Store secret but don't enable yet — only enable after first successful verify.
    // Sealed: the plain secret leaves the server once, in this response, for
    // the authenticator app; the tables only ever see the sealed form.
    const sealed = sealTotpSecret(secret);
    await pool.query(
      'UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=? AND tenant_id=?',
      [sealed, user.id, req.tenantId]
    );
    await pool.query(
      'UPDATE staff SET totp_secret=?, totp_enabled=0 WHERE tenant_id=? AND LOWER(TRIM(email))=?',
      [sealed, req.tenantId, email]
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
    const email = req.user.email?.toLowerCase().trim();
    const [[user]] = await pool.query(
      'SELECT id, totp_secret, session_version FROM users WHERE tenant_id=? AND id=? AND is_active=1 LIMIT 1',
      [req.tenantId, req.user.uid]
    );
    if (!user?.totp_secret) return res.status(400).json({ error: 'Setup not initiated — call /2fa/setup first' });

    const check = await checkTotp(user.totp_secret, totpToken);
    if (check.unreadable) return res.status(409).json({ ...UNREADABLE_SECRET, error: 'ابدأ الإعداد من جديد — تعذّر قراءة المفتاح المحفوظ' });
    if (!check.valid) return res.status(400).json({ error: 'الرمز غير صحيح — تحقق من الوقت على جهازك' });
    // A secret set up before sealing existed is sealed as it is switched on.
    const stored = check.legacy ? sealTotpSecret(check.secret) : user.totp_secret;

    await pool.query(
      'UPDATE users SET totp_enabled=1 WHERE id=? AND tenant_id=?',
      [user.id, req.tenantId]
    );
    if (check.legacy) {
      await pool.query('UPDATE users SET totp_secret=? WHERE id=? AND tenant_id=?', [stored, user.id, req.tenantId]);
    }
    await pool.query(
      'UPDATE staff SET totp_secret=?, totp_enabled=1 WHERE tenant_id=? AND LOWER(TRIM(email))=?',
      [stored, req.tenantId, email]
    ).catch(() => {});
    // Shown once, in this response; only their hashes are kept.
    const recoveryCodes = await replaceRecoveryCodes(pool, { tenantId: req.tenantId, userId: user.id });
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
    res.json({ ok: true, message: 'تم تفعيل المصادقة الثنائية بنجاح', recoveryCodes });
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
    const forcedAdmin = isInstituteOwner({ email: req.user.email, uid: req.user.uid, tenantId: req.tenantId });
    if (policy.enabled && (forcedAdmin || policyRequiresStaff(policy, staff))) {
      return res.status(409).json({
        error: 'لا يمكن تعطيل المصادقة الثنائية لأن سياسة أمان المؤسسة تفرضها على هذا الحساب',
        code: 'MFA_POLICY_ENFORCED',
      });
    }

    if (user.totp_enabled) {
      if (!totpToken) return res.status(400).json({ error: 'TOTP token required to disable 2FA' });
      const check = await checkTotp(user.totp_secret, totpToken);
      if (check.unreadable) return res.status(409).json(UNREADABLE_SECRET);
      if (!check.valid) return res.status(400).json({ error: 'الرمز غير صحيح' });
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
    // Codes for a factor that no longer exists would be a way in on their own
    // the day 2FA is switched back on.
    await clearRecoveryCodes(pool, { tenantId: req.tenantId, userIds: [user.id] });
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

// POST /api/auth/2fa/recovery-codes — a new set of ten, for someone who used
// some or lost the paper. The current authenticator code is the proof; the old
// set stops working the moment the new one is written.
router.post('/api/auth/2fa/recovery-codes', requireAuth, loginLimiter, async (req, res) => {
  try {
    const { token: totpToken } = req.body || {};
    if (!totpToken) return res.status(400).json({ error: 'أدخل الرمز الحالي من تطبيق المصادقة' });
    const email = req.user.email?.toLowerCase().trim();
    const [[user]] = await pool.query(
      'SELECT id, totp_secret, totp_enabled FROM users WHERE tenant_id=? AND id=? AND is_active=1 LIMIT 1',
      [req.tenantId, req.user.uid]
    );
    if (!user?.totp_enabled) return res.status(409).json({ error: 'المصادقة الثنائية مش مفعّلة على الحساب ده' });
    const check = await checkTotp(user.totp_secret, totpToken);
    if (check.unreadable) return res.status(409).json(UNREADABLE_SECRET);
    if (!check.valid) return res.status(400).json({ error: 'الرمز غير صحيح' });
    if (check.legacy) {
      await sealLegacySecret(pool, { tenantId: req.tenantId, userId: user.id, email, secret: check.secret })
        .catch(error => logger.warn('[2fa] could not seal a legacy secret', { err: error.message }));
    }
    const recoveryCodes = await replaceRecoveryCodes(pool, { tenantId: req.tenantId, userId: user.id });
    await auditQuietly({
      req, action: 'auth.mfa.recovery_codes_regenerated', entityType: 'user', entityId: user.id,
      metadata: { issued: recoveryCodes.length },
    });
    res.json({ ok: true, recoveryCodes });
  } catch (e) {
    logger.error('[2fa/recovery-codes]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/2fa/verify — verify TOTP during login (returns full JWT)
// Called after successful password login when totp_enabled=1 for admin/staff
router.post('/api/auth/2fa/verify', otpLimiter, async (req, res) => {
  try {
    // A recovery code stands in for the authenticator code when the phone is
    // gone; it is burned the moment it is accepted.
    const { pendingToken, token: totpToken, recoveryCode } = req.body || {};
    if (!pendingToken || (!totpToken && !recoveryCode)) {
      return res.status(400).json({ error: 'pendingToken and token (or recoveryCode) required' });
    }

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

    let recoveryCodeUsed = false;
    if (recoveryCode) {
      const consumed = await consumeRecoveryCode(pool, { tenantId, userId: payload.uid, code: recoveryCode });
      if (!consumed) {
        return res.status(401).json({ error: 'كود الاسترجاع غير صحيح أو اتستخدم قبل كده', code: 'RECOVERY_CODE_INVALID' });
      }
      recoveryCodeUsed = true;
    } else {
      const check = await checkTotp(user.totp_secret, totpToken);
      if (check.unreadable) return res.status(401).json(UNREADABLE_SECRET);
      if (!check.valid) return res.status(401).json({ error: 'رمز المصادقة غير صحيح' });
      // Written in plain text before secrets were sealed: sealed now that it
      // has proved itself. A failure here must not cost the sign-in.
      if (check.legacy) {
        await sealLegacySecret(pool, { tenantId, userId: payload.uid, email: payload.email, secret: check.secret })
          .catch(error => logger.warn('[2fa] could not seal a legacy secret', { err: error.message }));
      }
    }

    // Issue full JWT. This is the door an operator with 2FA comes through, so
    // the concurrency claim has to be decided here too — the login route's copy
    // never runs for them.
    const [[staffRow]] = await pool.query(
      `SELECT 1 AS ok FROM staff WHERE tenant_id=? AND is_active=1
        AND email<>'' AND LOWER(TRIM(email))=LOWER(TRIM(?)) LIMIT 1`,
      [tenantId, payload.email || '']
    );
    const isOperator = Boolean(staffRow)
      || isInstituteOwner({ email: payload.email, uid: payload.uid, tenantId });
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
    if (recoveryCodeUsed) {
      const left = await recoveryCodesLeft(pool, { tenantId, userId: payload.uid }).catch(() => null);
      await auditQuietly({
        // Nobody is signed in yet, so the actor is the account itself.
        req: { tenantId, user: { uid: payload.uid, email: payload.email }, ip: req.ip, headers: req.headers },
        action: 'auth.mfa.recovery_code_used', entityType: 'user', entityId: payload.uid, severity: 'warning',
        metadata: { remaining: left },
      });
      return res.json({ ok: true, recoveryCodesLeft: left });
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'DEVICE_LIMIT') return res.status(403).json({ error: e.message, code: e.code });
    logger.error('[2fa/verify]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
