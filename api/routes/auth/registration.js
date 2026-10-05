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
  sendWhatsApp,
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
} = require('./_shared');

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
const PHONE_TAKEN_MESSAGE = 'الرقم ده عليه حساب عندنا بالفعل. ادخل من «الدخول برقم الواتساب» وهيوصلك كود على نفس الرقم، ومن غير كلمة مرور.';

router.post('/api/auth/register', registerLimiter, requireDb, requireTenantQuota('users'),
  validateBody({
    email:    v => v === undefined || v === null || v === '' || isEmail(v) || 'البريد الإلكتروني غير صحيح',
    phone:    v => isPlausibleNumber(normalizeWhatsAppNumber(v)) || 'رقم الهاتف (واتساب) مطلوب وصحيح',
    password: v => isString(v, 200) && (v || '').length >= 8 || 'Password must be at least 8 characters',
  }),
  async (req, res) => {
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
      const [existing] = await conn.execute('SELECT id FROM users WHERE tenant_id=? AND email = ?', [tenantId, normalizedEmail]);
      if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' });
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
    // signup outright is not. (The already-claimed case is now caught above
    // before the transaction even opens, since phone is required here — this
    // still guards the race between that check and this claim.)
    const phoneForUser = await claimWhatsAppIdentity(conn, { tenantId, phone });
    await conn.execute(
      `INSERT INTO users
         (id, tenant_id, email, phone, password_hash, name, role, active_session_id,
          active_session_ip_hash, active_session_started_at, active_session_last_seen_at,
          last_country_code, preferred_currency, last_geo_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, NOW())`,
      [id, tenantId, normalizedEmail, phoneForUser, hash, (name || '').trim(), 'user',
        session.sessionId, session.ipHash, clientContext.countryCode, clientContext.currency]
    );
    // The device the account was made on is its first (lib/customerDevices.js).
    await registerCustomerDevice(conn, { tenantId, userId: id, req });
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
    let createdLeadId = null;
    try {
      const lead = await ensureLeadForUser(conn, {
        tenantId,
        user: { id, name, email: normalizedEmail, phone: normalizeWhatsAppNumber(phone) },
        branch,
      });
      createdLeadId = lead.leadId;
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

    // Best-effort referral tracking
    if (ref) {
      pool.query('UPDATE referral_codes SET uses = uses + 1 WHERE code = ? AND tenant_id=?', [String(ref).trim().toUpperCase(), tenantId]).catch(() => {});
    }

    // Welcome message through the lifecycle journey rather than a direct
    // send. The direct sendWhatsApp() call this replaces was fire-and-
    // forget: a momentary WhatsApp outage lost the message for good, a
    // repeated registration could double-send it, it ignored the journey
    // toggles in Settings, and nothing recorded whether it was delivered.
    // Routing it through the outbox gives retry, dedupe and an audit trail.
    // Keyed to the account (not a lead, which no longer exists at this
    // point) so a retried registration can't double-fire it.
    if (phone || normalizedEmail) {
      require('../lib/lifecycle').trigger('lead_created', {
        name: (name || '').trim(),
        email: normalizedEmail,
        phone,
        tenantId,
      }, { dedupeKey: `signup:${id}` })
        .catch(err => logger.warn('[register] lead_created journey failed', { error: err.message }));
    }
    // Enqueue registration email sequence (best-effort)
    if (normalizedEmail) {
      enqueueEmailSequence({ tenantId, triggerEvent: 'registration', recipientEmail: normalizedEmail, recipientName: (name || '').trim() }).catch(error => logger.warn('[register] sequence enqueue failed', { error: error.message }));
    }
  } catch (err) {
    if (transactionStarted && conn) await conn.rollback().catch(() => {});
    logger.error('[auth/register]', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally { if (conn) conn.release(); }
});
// Alias — WAF on shared hosting may block /api/auth/ paths; this exposes the same handler under /api/user/signup
// This is the route the client actually calls (client/lib/mysqlapi.ts registers
// against /user/signup, not /auth/register) — keep both in sync.
router.post('/api/user/signup', registerLimiter, requireDb, requireTenantQuota('users'),
  validateBody({
    email:    v => v === undefined || v === null || v === '' || isEmail(v) || 'البريد الإلكتروني غير صحيح',
    phone:    v => isPlausibleNumber(normalizeWhatsAppNumber(v)) || 'رقم الهاتف (واتساب) مطلوب وصحيح',
    password: v => isString(v, 200) && (v || '').length >= 8 || 'Password must be at least 8 characters',
  }),
  async (req, res) => {
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
      const [existing] = await conn.execute('SELECT id FROM users WHERE tenant_id=? AND email = ?', [tenantId, normalizedEmail]);
      if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' });
    }
    // Phone is the required identity now — a number already claimed by another
    // account must reject the signup, not proceed without one. See the
    // matching comment on /api/auth/register.
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
    // signup outright is not.
    const phoneForUser = await claimWhatsAppIdentity(conn, { tenantId, phone });
    await conn.execute(
      `INSERT INTO users
         (id, tenant_id, email, phone, password_hash, name, role, active_session_id,
          active_session_ip_hash, active_session_started_at, active_session_last_seen_at,
          last_country_code, preferred_currency, last_geo_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, NOW())`,
      [id, tenantId, normalizedEmail, phoneForUser, hash, (name || '').trim(), 'user',
        session.sessionId, session.ipHash, clientContext.countryCode, clientContext.currency]
    );
    // The device the account was made on is its first (lib/customerDevices.js).
    await registerCustomerDevice(conn, { tenantId, userId: id, req });
    // Referral attribution (best-effort): credit the referrer + tag the new user.
    //
    // Awaited, and that is the whole point. These were fired without await on
    // `conn` — a pooled connection this handler releases moments later. A query
    // still running on a connection that has gone back to the pool is the next
    // request's connection: its result arrives in someone else's session, and
    // mysql2 can leave the protocol mid-packet. Best-effort means the failure
    // is swallowed, not that the wait is.
    if (ref) {
      const refCode = String(ref).trim().toUpperCase();
      await conn.query('UPDATE referral_codes SET uses = uses + 1 WHERE tenant_id=? AND code = ?', [tenantId, refCode]).catch(() => {});
      if (normalizedEmail) {
        await conn.query('UPDATE subscribers SET referred_by = ? WHERE tenant_id=? AND LOWER(TRIM(email)) = ? AND (referred_by IS NULL OR referred_by = "")', [refCode, tenantId, normalizedEmail]).catch(() => {});
      }
    }
    // The same dead `registrations` INSERT stood here too — see the note on
    // /api/auth/register above.
    //
    // Neither a lead nor a subscriber is created here anymore — see the
    // matching comment on /api/auth/register above. The account lands in
    // "التسجيلات" until staff explicitly triage it.
    await conn.commit();
    transactionStarted = false;
    const token = signAccessToken({
      uid: id, email: normalizedEmail, tenantId, sessionVersion: 1, sessionId: session.sessionId,
    });
    setAuthCookie(res, token);
    res.json({ ok: true, user: { uid: id, email: normalizedEmail, displayName: (name || '').trim() } });
    if (phone) sendWhatsApp(phone, `أهلاً وسهلاً ${(name || '').trim() || ''}! 🎉\nنرحب بك في معهد مهاد للدراسات النفسية.\nيمكنك الآن الدخول لحسابك واستعراض كورساتنا المتاحة.\nللتواصل أو الاستفسار راسلنا هنا. 💚`, { tenantId: req.tenantId, category: 'welcome' }).catch(() => {});
  } catch (err) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[user/signup]', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally { conn.release(); }
});

module.exports = router;
