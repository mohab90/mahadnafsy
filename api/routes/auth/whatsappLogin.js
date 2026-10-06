'use strict';
// Signing in with a code sent on WhatsApp.
// One part of routes/auth.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  logger,
  pool,
  signAccessToken,
  setAuthCookie,
  isInstituteOwner,
  invalidateIdentity,
  otpLimiter,
  logLoginAttempt,
  rotateSingleSession,
  getSharingLock,
  enforceSharingLimit,
  requestLoginCode,
  verifyLoginCode,
  WA_CODE_TTL_MINUTES,
} = require('./_shared');

const router = Router();

// ── Forgot Password + OTP + 2FA ───────────────────────────────────────────────
// POST /api/auth/forgot-password — send 6-digit OTP via email
// ── WhatsApp sign-in ─────────────────────────────────────────────────────────
// Additive: email + password still works exactly as before. This path can't be
// exercised against a live database or a real WhatsApp send before release, so
// it is offered alongside rather than replacing the existing login — a broken
// auth change must not be able to lock everyone out.

// POST /api/auth/whatsapp/request-otp  { phone }
router.post('/api/auth/whatsapp/request-otp', otpLimiter, async (req, res) => {
  try {
    const result = await requestLoginCode({
      tenantId: req.tenantId || 'tenant-default',
      phone: req.body?.phone,
    });
    // `delivered` is intentionally not surfaced: telling the caller whether a
    // message actually went out would reveal which numbers have accounts.
    res.json({ ok: true, expiresInMinutes: WA_CODE_TTL_MINUTES });
    void result;
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    logger.error('[wa-otp] request failed', e.message);
    res.status(500).json({ error: 'تعذّر إرسال الرمز' });
  }
});

// POST /api/auth/whatsapp/verify-otp  { phone, code }
router.post('/api/auth/whatsapp/verify-otp', otpLimiter, async (req, res) => {
  const tenantId = req.tenantId || 'tenant-default';
  try {
    // `name` only matters on a first verification — it becomes the new account's
    // name. For a returning customer it is ignored, so a stale value in a
    // client-side form can never rename someone.
    const { userId, phone, created } = await verifyLoginCode({
      tenantId, phone: req.body?.phone, code: req.body?.code, name: req.body?.name,
    });

    // is_staff the same way the password path reads it: without it every
    // employee signing in by WhatsApp fell under the one-device rule and lost
    // the panel open on their desktop (user.is_staff was always undefined here).
    const [[user]] = await pool.query(
      `SELECT u.id, u.email, u.name,
              EXISTS(SELECT 1 FROM staff s WHERE s.tenant_id=u.tenant_id AND s.is_active=1
                      AND s.email<>'' AND LOWER(TRIM(s.email))=LOWER(TRIM(u.email))) AS is_staff
         FROM users u WHERE u.id=? AND u.tenant_id=? AND u.is_active=1 LIMIT 1`,
      [userId, tenantId]
    );
    if (!user) return res.status(401).json({ error: 'الحساب غير متاح' });

    // Same sharing lock the password path enforces — the sign-in method must not
    // be a way around it.
    const activeLock = await getSharingLock(tenantId, user.id);
    if (activeLock.locked) {
      await logLoginAttempt({ userId: user.id, email: user.email, req, status: 'failed', failureReason: 'sharing_locked' });
      return res.status(423).json({
        error: `الحساب موقوف مؤقتاً (${activeLock.reason || 'مشاركة الحساب'}). حاول لاحقاً أو تواصل مع الدعم.`,
        code: 'ACCOUNT_SHARING_LOCKED',
      });
    }

    // Identical session issuance to the password path — which this comment
    // already claimed, but the code did not do. Two things were missing, and
    // both hurt the same person: an operator signing in over WhatsApp OTP.
    //
    // Without allowConcurrent the single-device rule applied to them, so an OTP
    // login evicted whatever session they already had — the admin panel open on
    // a desktop dies the moment they use OTP on a phone. That rule exists to
    // stop a paid customer account being shared for course video; staff are
    // deliberately exempt on the password path.
    //
    // Without the isStaff claim, middleware/auth.js cannot tell they are an
    // operator (it must not query `staff` itself — every staff lookup there goes
    // through the tenant-scoped helper), so the exemption would not survive the
    // next refresh even once granted.
    //
    // isOperator decides concurrency only. It grants no permission.
    const isOperator = Boolean(user.is_staff)
      || isInstituteOwner({ email: user.email, uid: user.id, tenantId });
    const session = await rotateSingleSession(pool, {
      userId: user.id, tenantId, req, allowConcurrent: isOperator,
    });
    invalidateIdentity(tenantId, user.id, user.email);
    const token = signAccessToken({
      uid: user.id, email: user.email, tenantId,
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: false,
      isStaff: isOperator,
    });
    pool.query(
      'UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login = NOW() WHERE id=? AND tenant_id=?',
      [user.id, tenantId]
    ).catch(() => {});
    setAuthCookie(res, token);
    await logLoginAttempt({ userId: user.id, email: user.email, req, status: 'success' });

    const sharing = await enforceSharingLimit({ tenantId, userId: user.id, email: user.email });
    if (sharing.locked) {
      return res.status(423).json({
        error: `تم إيقاف الحساب مؤقتاً بعد تسجيل الدخول من ${sharing.distinctIps} شبكات مختلفة. تواصل مع الدعم.`,
        code: 'ACCOUNT_SHARING_LOCKED',
      });
    }
    // A WhatsApp signup is a registration, so it feeds the CRM exactly like the
    // email one did. Without this a customer could sign up, and sales would
    // never see them: the account exists, but nobody has a lead to follow up.
    if (created) {
      require('../../lib/lifecycle').trigger('lead_created', {
        name: user.name || '',
        phone,
        tenantId,
      }, { dedupeKey: `wa-signup:${user.id}` })
        .catch(err => logger.warn('[wa-otp] lead_created journey failed', { error: err.message }));
    }

    // `created` lets the client greet a brand-new customer differently from a
    // returning one, and lets it ask for a name it did not collect up front.
    // The token goes out only as the httpOnly cookie set above. Echoing it in
    // the body too would put it back within reach of any injected script, which
    // is the whole thing the cookie migration removed — the WhatsApp OTP path
    // was the one login route still doing it.
    res.json({
      ok: true, created: Boolean(created),
      user: { uid: user.id, email: user.email, displayName: user.name || '', phone },
    });
  } catch (e) {
    if (e.statusCode) {
      const failureReason = e.code === 'DEVICE_LIMIT' ? 'device_limit' : 'wa_otp_invalid';
      await logLoginAttempt({ email: null, req, status: 'failed', failureReason }).catch(() => {});
      return res.status(e.statusCode).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    }
    logger.error('[wa-otp] verify failed', e.message);
    res.status(500).json({ error: 'تعذّر التحقق من الرمز' });
  }
});

module.exports = router;
