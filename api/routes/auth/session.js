'use strict';
// Signing in and out: /api/auth/login, /logout, /me.
// One part of routes/auth.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  logger,
  bcrypt,
  jwt,
  uuidv4,
  pool,
  requireDb,
  JWT_SECRET,
  signAccessToken,
  setAuthCookie,
  clearAuthCookie,
  tokenExpiryMs,
  revokeToken,
  isInstituteOwner,
  requireAuth,
  requireAdmin,
  invalidateIdentity,
  loginLimiter,
  isString,
  isEmail,
  validateBody,
  logLoginAttempt,
  FULL_ACCESS_ROLES,
  resolvePermissions,
  getClientIp,
  hashClientIp,
  rotateSingleSession,
  closeSingleSession,
  getSharingLock,
  enforceSharingLimit,
  normalizeWhatsAppNumber,
  isPlausibleNumber,
  identitySpellings,
} = require('./_shared');

const router = Router();

// POST /api/auth/login
router.post('/api/auth/login', loginLimiter, requireDb,
  validateBody({
    email:    v => isEmail(v) || isPlausibleNumber(normalizeWhatsAppNumber(v)) || 'البريد الإلكتروني أو رقم الهاتف غير صحيح',
    password: v => isString(v, 200)   || 'Password is required',
  }),
  async (req, res) => {
  // Identifier is an email OR a WhatsApp number typed into the same field;
  // whichever shape it has decides which column it's looked up against.
  // Email login is a permanent, first-class path — most existing customers
  // only ever had an email account, and a missing env var must never be able
  // to lock all of them out again the way it did when this was gated behind
  // AUTH_ALLOW_EMAIL_LOGIN.
  const { email: rawIdentifier, password } = req.body || {};
  const identifierIsEmail = isEmail(rawIdentifier);
  const email = identifierIsEmail ? rawIdentifier.toLowerCase().trim() : null;
  const phoneIdentity = identifierIsEmail ? null : normalizeWhatsAppNumber(rawIdentifier);
  const logIdentifier = identifierIsEmail ? email : phoneIdentity;
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = identifierIsEmail
      ? await conn.execute(
          `SELECT u.id, u.email, u.name, u.password_hash, u.session_version, u.totp_enabled,
                  EXISTS(SELECT 1 FROM staff s WHERE s.tenant_id=u.tenant_id AND s.is_active=1
                          AND s.email<>'' AND LOWER(TRIM(s.email))=LOWER(TRIM(u.email))) AS is_staff
           FROM users u WHERE u.tenant_id=? AND u.email = ? AND u.is_active = 1`,
          [req.tenantId, email])
      // Every spelling the number can be stored as, not the one this normaliser
      // happens to produce. `u.phone = ?` compared against toIdentity() only
      // finds an account whose stored phone is already in identity form —
      // 1012345678. Rows written by an import, by staff creating the account, or
      // by any path that saved what the customer typed hold 01012345678 or
      // 201012345678 instead, and their owner could not sign in with the very
      // number they gave: 16 accounts on production are in that state, and for a
      // customer with no email on file it is their only way in.
      //
      // Exact set, never a trailing wildcard — see lib/leadMatching.js for why
      // "ends with these digits" is not the same as "is this number".
      : await (async () => {
        const spellings = identitySpellings(rawIdentifier);
        if (!spellings.length) return [[]];
        return conn.execute(
          `SELECT u.id, u.email, u.name, u.password_hash, u.session_version, u.totp_enabled,
                  EXISTS(SELECT 1 FROM staff s WHERE s.tenant_id=u.tenant_id AND s.is_active=1
                          AND s.email<>'' AND LOWER(TRIM(s.email))=LOWER(TRIM(u.email))) AS is_staff
           FROM users u
            WHERE u.tenant_id=? AND u.is_active = 1
              AND u.phone IN (${spellings.map(() => '?').join(',')})
            LIMIT 1`,
          [req.tenantId, ...spellings]);
      })();
    if (rows.length === 0) {
      // No users record — check whether they exist as a subscriber (a client the
      // desk added). Looked up by phone as well as by email now: a client with
      // no email on file who types the number the institute has for them used to
      // fall straight through to "no active account", which tells a paying
      // customer they do not exist. 28 subscribers on production have no email,
      // and for them the phone is the only identifier there is.
      const [[subExists]] = await (async () => {
        if (identifierIsEmail) {
          return conn.execute(
            'SELECT id, email FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email)) = ? AND is_active = 1 LIMIT 1',
            [req.tenantId, email]
          );
        }
        const spellings = identitySpellings(rawIdentifier);
        if (!spellings.length) return [[null]];
        return conn.execute(
          `SELECT id, email FROM subscribers
            WHERE tenant_id=? AND is_active = 1 AND deleted_at IS NULL
              AND REGEXP_REPLACE(phone,'[^0-9]','') IN (${spellings.map(() => '?').join(',')})
            LIMIT 1`,
          [req.tenantId, ...spellings]
        );
      })();
      conn.release();
      conn = null;
      if (subExists) {
        // "Press forgot password" sends a code to an email address. A client who
        // has none cannot act on that, so they are pointed at the WhatsApp code
        // instead — the route that does work for them, and the one that creates
        // their account on first use.
        const hasEmail = Boolean(String(subExists.email || '').trim());
        logger.info('[login] subscriber exists but no users record — directing to %s:',
          hasEmail ? 'reset' : 'whatsapp code', logIdentifier);
        await logLoginAttempt({ email: logIdentifier, req, status: 'failed', failureReason: 'password_not_set' });
        return res.status(401).json({
          error: hasEmail
            ? '\u0644\u0645 \u064a\u062a\u0645 \u062a\u0639\u064a\u064a\u0646 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0644\u0647\u0630\u0627 \u0627\u0644\u062d\u0633\u0627\u0628 \u0628\u0639\u062f. \u064a\u0631\u062c\u0649 \u0627\u0644\u0636\u063a\u0637 \u0639\u0644\u0649 "\u0646\u0633\u064a\u062a \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631" \u0644\u062a\u0639\u064a\u064a\u0646 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u062c\u062f\u064a\u062f\u0629.'
            : '\u062d\u0633\u0627\u0628\u0643 \u0645\u0633\u062c\u0651\u0644 \u0628\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641 \u0648\u0628\u062f\u0648\u0646 \u0628\u0631\u064a\u062f \u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a. \u0627\u062f\u062e\u0644 \u0639\u0646 \u0637\u0631\u064a\u0642 "\u0627\u0644\u062f\u062e\u0648\u0644 \u0628\u0631\u0642\u0645 \u0627\u0644\u0648\u0627\u062a\u0633\u0627\u0628" \u2014 \u0647\u064a\u0648\u0635\u0644\u0643 \u0643\u0648\u062f \u0639\u0644\u0649 \u0646\u0641\u0633 \u0627\u0644\u0631\u0642\u0645.',
          needsPasswordReset: hasEmail,
          useWhatsappLogin: !hasEmail,
        });
      }
      logger.info('[login] no active account for:', logIdentifier);
      await logLoginAttempt({ email: logIdentifier, req, status: 'failed', failureReason: 'account_not_found' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = rows[0];
    // Do not hold a scarce MySQL connection while bcrypt runs or while
    // logLoginAttempt acquires its own connection. At pool-sized login bursts
    // that otherwise forms a circular wait and every request times out.
    conn.release();
    conn = null;
    // Refuse before verifying the password: an account serving a sharing lock
    // shouldn't be sign-in-able even with correct credentials.
    const activeLock = await getSharingLock(req.tenantId || 'tenant-default', user.id);
    if (activeLock.locked) {
      await logLoginAttempt({
        userId: user.id, email: user.email, req, status: 'failed', failureReason: 'sharing_locked',
      });
      return res.status(423).json({
        error: `الحساب موقوف مؤقتاً بسبب الاستخدام من أجهزة متعددة (${activeLock.reason || 'مشاركة الحساب'}). حاول لاحقاً أو تواصل مع الدعم.`,
        code: 'ACCOUNT_SHARING_LOCKED',
      });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      logger.info('[login] wrong password for:', logIdentifier);
      await logLoginAttempt({ userId: user.id, email: user.email, req, status: 'failed', failureReason: 'wrong_password' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // ── Admin 2FA: check if this user is a staff member with TOTP enabled ──
    if (user.totp_enabled) {
      // Issue a short-lived "pending" token — full session not granted until TOTP verified
      const loginIp = getClientIp(req);
      const pendingToken = jwt.sign(
        {
          uid: user.id, email: user.email, tid: req.tenantId || 'tenant-default',
          sv: Number(user.session_version), iph: hashClientIp(loginIp),
          purpose: 'totp_pending', jti: uuidv4(),
        },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      await logLoginAttempt({ userId: user.id, email: user.email, req, status: '2fa_pending' });
      return res.json({ ok: false, totpRequired: true, pendingToken });
    }
    // Configured administrators count as staff for the concurrent-device rule.
    // is_staff is derived purely from the `staff` table, but an owner listed in
    // ADMIN_EMAILS/ADMIN_UIDS may have no row there at all — and that account is
    // the one most likely to have the admin panel and the public site open at
    // once, which are the same login. Without this it fell under the one-device
    // rule and evicted itself on every sign-in: the "logged out every few
    // minutes" report, with session_version climbing into the dozens.
    //
    // The rule exists to stop a paid account being shared for course video, so
    // customers keep it. This grants no permission — only concurrency.
    const isOperator = Boolean(user.is_staff)
      || isInstituteOwner({ email: user.email, uid: user.id, tenantId: req.tenantId });
    const session = await rotateSingleSession(pool, {
      userId: user.id, tenantId: req.tenantId || 'tenant-default', req,
      allowConcurrent: isOperator,
    });
    invalidateIdentity(req.tenantId, user.id, user.email);
    const token = signAccessToken({
      uid: user.id, email: user.email, tenantId: req.tenantId || 'tenant-default',
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: false,
      // Signed into the token so middleware/auth.js never queries `staff` itself
      // (every staff lookup there must go through the tenant-scoped helper).
      // Decides concurrent-device allowance only — it grants no permission.
      isStaff: isOperator,
    });
    // Link subscriber record to this user account (best-effort)
    pool.query(
      `UPDATE subscribers SET firebase_uid = ? WHERE tenant_id=? AND LOWER(TRIM(email)) = ? AND firebase_uid IS NULL LIMIT 1`,
      [user.id, req.tenantId, user.email]
    ).catch(() => {});
    // Track login count and last login. Columns are owned by migrations, not the login path.
    pool.query(
      `UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login = NOW() WHERE id = ? AND tenant_id=?`,
      [user.id, req.tenantId]
    ).catch(() => {});
    // NOTE: Do NOT auto-create a subscriber record on login.
    // Only real paid subscribers (created by admin staff) should appear in the subscribers table.
    // Unenrolled users will see the "حسابك قيد المراجعة" screen after login — this is intentional.
    setAuthCookie(res, token);
    await logLoginAttempt({ userId: user.id, email: user.email, req, status: 'success' });
    // Runs AFTER the attempt is recorded so the current IP counts. If this login
    // pushes the account past the allowance it is suspended and the session just
    // issued is revoked, so the token above stops working on the next request.
    const sharing = await enforceSharingLimit({
      tenantId: req.tenantId || 'tenant-default', userId: user.id, email: user.email,
    });
    if (sharing.locked) {
      return res.status(423).json({
        error: `تم إيقاف الحساب مؤقتاً بعد تسجيل الدخول من ${sharing.distinctIps} شبكات مختلفة. تواصل مع الدعم.`,
        code: 'ACCOUNT_SHARING_LOCKED',
      });
    }
    res.json({ ok: true, user: { uid: user.id, email: user.email, displayName: user.name || '' } });
  } catch (err) {
    // A third device (lib/customerDevices.js): refused with the reason.
    if (err?.code === 'DEVICE_LIMIT' && !res.headersSent) {
      await logLoginAttempt({ email: String(rawIdentifier || '').toLowerCase().trim(), req, status: 'failed', failureReason: 'device_limit' })
        .catch(() => {});
      return res.status(403).json({ error: err.message, code: err.code });
    }
    logger.error('[auth/login]', err);
    if (!res.headersSent) {
      const status = err && ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(err.code) ? 503 : 500;
      res.status(status).json({ error: status === 503 ? 'Database unavailable' : 'Login failed' });
    }
  } finally { if (conn) conn.release(); }
});

// POST /api/auth/logout — invalidate token immediately (client must clear storage too)
router.post('/api/auth/logout', requireAuth, async (req, res) => {
  const { jti } = req.user || {};
  if (jti) await revokeToken(jti, tokenExpiryMs(req.user));
  await closeSingleSession(pool, {
    userId: req.user.uid, tenantId: req.tenantId, sessionId: req.user.session_id,
  });
  invalidateIdentity(req.tenantId, req.user.uid, req.user.email);
  clearAuthCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/api/auth/me', requireAuth, requireDb, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT id, email, name, phone FROM users WHERE id = ? AND tenant_id=?', [req.user.uid, req.tenantId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    let isAdmin = isInstituteOwner({ email: u.email, uid: u.id, tenantId: req.tenantId });
    let staffPermissions = null;
    if (!isAdmin) {
      // Staff with a full-access role — the list requireAdmin enforces. This
      // kept a list of its own that added daqqi_manager and online_manager, so
      // the panel showed those two every section and skipped their permission
      // checks while the server refused them the data behind it.
      const [[staff]] = u.email ? await conn.execute(
        `SELECT role, permissions_json FROM staff WHERE tenant_id=? AND LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1`,
        [req.tenantId, u.email.toLowerCase().trim()]
      ) : [[null]];
      if (staff && FULL_ACCESS_ROLES.includes(String(staff.role || '').toLowerCase())) isAdmin = true;
      // What this employee may do, decided once, here. The panel's first load
      // asks for a dozen lists and used to send them all whatever the account:
      // for anyone but an admin most came back 403, on every page load. It can
      // ask for what it holds now, and it holds this before the first request.
      // null for a customer, who is not staff at all.
      staffPermissions = staff ? resolvePermissions({ role: staff.role, permissions_json: staff.permissions_json }) : null;
    }
    // Surface the user's phone. Subscriber and lead rows come first because they
    // carry the number the desk has actually been calling; users.phone is the
    // fallback.
    //
    // That fallback was missing, and the comment here still claimed the users
    // table had no phone at all — it does, registration has stored the WhatsApp
    // identity there since 196_v25_phone_identity_leads_unique. A customer who
    // had just signed up with their number, and was not yet a subscriber or a
    // lead, got an empty string back: checkout then asked them to type in the
    // number they had given one screen earlier.
    let phone = '';
    try {
      const em = (u.email || '').toLowerCase().trim();
      if (em) {
        const [[subRow]] = await conn.execute(
          "SELECT phone FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? AND phone IS NOT NULL AND phone<>'' LIMIT 1", [req.tenantId, em]
        );
        phone = subRow?.phone || '';
        if (!phone) {
          const [[leadRow]] = await conn.execute(
            "SELECT phone FROM leads WHERE tenant_id=? AND LOWER(TRIM(email))=? AND phone IS NOT NULL AND phone<>'' ORDER BY created_at DESC LIMIT 1", [req.tenantId, em]
          );
          phone = leadRow?.phone || '';
        }
      }
      if (!phone) phone = u.phone || '';
    } catch { /* phone is best-effort */ }
    res.json({ uid: u.id, email: u.email, displayName: u.name || '', phone, isAdmin, permissions: isAdmin ? '*' : staffPermissions });
  } catch (err) {
    logger.error('[auth/me]', err);
    if (!res.headersSent) {
      const status = err && ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(err.code) ? 503 : 500;
      res.status(status).json({ error: status === 503 ? 'Database unavailable' : 'Server error' });
    }
  } finally { if (conn) conn.release(); }
});

module.exports = router;
