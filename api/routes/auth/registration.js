'use strict';
// Sign-up: /api/auth/register and /api/user/signup.
// One part of routes/auth.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  logger,
  bcrypt,
  uuidv4,
  pool,
  requireDb,
  enqueueEmailSequence,
  signAccessToken,
  setAuthCookie,
  ADMIN_EMAILS,
  registerLimiter,
  isString,
  isEmail,
  validateBody,
  requireTenantQuota,
  resolveClientContext,
  ensureLeadForUser,
  createSessionBinding,
  registerCustomerDevice,
  claimWhatsAppIdentity,
  normalizeWhatsAppNumber,
  isPlausibleNumber,
  requireAuth,
  invalidateIdentity,
  otpLimiter,
  resetOtpLimiter,
} = require('./_shared');

const { toIdentity } = require('../../lib/phoneNumber');
const { attributionFromRequest } = require('../../lib/visitAttribution');
const {
  UNPROVEN_CLAIM_HOURS, issueEmailVerification, verifyEmailCode, verifyEmailToken,
} = require('../../lib/emailVerification');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/register — phone (WhatsApp) is the required identity; email
// is optional, matching login (which already accepts either as the
// identifier). A signup with no phone at all used to be allowed and would
// then be unreachable by anyone once email sign-in was ever disabled — see
// claimWhatsAppIdentity below for why a COLLIDING number is still allowed
// through with a warning rather than blocking the signup outright.
// 27 of 32 signups in two days ended here (29–30 Sep 2026): the number already
// had an account — a client from the sheets, or someone signing up twice. «رقم
// الهاتف مستخدم بالفعل» told them that and nothing else; this says how to get in.
// Two spellings of one number: 01012345678 and +201012345678, or 0501234567 and 966501234567.
const phoneKey = (value) => toIdentity(value).replace(/^966(?=5\d{8}$)/, '');
const samePhone = (a, b) => Boolean(phoneKey(a)) && phoneKey(a) === phoneKey(b);

const PHONE_TAKEN_MESSAGE = 'الرقم ده عليه حساب عندنا بالفعل. ادخل من «الدخول برقم الواتساب» وهيوصلك كود على نفس الرقم، ومن غير كلمة مرور.';

const validateSignup = validateBody({
  email:    v => v === undefined || v === null || v === '' || isEmail(v) || 'البريد الإلكتروني غير صحيح',
  phone:    v => isPlausibleNumber(normalizeWhatsAppNumber(v)) || 'رقم الهاتف (واتساب) مطلوب وصحيح',
  password: v => isString(v, 200) && (v || '').length >= 8 || 'Password must be at least 8 characters',
});

// One handler, two addresses. The website signs up at /api/user/signup
// (client/lib/mysqlapi.ts — a WAF on shared hosting may block /api/auth/), and
// /api/auth/register is the original. They were two copies «kept in sync», and
// the website's copy lost the lead and the welcome journey: from 25 Sep to
// 7 Oct 2026, seven people who signed up on the site were in neither the leads
// nor the clients, so nobody was ever going to call them.
async function signup(req, res) {
  // `interest` is still sent by the signup form and has nowhere to land: it was
  // only ever read by the dead `registrations` INSERT below. Storing it needs a
  // column and a screen that shows it, which is a decision, not a fix.
  const { email, password, name, phone, ref } = req.body || {};
  const hasEmail = isEmail(email);
  const normalizedEmail = hasEmail ? email.toLowerCase().trim() : null;
  let conn;
  let transactionStarted = false;
  try {
    const tenantId = req.tenantId || 'tenant-default';
    const clientContext = await resolveClientContext(req);
    if (!clientContext.locationResolved) {
      return res.status(503).json({ error: 'تعذر تحديد الدولة بأمان؛ حاول مرة أخرى', code: 'LOCATION_UNAVAILABLE' });
    }
    const branch = clientContext.branch;
    const session = createSessionBinding(req);
    conn = await pool.getConnection();
    if (hasEmail) {
      const [[protectedStaff]] = await conn.execute(
        'SELECT id FROM staff WHERE tenant_id=? AND LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1',
        [tenantId, normalizedEmail]
      );
      if (protectedStaff || ADMIN_EMAILS.some(e => e.toLowerCase() === normalizedEmail)) {
        return res.status(403).json({ error: 'Staff accounts require an administrator invitation', code: 'STAFF_INVITATION_REQUIRED' });
      }
      // An address somebody else typed at sign-up and never proved stops
      // blocking its owner after UNPROVEN_CLAIM_HOURS: it is taken off that
      // account (which keeps its phone, its way in) and this sign-up proceeds.
      await conn.execute(
        `UPDATE users SET email=NULL
          WHERE tenant_id=? AND email=? AND email_unverified=1 AND created_at < NOW() - INTERVAL ? HOUR`,
        [tenantId, normalizedEmail, UNPROVEN_CLAIM_HOURS]
      );
      const [existing] = await conn.execute('SELECT id FROM users WHERE tenant_id=? AND email = ?', [tenantId, normalizedEmail]);
      if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' });
      // A client's email is not a key anyone can claim. The email is not
      // verified here, and the account is matched to its client by email
      // (lib/subscriberIdentity.js) — so signing up with a client's address and
      // one's own number opened that client's paid lectures, payments and data
      // export, and sent their password-reset code to the newcomer's WhatsApp.
      // The client themself signs up with the number on their file.
      const [[client]] = await conn.execute(
        'SELECT phone FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? AND deleted_at IS NULL LIMIT 1',
        [tenantId, normalizedEmail]
      );
      if (client && !samePhone(client.phone, phone)) {
        // A client on file with no number cannot prove the address is theirs
        // here either; customer service adds the number, then they sign in by it.
        return res.status(409).json({
          error: phoneKey(client.phone)
            ? 'البريد ده مسجّل لعميل عندنا برقم تاني. ادخل برقم الواتساب المسجّل عندنا، أو كلّم خدمة العملاء.'
            : 'البريد ده مسجّل لعميل عندنا من غير رقم واتساب. كلّم خدمة العملاء يضيفوا رقمك، وبعدها ادخل بيه.',
          code: 'EMAIL_BELONGS_TO_CLIENT',
        });
      }
    }
    // Phone is the required identity now, so a number already claimed by
    // another account must reject the signup rather than silently proceeding
    // without one — that would hand out credentials for an account nothing
    // can ever sign into (email sign-in is optional and may not exist here).
    const [[phoneTaken]] = await conn.execute(
      'SELECT id FROM users WHERE tenant_id=? AND phone = ? LIMIT 1',
      [tenantId, normalizeWhatsAppNumber(phone)]
    );
    if (phoneTaken) return res.status(409).json({ error: PHONE_TAKEN_MESSAGE, code: 'PHONE_ALREADY_REGISTERED' });
    await conn.beginTransaction();
    transactionStarted = true;
    const id = uuidv4();
    const hash = await bcrypt.hash(password, 12);
    // Store the WhatsApp identity at signup. Without it a new account has no
    // phone, and with email sign-in disabled that account could never log in —
    // registration would be handing out credentials that don't work.
    //
    // Left NULL when the number is missing, implausible, or already belongs to
    // another account: users.phone is UNIQUE per tenant, so reusing one would
    // fail the whole registration. Such an account simply has no WhatsApp
    // identity until staff attach a number, which is recoverable; refusing the
    // signup outright is not. (The already-claimed case is caught above before
    // the transaction even opens; this still guards the race between the two.)
    const phoneForUser = await claimWhatsAppIdentity(conn, { tenantId, phone });
    await conn.execute(
      `INSERT INTO users
         (id, tenant_id, email, email_unverified, phone, password_hash, name, role, active_session_id,
          active_session_ip_hash, active_session_started_at, active_session_last_seen_at,
          last_country_code, preferred_currency, last_geo_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, NOW())`,
      // The email is a claim until its owner follows the link or types the
      // code (lib/emailVerification.js); the phone is the identity meanwhile.
      [id, tenantId, normalizedEmail, normalizedEmail ? 1 : 0, phoneForUser, hash, (name || '').trim(), 'user',
        session.sessionId, session.ipHash, clientContext.countryCode, clientContext.currency]
    );
    // The device the account was made on is its first (lib/customerDevices.js).
    await registerCustomerDevice(conn, { tenantId, userId: id, req });
    // Referral attribution (best-effort): credit the referrer + tag the new user.
    //
    // Awaited, and that is the whole point. Fired without await on `conn` — a
    // pooled connection this handler releases moments later — a query still
    // running goes back to the pool as the next request's connection. Best-
    // effort means the failure is swallowed, not that the wait is.
    if (ref) {
      const refCode = String(ref).trim().toUpperCase();
      await conn.query('UPDATE referral_codes SET uses = uses + 1 WHERE tenant_id=? AND code = ?', [tenantId, refCode]).catch(() => {});
      // The client record it credits is found by the phone, not by the email:
      // an unproven address must not change somebody else's record.
      const phoneIdentity = normalizeWhatsAppNumber(phone);
      if (phoneIdentity) {
        await conn.query('UPDATE subscribers SET referred_by = ? WHERE tenant_id=? AND phone = ? AND deleted_at IS NULL AND (referred_by IS NULL OR referred_by = "")', [refCode, tenantId, phoneIdentity]).catch(() => {});
      }
    }
    // There is no `registrations` table and there never has been: "التسجيلات"
    // is a view over users (routes/registrations.js reads them by user id). The
    // INSERT that used to sit here threw ER_NO_SUCH_TABLE on every single
    // signup, inside this transaction, into a catch that dropped it silently.
    //
    // A signup reaches the client base.
    //
    // This wrote the login row and stopped, on the reasoning that not every
    // self-registration is a potential client. Measured on production, that
    // left 238 of 1,764 accounts in neither the client database nor the leads
    // and not staff — invisible to everyone whose job is to call them, people
    // who had signed up that same day among them. The owner's rule is the
    // other way round: a signup is a potential client until they book and pay.
    //
    // Through the same routine «التسجيلات» uses to convert one by hand, so the
    // two cannot drift, and best-effort: the account is what is being created
    // here, and a lead that cannot be written must not refuse somebody a login.
    try {
      await ensureLeadForUser(conn, {
        tenantId,
        user: { id, name, email: normalizedEmail, phone: normalizeWhatsAppNumber(phone) },
        branch,
        attribution: attributionFromRequest(req),
      });
    } catch (leadError) {
      logger.warn('[register] could not add the signup to the client base', { error: leadError.message });
    }
    await conn.commit();
    transactionStarted = false;
    const token = signAccessToken({
      uid: id, email: normalizedEmail, tenantId, sessionVersion: 1, sessionId: session.sessionId,
    });
    setAuthCookie(res, token);
    res.json({ ok: true, user: { uid: id, email: normalizedEmail, displayName: (name || '').trim() } });

    // Welcome message through the lifecycle journey rather than a direct
    // send. The direct sendWhatsApp() call this replaces was fire-and-
    // forget: a momentary WhatsApp outage lost the message for good, a
    // repeated registration could double-send it, it ignored the journey
    // toggles in Settings, and nothing recorded whether it was delivered.
    // Routing it through the outbox gives retry, dedupe and an audit trail.
    // Keyed to the account so a retried registration can't double-fire it.
    if (phone || normalizedEmail) {
      require('../../lib/lifecycle').trigger('lead_created', {
        name: (name || '').trim(),
        email: normalizedEmail,
        phone,
        tenantId,
      }, { dedupeKey: `signup:${id}` })
        .catch(err => logger.warn('[register] lead_created journey failed', { error: err.message }));
    }
    // The link and code that prove the address (best-effort: the account
    // works by phone meanwhile, and POST /api/auth/email/resend asks again).
    if (normalizedEmail) {
      issueEmailVerification(pool, { tenantId, userId: id, email: normalizedEmail, name: (name || '').trim() })
        .catch(error => logger.warn('[register] email verification not issued', { error: error.message }));
    }
    // Enqueue registration email sequence (best-effort)
    if (normalizedEmail) {
      enqueueEmailSequence({ tenantId, triggerEvent: 'registration', recipientEmail: normalizedEmail, recipientName: (name || '').trim() }).catch(error => logger.warn('[register] sequence enqueue failed', { error: error.message }));
    }
  } catch (err) {
    if (transactionStarted && conn) await conn.rollback().catch(() => {});
    logger.error('[auth/register]', err);
    // After the account is answered for, a failure in the welcome is logged,
    // not sent: a second answer to the same request only throws again.
    if (!res.headersSent) res.status(500).json({ error: 'Registration failed' });
  } finally { if (conn) conn.release(); }
}

// GET /api/auth/verify-email?t=… — the link in the verification email. One
// use; it lands the person back on the site with the result in the address.
router.get('/api/auth/verify-email', resetOtpLimiter, async (req, res) => {
  const site = String(process.env.CLIENT_URL || 'https://mahadnafsy.com').replace(/\/+$/, '');
  try {
    const result = await verifyEmailToken(pool, { tenantId: req.tenantId || 'tenant-default', token: String(req.query?.t || '') });
    if (result.ok) invalidateIdentity(result.tenantId, result.userId);
    res.redirect(302, `${site}/?emailVerified=${result.ok ? '1' : '0'}`);
  } catch (error) {
    logger.error('[auth/verify-email]', error);
    res.redirect(302, `${site}/?emailVerified=0`);
  }
});

// POST /api/auth/email/verify — the six-digit code from the same email.
router.post('/api/auth/email/verify', requireAuth, resetOtpLimiter, async (req, res) => {
  try {
    const result = await verifyEmailCode(pool, { tenantId: req.tenantId, userId: req.user.uid, code: req.body?.code });
    if (!result.ok) return res.status(400).json({ error: 'الكود غير صحيح أو انتهت صلاحيته', code: 'EMAIL_CODE_INVALID' });
    invalidateIdentity(req.tenantId, req.user.uid);
    res.json({ ok: true });
  } catch (error) {
    logger.error('[auth/email/verify]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/email/resend — a new link and code for an unproven address.
router.post('/api/auth/email/resend', requireAuth, otpLimiter, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT email, name, email_unverified FROM users WHERE tenant_id=? AND id=? AND is_active=1 LIMIT 1',
      [req.tenantId, req.user.uid]
    );
    if (!user?.email) return res.status(409).json({ error: 'مفيش بريد على الحساب', code: 'NO_EMAIL' });
    if (Number(user.email_unverified) !== 1) return res.json({ ok: true, alreadyVerified: true });
    const result = await issueEmailVerification(pool, { tenantId: req.tenantId, userId: req.user.uid, email: user.email, name: user.name });
    res.json({ ok: true, sent: Boolean(result.sent) });
  } catch (error) {
    logger.error('[auth/email/resend]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/auth/register', registerLimiter, requireDb, requireTenantQuota('users'), validateSignup, signup);
router.post('/api/user/signup', registerLimiter, requireDb, requireTenantQuota('users'), validateSignup, signup);

module.exports = router;
