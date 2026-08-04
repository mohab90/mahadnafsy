'use strict';
const logger = require('../lib/logger');
const { Router } = require('express');
const router = Router();

const bcrypt = require('../lib/passwordHash');
const jwt    = require('jsonwebtoken');
const { createHmac } = require('crypto');
const { resolveSecret } = require('../lib/secretResolver');
const { uuidv4 } = require('../lib/id');
const { generateTemporaryPassword, generateNumericCode } = require('../lib/secureCredentials');

const { pool, getStaffIdByEmail, requireDb } = require('../lib/db');
const { sanitize, validate, EMAIL_RE, PHONE_RE } = require('../lib/helpers');
const { sendEmail: sendEmailBase, htmlEmail, mailer } = require('../lib/email');
const { getNextClientCode } = require('../lib/mappers');
const { logLeadEvent } = require('../lib/crm');
const { describeReason, sendWhatsApp } = require('../lib/whatsapp');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { branchIdForBranch } = require('../lib/branches');
const { getNextSalesRep } = require('../lib/leadAssignment');
const { grantCourseSelections } = require('../lib/entitlements');
const {
  JWT_SECRET, signAccessToken, setAuthCookie, clearAuthCookie, tokenExpiryMs, revokeToken,
} = require('../lib/token');
const {
  ADMIN_EMAILS, ADMIN_UIDS, requireAuth, requireAdmin, requireSuperAdmin,
  requireAdminOrOnlineManager, invalidateIdentity,
} = require('../middleware/auth');
const { registerLimiter, loginLimiter, otpLimiter, forgotPasswordLimiter, bulkOperationLimiter } = require('../middleware/rateLimits');
const { isString, isEmail, validateBody } = require('../middleware/validate');
const { postPaymentJournal } = require('../lib/finance');
const { assertWritable } = require('../lib/periodLock');
const { logLoginAttempt } = require('../lib/loginAudit');
const { hasPermission } = require('../constants/permissions');
const { getMfaPolicy, policyRequiresStaff } = require('../lib/mfaPolicy');
const { requireTenantQuota } = require('../middleware/tenantQuota');
const { resolveClientContext, getClientIp, hashClientIp } = require('../lib/clientContext');
const { createSessionBinding, rotateSingleSession, closeSingleSession } = require('../lib/singleSession');
const { getSharingLock, enforceSharingLimit } = require('../lib/accountSharingGuard');
const {
  requestLoginCode, verifyLoginCode, CODE_TTL_MINUTES: WA_CODE_TTL_MINUTES,
  claimWhatsAppIdentity, normalizeWhatsAppNumber, isPlausibleNumber,
} = require('../lib/whatsappOtp');
const { toDialable } = require('../lib/phoneNumber');

function hashOtp({ tenantId, email, type, code }) {
  const secret = String(resolveSecret('OTP_HMAC_SECRET') || JWT_SECRET);
  return createHmac('sha256', secret)
    .update(`${tenantId}\0${String(email).toLowerCase().trim()}\0${type}\0${String(code).trim()}`)
    .digest('hex');
}
// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/register — phone (WhatsApp) is the required identity; email
// is optional, matching login (which already accepts either as the
// identifier). A signup with no phone at all used to be allowed and would
// then be unreachable by anyone once email sign-in was ever disabled — see
// claimWhatsAppIdentity below for why a COLLIDING number is still allowed
// through with a warning rather than blocking the signup outright.
router.post('/api/auth/register', registerLimiter, requireDb, requireTenantQuota('users'),
  validateBody({
    email:    v => v === undefined || v === null || v === '' || isEmail(v) || 'البريد الإلكتروني غير صحيح',
    phone:    v => isPlausibleNumber(normalizeWhatsAppNumber(v)) || 'رقم الهاتف (واتساب) مطلوب وصحيح',
    password: v => isString(v, 200) && (v || '').length >= 8 || 'Password must be at least 8 characters',
  }),
  async (req, res) => {
  const { email, password, name, phone, interest, ref } = req.body || {};
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
    if (phoneTaken) return res.status(409).json({ error: 'رقم الهاتف مستخدم بالفعل', code: 'PHONE_ALREADY_REGISTERED' });
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
    // Also write to registrations table (best-effort)
    try {
      await conn.execute(
        `INSERT IGNORE INTO registrations (id, uid, name, email, phone, country, interest, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [uuidv4(), id, (name || '').trim(), normalizedEmail || '', phone || '', clientContext.countryCode, interest || '']
      );
    } catch { /* registrations table may not exist — ignore */ }
    // Generate ONE shared client code — same code on both lead and subscriber for this person
    let sharedClientCode = null;
    try { sharedClientCode = await getNextClientCode(conn); } catch (codeErr) { logger.warn('[register] Could not get client code:', codeErr.message); }
    // Auto-create lead in CRM so admin sees new registrations in العملاء المحتملين (best-effort)
    let createdLeadId = null;
    try {
      // Check for existing lead with same phone or email first
      const normalizedPhone = (phone || '').replace(/\D/g, '');
      let existingLeadId = null;
      if (normalizedPhone.length >= 7) {
        const [[byPhone]] = await conn.execute(
          'SELECT id FROM leads WHERE tenant_id=? AND REGEXP_REPLACE(phone, "[^0-9]", "") = ? AND hidden = 0 LIMIT 1',
          [tenantId, normalizedPhone]
        );
        if (byPhone) existingLeadId = byPhone.id;
      }
      if (!existingLeadId) {
        const [[byEmail]] = await conn.execute(
          'SELECT id FROM leads WHERE tenant_id=? AND LOWER(TRIM(email)) = ? AND hidden = 0 LIMIT 1',
          [tenantId, normalizedEmail]
        );
        if (byEmail) existingLeadId = byEmail.id;
      }
      if (existingLeadId) {
        // Update existing lead with better name/code instead of creating duplicate
        createdLeadId = existingLeadId;
        const newName = (name || '').trim();
        await conn.execute(
          'UPDATE leads SET name=IF(LENGTH(?)>0,?,name), email=?, phone=COALESCE(NULLIF(?,\'\'),phone), client_code=COALESCE(client_code,?), branch=COALESCE(NULLIF(branch,\'\'),?), branch_id=COALESCE(branch_id,?) WHERE id=? AND tenant_id=?',
          [newName, newName, normalizedEmail, phone || '', sharedClientCode, branch, branchIdForBranch(branch), existingLeadId, tenantId]
        );
        logger.info(`[register] Reused existing lead ${existingLeadId} for ${normalizedEmail}`);
      } else {
        const leadId = uuidv4();
        createdLeadId = leadId;
        const salesRep = await getNextSalesRep(tenantId, conn, { branch });
        await conn.execute(
          `INSERT INTO leads
             (id, tenant_id, client_code, name, email, phone, source, status, hidden,
              branch, branch_id, assigned_sales_id, assigned_sales_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'تسجيل دخول', 'new', 0, ?, ?, ?, ?, NOW())`,
          [leadId, tenantId, sharedClientCode,
           (name || '').trim() || (normalizedEmail ? normalizedEmail.split('@')[0] : '') || (phone || '').trim() || 'عميل جديد',
           normalizedEmail, phone || '', branch, branchIdForBranch(branch), salesRep?.id || null, salesRep?.name || null]
        );
        logger.info(`[register] Created lead ${leadId} code=${sharedClientCode} for ${normalizedEmail}`);
        await logLeadEvent(leadId, 'created', 'تسجيل جديد عبر الموقع', { source: 'تسجيل دخول', phone, status: 'new' }, tenantId, conn);
      }
    } catch (leadErr) {
      logger.error('[register] Could not create lead:', leadErr.message);
      throw leadErr;
    }
    // NOTE: No subscriber record created on register — client stays in عملاء محتملين until admin manually
    // converts them after payment (admin moves them to عملاء الأونلاين and assigns a course).
    await conn.commit();
    transactionStarted = false;
    const token = signAccessToken({
      uid: id, email: normalizedEmail, tenantId, sessionVersion: 1, sessionId: session.sessionId,
    });
    setAuthCookie(res, token);
    res.json({ ok: true, token, user: { uid: id, email: normalizedEmail, displayName: (name || '').trim() } });

    // Best-effort referral tracking
    if (ref) {
      pool.query('UPDATE referral_codes SET uses = uses + 1 WHERE code = ? AND tenant_id=?', [String(ref).trim().toUpperCase(), tenantId]).catch(() => {});
      if (createdLeadId) pool.query("UPDATE leads SET notes = CONCAT(IFNULL(notes,''), ?) WHERE id=? AND tenant_id=?", [`\n[مُحال من كود: ${ref}]`, createdLeadId, tenantId]).catch(() => {});
    }

    // Welcome message for the new lead, through the lifecycle journey rather
    // than a direct send. The direct sendWhatsApp() call this replaces was
    // fire-and-forget: a momentary WhatsApp outage lost the message for good,
    // a repeated registration could double-send it, it ignored the journey
    // toggles in Settings, and nothing recorded whether it was delivered.
    // Routing it through the outbox gives retry, dedupe and an audit trail —
    // and the same lead_created step already used by the public capture forms,
    // so a lead now gets the same welcome no matter which door it came in by.
    if (phone || normalizedEmail) {
      require('../lib/lifecycle').trigger('lead_created', {
        name: (name || '').trim(),
        email: normalizedEmail,
        phone,
        tenantId,
      }, { dedupeKey: createdLeadId ? `lead:${createdLeadId}` : undefined })
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
  const { email, password, name, phone, interest, ref } = req.body || {};
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
    if (phoneTaken) return res.status(409).json({ error: 'رقم الهاتف مستخدم بالفعل', code: 'PHONE_ALREADY_REGISTERED' });
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
    // Referral attribution (best-effort): credit the referrer + tag the new user.
    if (ref) {
      const refCode = String(ref).trim().toUpperCase();
      conn.query('UPDATE referral_codes SET uses = uses + 1 WHERE tenant_id=? AND code = ?', [tenantId, refCode]).catch(() => {});
      if (normalizedEmail) {
        conn.query('UPDATE subscribers SET referred_by = ? WHERE tenant_id=? AND LOWER(TRIM(email)) = ? AND (referred_by IS NULL OR referred_by = "")', [refCode, tenantId, normalizedEmail]).catch(() => {});
      }
    }
    try {
      await conn.execute(
        `INSERT IGNORE INTO registrations (id, uid, name, email, phone, country, interest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [uuidv4(), id, (name || '').trim(), normalizedEmail || '', phone || '', clientContext.countryCode, interest || '']
      );
    } catch { /* ignore */ }
    let sharedClientCode = null;
    try { sharedClientCode = await getNextClientCode(conn); } catch { }
    try {
      const normalizedPhone = (phone || '').replace(/\D/g, '');
      let existingLeadId = null;
      if (normalizedPhone.length >= 7) {
        const [[byPhone]] = await conn.execute('SELECT id FROM leads WHERE tenant_id=? AND REGEXP_REPLACE(phone, "[^0-9]", "") = ? AND hidden = 0 LIMIT 1', [tenantId, normalizedPhone]);
        if (byPhone) existingLeadId = byPhone.id;
      }
      if (!existingLeadId) {
        const [[byEmail]] = await conn.execute('SELECT id FROM leads WHERE tenant_id=? AND LOWER(TRIM(email)) = ? AND hidden = 0 LIMIT 1', [tenantId, normalizedEmail]);
        if (byEmail) existingLeadId = byEmail.id;
      }
      if (existingLeadId) {
        const newName = (name || '').trim();
        await conn.execute(
          'UPDATE leads SET name=IF(LENGTH(?)>0,?,name), email=?, phone=COALESCE(NULLIF(?,\'\'),phone), client_code=COALESCE(client_code,?), branch=COALESCE(NULLIF(branch,\'\'),?), branch_id=COALESCE(branch_id,?) WHERE id=? AND tenant_id=?',
          [newName, newName, normalizedEmail, phone || '', sharedClientCode, branch, branchIdForBranch(branch), existingLeadId, tenantId]
        );
      } else {
        const leadId = uuidv4();
        const [[salesRep]] = await conn.execute(
          `SELECT s.id, s.name FROM staff s
           LEFT JOIN leads l ON l.assigned_sales_id=s.id AND l.tenant_id=? AND l.hidden=0
           WHERE s.tenant_id=? AND s.is_active=1 AND UPPER(s.role) IN ('SALES','MANAGER')
           GROUP BY s.id, s.name ORDER BY COUNT(l.id) ASC, s.name ASC LIMIT 1`,
          [tenantId, tenantId]
        );
        await conn.execute(
          `INSERT INTO leads
             (id, tenant_id, client_code, name, email, phone, source, status, hidden,
              branch, branch_id, assigned_sales_id, assigned_sales_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'تسجيل دخول', 'new', 0, ?, ?, ?, ?, NOW())`,
          [leadId, tenantId, sharedClientCode,
           (name || '').trim() || (normalizedEmail ? normalizedEmail.split('@')[0] : '') || (phone || '').trim() || 'عميل جديد',
           normalizedEmail, phone || '', branch, branchIdForBranch(branch), salesRep?.id || null, salesRep?.name || null]
        );
        await logLeadEvent(leadId, 'created', 'تسجيل جديد عبر الموقع', { source: 'تسجيل دخول', phone, status: 'new' }, tenantId, conn);
      }
    } catch (leadErr) {
      logger.error('[user/signup] Could not create lead:', leadErr.message);
      throw leadErr;
    }
    await conn.commit();
    transactionStarted = false;
    const token = signAccessToken({
      uid: id, email: normalizedEmail, tenantId, sessionVersion: 1, sessionId: session.sessionId,
    });
    setAuthCookie(res, token);
    res.json({ ok: true, token, user: { uid: id, email: normalizedEmail, displayName: (name || '').trim() } });
    if (phone) sendWhatsApp(phone, `أهلاً وسهلاً ${(name || '').trim() || ''}! 🎉\nنرحب بك في معهد مهاد للدراسات النفسية.\nيمكنك الآن الدخول لحسابك واستعراض كورساتنا المتاحة.\nللتواصل أو الاستفسار راسلنا هنا. 💚`, { tenantId: req.tenantId }).catch(() => {});
  } catch (err) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[user/signup]', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally { conn.release(); }
});

// POST /api/admin/staff-account — create login account for a staff member (admin only)
// Creates the user in `users` table + inserts/updates `staff` table
router.post('/api/admin/staff-account', requireAuth, requireSuperAdmin, requireTenantQuota('staff'),
  validateBody({
    email:    v => isEmail(v)            || 'Email address is invalid',
    password: v => isString(v, 200) && (v || '').length >= 8 || 'Password must be at least 8 characters',
    name:     v => isString(v, 200)      || 'name is required',
  }),
  async (req, res) => {
  const { email, password, name, phone, role, staffId } = req.body || {};
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const tenantId = req.tenantId;
    await conn.beginTransaction();
    transactionStarted = true;
    // Upsert into users table
    const [existing] = await conn.execute('SELECT id FROM users WHERE tenant_id=? AND email = ? FOR UPDATE', [tenantId, email.toLowerCase().trim()]);
    let uid;
    if (existing.length > 0) {
      uid = existing[0].id;
      const hash = await bcrypt.hash(password, 12);
      await conn.execute(
        `UPDATE users SET password_hash=?, name=?, is_active=1,
          session_version=session_version+1, active_session_id=NULL,
          active_session_ip_hash=NULL, active_session_started_at=NULL,
          active_session_last_seen_at=NULL WHERE id=? AND tenant_id=?`,
        [hash, name.trim(), uid, tenantId]
      );
    } else {
      uid = uuidv4();
      const hash = await bcrypt.hash(password, 12);
      await conn.execute('INSERT INTO users (id,tenant_id,email,password_hash,name,role,is_active) VALUES (?,?,?,?,?,?,1)',
        [uid, tenantId, email.toLowerCase().trim(), hash, name.trim(), 'staff']);
    }
    // Upsert into staff table
    const id = staffId || uuidv4();
    const dbRole = ((role || 'OTHER').toUpperCase());
    const joinedAt = String(req.body.joinedAt || req.body.joined_at || new Date().toISOString()).slice(0, 19).replace('T', ' ');
    const numberOrNull = value => value === undefined || value === null || value === '' ? null : Number(value);
    const permissionsJson = req.body.permissions_json
      || (Array.isArray(req.body.permissions) ? JSON.stringify(req.body.permissions) : null);
    await conn.execute(
      `INSERT INTO staff
         (id, tenant_id, branch_id, firebase_uid, name, email, phone, role, image,
          specialization, joined_at, is_active, notes, commission_rate, permissions_json,
          monthly_target, monthly_target_type, monthly_leads_target, monthly_bonus)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         branch_id=VALUES(branch_id), firebase_uid=VALUES(firebase_uid), name=VALUES(name),
         email=VALUES(email), phone=VALUES(phone), role=VALUES(role), image=VALUES(image),
         specialization=VALUES(specialization), joined_at=VALUES(joined_at), is_active=1,
         notes=VALUES(notes), commission_rate=VALUES(commission_rate),
         permissions_json=VALUES(permissions_json), monthly_target=VALUES(monthly_target),
         monthly_target_type=VALUES(monthly_target_type),
         monthly_leads_target=VALUES(monthly_leads_target), monthly_bonus=VALUES(monthly_bonus)`,
      [
        id, tenantId, req.body.branch_id || 'branch-other', uid, name.trim(),
        email.toLowerCase().trim(), phone || '', dbRole, req.body.image || null,
        req.body.specialization || null, joinedAt, 1, req.body.notes || null,
        numberOrNull(req.body.commissionRate ?? req.body.commission_rate), permissionsJson,
        numberOrNull(req.body.monthlyTarget ?? req.body.monthly_target),
        req.body.monthlyTargetType ?? req.body.monthly_target_type ?? null,
        numberOrNull(req.body.monthlyLeadsTarget ?? req.body.monthly_leads_target),
        numberOrNull(req.body.monthlyBonus ?? req.body.monthly_bonus),
      ]
    );
    await conn.commit();
    transactionStarted = false;
    if (existing.length > 0) invalidateIdentity(tenantId, uid, email);
    res.json({ ok: true, uid, staffId: id });
  } catch (err) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[admin/staff-account]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// GET /api/admin/check-account?email=... — diagnose a subscriber's login account status
router.get('/api/admin/check-account', requireAuth, requireAdmin, async (req, res) => {
  const safeEmail = (req.query.email || '').toLowerCase().trim();
  if (!safeEmail) return res.status(400).json({ error: 'email param required' });
  try {
    const [[user]] = await pool.query(
      'SELECT id, email, name, is_active, role, created_at, (password_hash IS NOT NULL AND password_hash != "") AS has_password FROM users WHERE tenant_id=? AND email = ? LIMIT 1',
      [req.tenantId, safeEmail]
    );
    const [[sub]] = await pool.query(
      'SELECT id, name, email FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email)) = ? LIMIT 1',
      [req.tenantId, safeEmail]
    );
    const [[otp]] = await pool.query(
      "SELECT code, type, expires_at, used FROM otp_codes WHERE tenant_id=? AND email=? ORDER BY created_at DESC LIMIT 1",
      [req.tenantId, safeEmail]
    );
    res.json({
      account: user ? {
        id: user.id, email: user.email, name: user.name,
        is_active: !!user.is_active, has_password: !!user.has_password,
        role: user.role, created_at: user.created_at
      } : null,
      subscriber: sub ? { id: sub.id, name: sub.name, email: sub.email } : null,
      lastOtp: otp ? { type: otp.type, expires_at: otp.expires_at, used: !!otp.used } : null,
      diagnosis: !user ? 'لا يوجد حساب بهذا البريد'
        : !user.is_active ? 'الحساب موجود لكن غير مفعّل (is_active=0)'
        : !user.has_password ? 'الحساب موجود لكن بدون كلمة مرور'
        : 'الحساب يبدو سليماً',
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/create-account — create or re-activate a subscriber's login account
router.post('/api/admin/create-account', requireAuth, requireAdminOrOnlineManager, requireTenantQuota('users'), async (req, res) => {
  const { email, name, password, phone, courses, firstPayment } = req.body || {};
  const normEmail = (email || '').toLowerCase().trim();
  if (!normEmail || !normEmail.includes('@')) return res.status(400).json({ error: 'valid email required' });
  if (courses !== undefined && !Array.isArray(courses)) return res.status(400).json({ error: 'courses must be an array' });
  if (firstPayment && Number(firstPayment.amount) > 0) {
    const method = String(firstPayment.paymentMethod || '').trim();
    if (!method || method.length > 100) return res.status(400).json({ error: 'A valid payment method is required for the first payment' });
    if (method.toLowerCase().includes('paymob')) {
      return res.status(409).json({ error: 'Paymob payments must only be created by the verified Paymob workflow' });
    }
    if (firstPayment.date && !/^\d{4}-\d{2}-\d{2}$/.test(firstPayment.date)) {
      return res.status(400).json({ error: 'Invalid first payment date' });
    }
    const expected = firstPayment.courseExpected;
    if (expected !== undefined && expected !== null && (!Number.isFinite(Number(expected)) || Number(expected) <= 0)) {
      return res.status(400).json({ error: 'Invalid expected course price' });
    }
  }
  const conn = await pool.getConnection();
  try {
    const tenantId = req.tenantId;
    const [[existing]] = await conn.execute('SELECT id, name, is_active FROM users WHERE tenant_id=? AND LOWER(TRIM(email)) = ? LIMIT 1', [tenantId, normEmail]);
    if (existing && existing.is_active) return res.status(409).json({ error: 'حساب فعّال موجود بالفعل بهذا البريد' });

    const tempPass = password && password.trim() ? password.trim() : generateTemporaryPassword();
    if (tempPass.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(tempPass, 12);
    const displayName = (name || existing?.name || normEmail).trim();
    const phoneVal = (phone || '').trim() || null; // NULL not '' so UNIQUE constraint works
    let action = '';
    let firstPaymentStatus = null;
    let createdSubscriberId = null;
    const defaultBranch = 'ONLINE_EGYPT';

    // This handler writes across users/subscribers/enrollments/payments — wrap in a
    // transaction so a mid-way failure (e.g. the enrollments loop) can't leave a user
    // account with no subscriber row, or a subscriber with a partial course list.
    await conn.beginTransaction();

    if (existing) {
      await conn.execute(
        `UPDATE users SET password_hash=?, name=?, is_active=1,
          session_version=session_version+1, active_session_id=NULL,
          active_session_ip_hash=NULL, active_session_started_at=NULL,
          active_session_last_seen_at=NULL WHERE id=? AND tenant_id=?`,
        [hash, displayName, existing.id, tenantId]
      );
      if (phoneVal) await conn.execute('UPDATE subscribers SET phone=? WHERE tenant_id=? AND LOWER(TRIM(email))=? AND (phone IS NULL OR phone=\'\') LIMIT 1', [phoneVal, tenantId, normEmail]);
      // Also save courses for reactivated user
      if (courses && courses.length > 0) {
        const [[reSub]] = await conn.execute('SELECT id, branch_id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [tenantId, normEmail]);
        if (reSub) {
          const validCourses = courses.filter(c => c.courseId && c.courseId.trim());
          if (validCourses.length > 0) {
            await grantCourseSelections({
              tenantId, subscriberId: reSub.id, selections: validCourses,
              branchId: reSub.branch_id, source: 'account_reactivation',
              actor: req.user?.email || 'admin',
            }, conn);
          }
        }
      }
      action = 'reactivated';
    } else {
      const newUserId = uuidv4();
      // Without a number this account cannot be signed into: WhatsApp OTP has
      // nothing to send to, and email sign-in is disabled.
      const phoneForUser = await claimWhatsAppIdentity(conn, { tenantId, phone: phoneVal });
      await conn.execute(
        'INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active) VALUES (?,?,?,?,?,?,?,1)',
        [newUserId, tenantId, normEmail, phoneForUser, hash, displayName, 'user']
      );
      // Create subscriber record if not exists
      const [[subExists]] = await conn.execute('SELECT id, branch_id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [tenantId, normEmail]);
      let targetSubId;
      if (!subExists) {
        targetSubId = uuidv4();
        await conn.execute(
          `INSERT INTO subscribers
             (id, tenant_id, email, name, phone, branch, branch_id, is_active, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,1,NOW(),NOW())`,
          [targetSubId, tenantId, normEmail, displayName, phoneVal, defaultBranch, branchIdForBranch(defaultBranch)]
        );
      } else {
        targetSubId = subExists.id;
        if (phoneVal) await conn.execute('UPDATE subscribers SET phone=? WHERE tenant_id=? AND LOWER(TRIM(email))=? AND (phone IS NULL OR phone=\'\') LIMIT 1', [phoneVal, tenantId, normEmail]);
      }
      // Enrollment rows are the sole entitlement authority.
      if (courses && courses.length > 0) {
        const validCourses = courses.filter(c => c.courseId && c.courseId.trim());
        if (validCourses.length > 0) {
          await grantCourseSelections({
            tenantId, subscriberId: targetSubId, selections: validCourses,
            branchId: subExists?.branch_id || branchIdForBranch(defaultBranch),
            source: 'account_creation', actor: req.user?.email || 'admin',
          }, conn);
        }
      }
      action = 'created';
    }

    // ── Optional first payment — record it against the subscriber (atomic with account) ──
    if (firstPayment && Number(firstPayment.amount) > 0) {
      const amount = Number(firstPayment.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid first payment amount');
      const paymentMethod = String(firstPayment.paymentMethod || '').trim();
      const [[paySub]] = await conn.execute(
        'SELECT id, tenant_id, branch, branch_id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1',
        [tenantId, normEmail]
      );
      if (!paySub) throw new Error('Payment subscriber not found in tenant');
      const rawPaymentItemId = firstPayment.courseId ? String(firstPayment.courseId) : '';
      const paymentBundleId = rawPaymentItemId.startsWith('bundle:') ? rawPaymentItemId.slice(7) : null;
      const paymentCourseId = rawPaymentItemId && !paymentBundleId ? rawPaymentItemId : null;
      if (paymentCourseId) {
        const [[course]] = await conn.execute('SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [paymentCourseId, tenantId]);
        if (!course) throw new Error('Payment course does not belong to tenant');
      }
      if (paymentBundleId) {
        const [[bundle]] = await conn.execute('SELECT id FROM bundles WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [paymentBundleId, tenantId]);
        if (!bundle) throw new Error('Payment bundle does not belong to tenant');
      }
      const paymentId = uuidv4();
      const paymentDate = firstPayment.date || new Date().toISOString().slice(0, 10);
      const courseExpected = firstPayment.courseExpected === undefined || firstPayment.courseExpected === null
        ? null : Number(firstPayment.courseExpected);
      const currency = ['EGP', 'SAR', 'USD'].includes(firstPayment.currency) ? firstPayment.currency : 'EGP';
      const paymentBranch = paySub.branch || defaultBranch;
      const paymentBranchId = paySub.branch_id || branchIdForBranch(paymentBranch);
      const canApproveFinancial = !!req.isSuperAdmin || hasPermission(req.staffRecord, 'manage_financial');
      firstPaymentStatus = canApproveFinancial ? 'paid' : 'pending';
      await assertWritable(paymentDate, conn, tenantId);
      await conn.execute(
        `INSERT INTO payments
           (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
             transaction_id, is_installment, date, note, status, source, staff_id, staff_name,
             tenant_id, branch, branch_id, course_expected)
         VALUES (?, ?, ?, ?, ?, ?, 'COURSE', ?, ?, 0, ?, ?, ?, 'staff', ?, ?, ?, ?, ?, ?)`,
        [paymentId, paySub.id, paymentCourseId, paymentBundleId, amount, currency,
         paymentMethod, firstPayment.transactionId ? String(firstPayment.transactionId).slice(0, 191) : null, paymentDate,
         firstPayment.note ? String(firstPayment.note).slice(0, 2000) : null, firstPaymentStatus, req.staffRecord?.id || null,
         req.staffRecord?.name || req.user?.email || null, tenantId, paymentBranch, paymentBranchId, courseExpected]
      );
      if (firstPaymentStatus === 'paid') {
        const journalId = await postPaymentJournal({
          paymentId, amount, currency, payType: 'COURSE',
          date: paymentDate, actor: req.user?.email || 'create-account', tenantId,
        }, conn);
        if (!journalId) throw new Error('First payment journal posting failed');
      }
    }

    const [[responseSubscriber]] = await conn.execute(
      'SELECT id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1',
      [tenantId, normEmail]
    );
    if (!responseSubscriber) throw new Error('Subscriber account projection was not created');
    createdSubscriberId = responseSubscriber.id;
    await conn.commit();
    if (existing) invalidateIdentity(tenantId, existing.id, normEmail);

    // Send welcome email with new password (best-effort, outside the transaction)
    try {
      await mailer.sendMail({
        tenantId: req.tenantId,
        from: `"معهد الدراسات النفسية" <${process.env.SMTP_USER || 'info@mahadnafsy.com'}>`,
        to: normEmail,
        subject: 'بيانات دخولك لمنصة معهد الدراسات النفسية',
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#7c3aed;text-align:center;">معهد الدراسات النفسية</h2>
          <p>مرحباً <strong>${displayName}</strong>،</p>
          <p>تم ${action === 'created' ? 'إنشاء' : 'تفعيل'} حسابك على منصة معهد الدراسات النفسية.</p>
          <div style="background:#f3f4f6;border:2px solid #7c3aed;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
            <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">كلمة المرور المؤقتة</p>
            <span style="font-family:monospace;font-size:26px;font-weight:bold;color:#7c3aed;letter-spacing:4px;">${tempPass}</span>
          </div>
          <p style="color:#6b7280;font-size:13px;">📧 البريد: <strong>${normEmail}</strong></p>
          <p style="color:#6b7280;font-size:13px;">🌐 <a href="https://mahadnafsy.com">mahadnafsy.com</a></p>
          <p style="color:#9ca3af;font-size:12px;margin-top:16px;">يرجى تغيير كلمة المرور بعد أول تسجيل دخول.</p>
        </div>`,
      });
      logger.info(`[create-account] ${action} + email sent → ${normEmail}`);
    } catch (mailErr) {
      logger.warn('[create-account] email failed:', mailErr.message);
    }

    res.json({
      ok: true,
      action,
      email: normEmail,
      tempPass,
      subscriberId: createdSubscriberId,
      firstPaymentStatus,
      approvalRequired: firstPaymentStatus === 'pending',
    });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[create-account]', e.message);
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Duplicate email, phone, or payment transaction reference' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
  finally { conn.release(); }
});

// GET /api/admin/subscribers/:id/password — DISABLED: plain-text passwords are no longer stored
// Returning null for backward compatibility; frontend should use reset-password flow instead.
router.get('/api/admin/subscribers/:id/password', requireAuth, requireAdminOrOnlineManager, (_req, res) => {
  res.json({ plain_password: null });
});

// GET /api/admin/subscribers/:id/activity — login count and last login from users table
router.get('/api/admin/subscribers/:id/activity', requireAuth, requireAdminOrOnlineManager, async (req, res) => {
  const { id } = req.params;
  try {
    // Look up the subscriber's email first
    const [[sub]] = await pool.query('SELECT email FROM subscribers WHERE id = ? AND tenant_id=? LIMIT 1', [id, req.tenantId]);
    if (!sub) return res.json({ login_count: 0, last_login: null });
    const [[user]] = await pool.query(
      'SELECT login_count, last_login FROM users WHERE tenant_id=? AND LOWER(TRIM(email)) = ? LIMIT 1',
      [req.tenantId, sub.email.toLowerCase().trim()]
    ).catch(() => [[null]]);
    res.json({
      login_count: user?.login_count ?? 0,
      last_login: user?.last_login ?? null,
    });
  } catch (err) {
    logger.error('[admin/subscribers/activity]', err);
    res.json({ login_count: 0, last_login: null });
  }
});

// GET /api/admin/missing-accounts — count subscribers without active user accounts
router.get('/api/admin/missing-accounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM subscribers s
       WHERE s.tenant_id=? AND s.email IS NOT NULL AND s.email != '' AND s.email LIKE '%@%'
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant_id=s.tenant_id AND LOWER(TRIM(u.email))=LOWER(TRIM(s.email)) AND u.is_active=1)`,
      [req.tenantId]
    );
    res.json({ total });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/bulk-create-accounts — create accounts for subscribers without one
router.post(
  '/api/admin/bulk-create-accounts',
  requireAuth, requireAdmin, bulkOperationLimiter,
  requireTenantQuota('users', { increment: req => Math.min(parseInt(req.body?.limit) || 50, 200) }),
  async (req, res) => {
  const limit = Math.min(parseInt(req.body?.limit) || 50, 200);
  const conn = await pool.getConnection();
  try {
    // A subscriber qualifies on a phone OR an email. It used to require an email,
    // which since the move to WhatsApp sign-in excluded exactly the clients who
    // most need an account made for them — the ones reached only by number.
    const [rows] = await conn.query(
      `SELECT s.id, s.name, s.email, s.phone FROM subscribers s
       WHERE s.tenant_id=? AND s.deleted_at IS NULL
         AND ((s.email IS NOT NULL AND s.email != '' AND s.email LIKE '%@%')
              OR (s.phone IS NOT NULL AND s.phone != ''))
         AND NOT EXISTS (
           SELECT 1 FROM users u
            WHERE u.tenant_id=s.tenant_id AND u.is_active=1
              AND (u.id = s.firebase_uid
                   OR (s.email IS NOT NULL AND s.email != ''
                       AND LOWER(TRIM(u.email))=LOWER(TRIM(s.email))))
         )
       LIMIT ?`, [req.tenantId, limit]
    );
    let created = 0, failed = 0, emailsSent = 0, whatsappsSent = 0, withoutIdentity = 0;
    for (const sub of rows) {
      const normEmail = String(sub.email || '').toLowerCase().trim();
      try {
        const tempPass = generateTemporaryPassword();
        const hash = await bcrypt.hash(tempPass, 12);
        const displayName = (sub.name || normEmail || 'عميل').trim();
        const newUserId = uuidv4();
        // Without this the account exists and cannot be entered: no number for
        // the OTP, and email sign-in is off.
        const phoneForUser = await claimWhatsAppIdentity(conn, { tenantId: req.tenantId, phone: sub.phone });
        if (!phoneForUser && !normEmail) { withoutIdentity++; failed++; continue; }
        await conn.execute(
          'INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active) VALUES (?,?,?,?,?,?,?,1)',
          [newUserId, req.tenantId, normEmail || null, phoneForUser, hash, displayName, 'user']
        );
        // Bind the two records so /api/me/* resolves this client immediately.
        if (phoneForUser || normEmail) {
          await conn.execute(
            'UPDATE subscribers SET firebase_uid=?, updated_at=updated_at WHERE id=? AND tenant_id=? AND firebase_uid IS NULL',
            [newUserId, sub.id, req.tenantId]
          ).catch(() => {});
        }
        created++;
        // WhatsApp first — it is how they will actually sign in. The temporary
        // password is a fallback for the recovery hatch, not the main route in.
        if (phoneForUser) {
          const waResult = await sendWhatsApp(
            phoneForUser,
            `مرحباً ${displayName} 👋\nتم إنشاء حسابك على منصة معهد الدراسات النفسية.\n\nللدخول: افتح mahadnafsy.com واختر "الدخول برقم الواتساب" — هيوصلك كود على نفس الرقم ده.`,
            { tenantId: req.tenantId }
          );
          if (waResult?.ok) whatsappsSent++;
        }
        // Email is a secondary copy now, and only possible when there is one.
        try {
          if (!normEmail) throw new Error('no email');
          await mailer.sendMail({
            tenantId: req.tenantId,
            from: `"معهد الدراسات النفسية" <${process.env.SMTP_USER || 'info@mahadnafsy.com'}>`,
            to: normEmail,
            subject: 'بيانات دخولك لمنصة معهد الدراسات النفسية',
            html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
              <h2 style="color:#7c3aed;text-align:center;">معهد الدراسات النفسية</h2>
              <p>مرحباً <strong>${displayName}</strong>،</p>
              <p>تم إنشاء حسابك على منصة معهد الدراسات النفسية.</p>
              <div style="background:#f3f4f6;border:2px solid #7c3aed;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
                <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">كلمة المرور المؤقتة</p>
                <span style="font-family:monospace;font-size:26px;font-weight:bold;color:#7c3aed;letter-spacing:4px;">${tempPass}</span>
              </div>
              <p style="color:#6b7280;font-size:13px;">📧 البريد: <strong>${normEmail}</strong></p>
              <p style="color:#6b7280;font-size:13px;">🌐 <a href="https://mahadnafsy.com">mahadnafsy.com</a></p>
              <p style="color:#9ca3af;font-size:12px;">يرجى تغيير كلمة المرور بعد أول تسجيل دخول.</p>
            </div>`,
          });
          emailsSent++;
        } catch { /* continue even if email fails */ }
      } catch { failed++; }
    }
    logger.info(`[bulk-create-accounts] created=${created} failed=${failed} whatsapp=${whatsappsSent} emails=${emailsSent} noIdentity=${withoutIdentity}`);
    res.json({ ok: true, created, failed, whatsappsSent, emailsSent, withoutIdentity, total: rows.length });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
  finally { conn.release(); }
});


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
          `SELECT id, email, name, password_hash, session_version, totp_enabled
           FROM users WHERE tenant_id=? AND email = ? AND is_active = 1`,
          [req.tenantId, email])
      : await conn.execute(
          `SELECT id, email, name, password_hash, session_version, totp_enabled
           FROM users WHERE tenant_id=? AND phone = ? AND is_active = 1`,
          [req.tenantId, phoneIdentity]);
    if (rows.length === 0) {
      // No users record — check if they exist as a subscriber (admin-added clients).
      // Subscribers are only keyed by email, so this hint doesn't apply to a
      // phone identifier.
      const [[subExists]] = identifierIsEmail
        ? await conn.execute(
            'SELECT id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email)) = ? AND is_active = 1 LIMIT 1',
            [req.tenantId, email]
          )
        : [[null]];
      conn.release();
      conn = null;
      if (subExists) {
        logger.info('[login] subscriber exists but no users record — directing to reset:', logIdentifier);
        await logLoginAttempt({ email: logIdentifier, req, status: 'failed', failureReason: 'password_not_set' });
        return res.status(401).json({
          error: '\u0644\u0645 \u064a\u062a\u0645 \u062a\u0639\u064a\u064a\u0646 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u0644\u0647\u0630\u0627 \u0627\u0644\u062d\u0633\u0627\u0628 \u0628\u0639\u062f. \u064a\u0631\u062c\u0649 \u0627\u0644\u0636\u063a\u0637 \u0639\u0644\u0649 "\u0646\u0633\u064a\u062a \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631" \u0644\u062a\u0639\u064a\u064a\u0646 \u0643\u0644\u0645\u0629 \u0645\u0631\u0648\u0631 \u062c\u062f\u064a\u062f\u0629.',
          needsPasswordReset: true,
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
    const session = await rotateSingleSession(pool, {
      userId: user.id, tenantId: req.tenantId || 'tenant-default', req,
    });
    invalidateIdentity(req.tenantId, user.id, user.email);
    const token = signAccessToken({
      uid: user.id, email: user.email, tenantId: req.tenantId || 'tenant-default',
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: false,
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
    // Set httpOnly cookie (secure, 7-day expiry) + return token in body for backward compat
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
    res.json({ ok: true, token, user: { uid: user.id, email: user.email, displayName: user.name || '' } });
  } catch (err) {
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

// Roles that grant full admin-level access in the frontend
const FULL_ACCESS_ROLES_AUTH = ['manager', 'admin', 'daqqi_manager', 'online_manager'];

// GET /api/auth/me
router.get('/api/auth/me', requireAuth, requireDb, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT id, email, name FROM users WHERE id = ? AND tenant_id=?', [req.user.uid, req.tenantId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    let isAdmin = ADMIN_EMAILS.includes(u.email) || ADMIN_UIDS.includes(u.id);
    if (!isAdmin) {
      // Also grant admin access to staff with full-access roles (manager, admin, daqqi_manager, online_manager)
      const [[staff]] = await conn.execute(
        `SELECT role FROM staff WHERE tenant_id=? AND LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1`,
        [req.tenantId, u.email.toLowerCase().trim()]
      );
      if (staff && FULL_ACCESS_ROLES_AUTH.includes(String(staff.role || '').toLowerCase())) isAdmin = true;
    }
    // Surface the user's phone (users table has none) — prefer subscriber, then most recent lead.
    let phone = '';
    try {
      const em = (u.email || '').toLowerCase().trim();
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
    } catch { /* phone is best-effort */ }
    res.json({ uid: u.id, email: u.email, displayName: u.name || '', phone, isAdmin });
  } catch (err) {
    logger.error('[auth/me]', err);
    if (!res.headersSent) {
      const status = err && ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(err.code) ? 503 : 500;
      res.status(status).json({ error: status === 503 ? 'Database unavailable' : 'Server error' });
    }
  } finally { if (conn) conn.release(); }
});

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

    const [[user]] = await pool.query(
      'SELECT id, email, name FROM users WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1',
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

    // Identical session issuance to the password path: rotating the session
    // invalidates whatever device was signed in before.
    const session = await rotateSingleSession(pool, { userId: user.id, tenantId, req });
    invalidateIdentity(tenantId, user.id, user.email);
    const token = signAccessToken({
      uid: user.id, email: user.email, tenantId,
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: false,
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
      require('../lib/lifecycle').trigger('lead_created', {
        name: user.name || '',
        phone,
        tenantId,
      }, { dedupeKey: `wa-signup:${user.id}` })
        .catch(err => logger.warn('[wa-otp] lead_created journey failed', { error: err.message }));
    }

    // `created` lets the client greet a brand-new customer differently from a
    // returning one, and lets it ask for a name it did not collect up front.
    res.json({
      ok: true, token, created: Boolean(created),
      user: { uid: user.id, email: user.email, displayName: user.name || '', phone },
    });
  } catch (e) {
    if (e.statusCode) {
      await logLoginAttempt({ email: null, req, status: 'failed', failureReason: 'wa_otp_invalid' }).catch(() => {});
      return res.status(e.statusCode).json({ error: e.message });
    }
    logger.error('[wa-otp] verify failed', e.message);
    res.status(500).json({ error: 'تعذّر التحقق من الرمز' });
  }
});

router.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const sendEmail = (to, subject, html) => sendEmailBase(to, subject, html, { tenantId: req.tenantId });
  const { email: rawIdentifier } = req.body || {};
  if (!rawIdentifier) return res.status(400).json({ error: 'البريد الإلكتروني أو رقم الهاتف مطلوب' });
  const identifierIsEmail = isEmail(rawIdentifier);
  const safeEmail = identifierIsEmail ? rawIdentifier.toLowerCase().trim() : null;
  const phoneIdentity = identifierIsEmail ? null : normalizeWhatsAppNumber(rawIdentifier);
  const logIdentifier = identifierIsEmail ? safeEmail : phoneIdentity;
  try {
    let user = null;

    if (identifierIsEmail) {
      // 1. Check users table (primary auth table — registered via website)
      const [[existingUser]] = await pool.query('SELECT id, name, email, phone FROM users WHERE tenant_id=? AND email = ? AND is_active = 1 LIMIT 1', [req.tenantId, safeEmail]);
      if (existingUser) {
        user = existingUser;
      } else {
        // 2. Fallback: check subscribers table — admin-added clients don't have a users record
        const [[sub]] = await pool.query('SELECT id, name, email FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email)) = ? AND is_active = 1 LIMIT 1', [req.tenantId, safeEmail]);
        if (sub) {
          // Auto-create a users record so they can authenticate going forward
          // Use a locked (un-guessable) password hash — they MUST reset via OTP
          const tempHash = await bcrypt.hash(uuidv4() + Date.now(), 10); // random unhittable hash
          const newUserId = uuidv4();
          await pool.query(
            'INSERT IGNORE INTO users (id, tenant_id, email, password_hash, name, role, is_active) VALUES (?,?,?,?,?,?,1)',
            [newUserId, req.tenantId, safeEmail, tempHash, sub.name || safeEmail.split('@')[0], 'user']
          );
          // Fetch back the inserted (or pre-existing race-condition) record
          const [[createdUser]] = await pool.query('SELECT id, name, email, phone FROM users WHERE tenant_id=? AND email = ? LIMIT 1', [req.tenantId, safeEmail]);
          if (createdUser) {
            user = createdUser;
            logger.info('[forgot-password] auto-created users record for subscriber:', safeEmail);
          }
        }
      }
    } else {
      // Phone identifier — only the users table carries a phone; there is no
      // subscriber-fallback equivalent for it.
      const [[existingUser]] = await pool.query('SELECT id, name, email, phone FROM users WHERE tenant_id=? AND phone = ? AND is_active = 1 LIMIT 1', [req.tenantId, phoneIdentity]);
      if (existingUser) user = existingUser;
    }

    // Always return success to prevent user enumeration
    if (!user) {
      logger.info('[forgot-password] no active account found for:', logIdentifier);
      return res.json({ ok: true });
    }

    const otp = generateNumericCode();
    const otpId = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    // The OTP row is always keyed by the account's real email — even when the
    // customer typed a phone to get here, or delivery goes out over WhatsApp
    // below — so verify-otp only ever needs one lookup shape.
    const otpConn = await pool.getConnection();
    try {
      await otpConn.beginTransaction();
      await otpConn.query(
        "UPDATE otp_codes SET used=1 WHERE tenant_id=? AND email=? AND type='password_reset' AND used=0",
        [req.tenantId, user.email]
      );
      await otpConn.query(
        `INSERT INTO otp_codes (id, tenant_id, user_id, email, code, type, expires_at) VALUES (?,?,?,?,?,?,?)`,
        [otpId, req.tenantId, user.id, user.email, hashOtp({
          tenantId: req.tenantId, email: user.email, type: 'password_reset', code: otp,
        }), 'password_reset', expiresAt]
      );
      await otpConn.commit();
    } catch (error) {
      await otpConn.rollback().catch(() => {});
      throw error;
    } finally {
      otpConn.release();
    }

    // WhatsApp first — it's the number the account actually answers on. Email
    // is the fallback for accounts with no phone on file, or when the send
    // itself fails. The response never says which channel was used (or
    // whether one was): that would let a guess distinguish a real account
    // from a made-up one.
    const dialable = user.phone ? toDialable(user.phone) : '';
    if (dialable) {
      const sent = await sendWhatsApp(
        dialable,
        `رمز إعادة تعيين كلمة المرور: ${otp}\nصالح لمدة 15 دقيقة. لا تشاركه مع أحد.`,
        { tenantId: req.tenantId }
      ).catch(e => ({ ok: false, reason: e.message }));
      if (sent.ok) {
        await pool.query(
          `UPDATE otp_codes
              SET delivery_status='accepted', provider_message_id=?, sent_at=NOW()
            WHERE id=? AND tenant_id=?`,
          [sent.idMessage || null, otpId, req.tenantId]
        );
        logger.info('[forgot-password] OTP sent via WhatsApp for account:', user.email);
        return res.json({ ok: true });
      }
      logger.warn('[forgot-password] WhatsApp delivery failed, falling back to email:', describeReason(sent.reason));
    }
    try {
      const delivery = await sendEmail(user.email, 'رمز إعادة تعيين كلمة المرور',
        `<p>أهلاً ${user.name || ''}،</p>
         <p>تلقّينا طلب إعادة تعيين كلمة المرور لحسابك.</p>
         <div class="otp-box">${otp}</div>
         <p style="color:#888;font-size:13px;text-align:center;">صالح لمدة 15 دقيقة فقط. إذا لم تطلب ذلك، تجاهل هذا البريد.</p>`
      );
      await pool.query(
        `UPDATE otp_codes
            SET delivery_status='accepted', provider_message_id=?, sent_at=NOW()
          WHERE id=? AND tenant_id=?`,
        [String(delivery.messageId || '').slice(0, 255) || null, otpId, req.tenantId]
      );
      logger.info('[forgot-password] OTP sent via email to:', user.email);
      res.json({ ok: true });
    } catch (mailErr) {
      logger.error('[forgot-password] SMTP error for', user.email, ':', mailErr.message);
      await pool.query(
        `UPDATE otp_codes
            SET used=1, delivery_status='failed', delivery_error_code=?
          WHERE id=? AND tenant_id=?`,
        [String(mailErr.code || 'SMTP_REJECTED').slice(0, 80), otpId, req.tenantId]
      ).catch(() => {});
      res.status(503).json({
        error: 'تعذر تسليم رسالة الاسترجاع الآن؛ لم يتم تفعيل أي كود. حاول مرة أخرى أو تواصل مع الدعم',
        code: 'RESET_EMAIL_NOT_DELIVERED',
      });
    }
  } catch (e) { logger.error('[forgot-password]', e); res.status(500).json({ error: 'فشل الإرسال' }); }
});

// POST /api/auth/verify-otp — verify OTP and return a short-lived reset token
router.post('/api/auth/verify-otp', otpLimiter, async (req, res) => {
  const { email: rawIdentifier, code, type = 'password_reset' } = req.body || {};
  if (!rawIdentifier || !code) return res.status(400).json({ error: 'البريد أو رقم الهاتف والرمز مطلوبان' });
  let safeEmail;
  if (isEmail(rawIdentifier)) {
    safeEmail = rawIdentifier.toLowerCase().trim();
  } else {
    // The OTP row is always keyed by the account's real email (see
    // forgot-password), so a phone identifier has to be resolved first.
    const phoneIdentity = normalizeWhatsAppNumber(rawIdentifier);
    const [[byPhone]] = await pool.query(
      'SELECT email FROM users WHERE tenant_id=? AND phone=? AND is_active=1 LIMIT 1',
      [req.tenantId, phoneIdentity]
    );
    // Deliberately fall through to the ordinary "code incorrect or expired"
    // rejection below rather than a distinct error — an unresolvable phone
    // must not read differently from a wrong code, or it becomes a way to
    // probe which numbers have accounts.
    safeEmail = byPhone ? byPhone.email : `unresolved:${phoneIdentity}`;
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      `SELECT id, user_id FROM otp_codes
        WHERE tenant_id=? AND email=? AND code=? AND type=? AND used=0
          AND delivery_status='accepted' AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [req.tenantId, safeEmail, hashOtp({
        tenantId: req.tenantId, email: safeEmail, type, code,
      }), type]
    );
    if (!row) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(400).json({ error: 'الرمز غير صحيح أو منتهي الصلاحية' });
    }
    const [consumed] = await conn.query(
      'UPDATE otp_codes SET used=1 WHERE id=? AND tenant_id=? AND used=0',
      [row.id, req.tenantId]
    );
    if (consumed.affectedRows !== 1) throw new Error('OTP already consumed');
    // Issue a short-lived reset token (5 min)
    const [[user]] = await conn.query(
      'SELECT session_version FROM users WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1',
      [row.user_id, req.tenantId]
    );
    if (!user) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(400).json({ error: 'الحساب غير متاح' });
    }
    await conn.commit();
    conn.release();
    conn = null;
    const resetToken = jwt.sign(
      {
        uid: row.user_id, tid: req.tenantId, sv: Number(user.session_version),
        purpose: 'reset', jti: uuidv4(),
      },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    res.json({ ok: true, resetToken });
  } catch (e) {
    if (conn) {
      await conn.rollback().catch(() => {});
      conn.release();
    }
    res.status(500).json({ error: 'فشل التحقق' });
  }
});

// POST /api/auth/reset-password — set new password using reset token
router.post('/api/auth/reset-password', loginLimiter, async (req, res) => {
  const { resetToken, newPassword } = req.body || {};
  if (!resetToken || !newPassword) return res.status(400).json({ error: 'البيانات مطلوبة' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
  try {
    const payload = jwt.verify(resetToken, JWT_SECRET);
    if (payload.purpose !== 'reset') return res.status(400).json({ error: 'رمز غير صالح' });
    const hash = await bcrypt.hash(newPassword, 12);
    if (payload.tid !== req.tenantId) return res.status(400).json({ error: 'Tenant mismatch' });
    const [updated] = await pool.query(
      `UPDATE users
       SET password_hash=?, session_version=session_version+1,
           active_session_id=NULL, active_session_ip_hash=NULL,
           active_session_started_at=NULL, active_session_last_seen_at=NULL
       WHERE id=? AND tenant_id=? AND session_version=?`,
      [hash, payload.uid, payload.tid, Number(payload.sv)]
    );
    if (!updated.affectedRows) return res.status(400).json({ error: 'Invalid reset token' });
    invalidateIdentity(payload.tid, payload.uid);
    res.json({ ok: true });
  } catch { res.status(400).json({ error: 'انتهت صلاحية الرمز' }); }
});

// PUT /api/auth/update-profile
router.put('/api/auth/update-profile', requireAuth, async (req, res) => {
  const { name, nameEn } = req.body || {};
  const hasName = typeof name === 'string' && name.trim().length > 0;
  const hasNameEn = typeof nameEn === 'string' && nameEn.trim().length > 0;
  if (!hasName && !hasNameEn) return res.status(400).json({ error: 'Name or English name required' });
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const safeName = hasName ? sanitize(name, 255) : null;
    const safeNameEn = hasNameEn ? sanitize(nameEn, 255) : null;
    const identityEmail = String(req.user.email || '').trim().toLowerCase();
    await conn.beginTransaction();
    transactionStarted = true;
    if (safeName) {
      await conn.execute('UPDATE users SET name = ? WHERE id = ? AND tenant_id=?', [safeName, req.user.uid, req.tenantId]);
    }
    const [subscriberUpdate] = await conn.execute(
      `UPDATE subscribers
          SET name=CASE WHEN ? IS NULL THEN name ELSE ? END,
              crm_json=CASE WHEN ? IS NULL THEN crm_json
                ELSE JSON_SET(
                  CASE WHEN JSON_VALID(crm_json) THEN crm_json ELSE JSON_OBJECT() END,
                  '$.nameEn', ?
                )
              END
        WHERE tenant_id=?
          AND (firebase_uid=? OR LOWER(TRIM(email))=LOWER(TRIM(?)))`,
      [safeName, safeName, safeNameEn, safeNameEn, req.tenantId, req.user.uid, identityEmail]
    );
    if (safeNameEn && !subscriberUpdate.affectedRows) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Subscriber profile not found' });
    }
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (err) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[auth/update-profile]', err);
    res.status(500).json({ error: 'Update failed' });
  } finally { if (conn) conn.release(); }
});

// PUT /api/auth/update-password
router.put('/api/auth/update-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT password_hash FROM users WHERE id = ? AND tenant_id=?', [req.user.uid, req.tenantId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await conn.execute(
      `UPDATE users SET password_hash = ?, session_version=session_version+1,
        active_session_id=NULL, active_session_ip_hash=NULL,
        active_session_started_at=NULL, active_session_last_seen_at=NULL
       WHERE id = ? AND tenant_id=?`,
      [hash, req.user.uid, req.tenantId]
    );
    invalidateIdentity(req.tenantId, req.user.uid, req.user.email);
    clearAuthCookie(res);
    res.json({ ok: true, reauthenticationRequired: true });
  } catch (err) {
    logger.error('[auth/update-password]', err);
    res.status(500).json({ error: 'Update failed' });
  } finally { conn.release(); }
});

// POST /api/admin/force-reset-password — direct password reset by email (super-admin only:
// it can reset ANY account incl. admins, so online/daqqi managers must not have it).
router.post('/api/admin/force-reset-password', requireAuth, requireSuperAdmin, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  const newPassword = generateTemporaryPassword();
  const conn = await pool.getConnection();
  try {
    const hash = await bcrypt.hash(newPassword, 12);
    const normalizedEmail = email.toLowerCase().trim();
    const [result] = await conn.execute(
      `UPDATE users SET password_hash = ?, session_version=session_version+1,
        active_session_id=NULL, active_session_ip_hash=NULL,
        active_session_started_at=NULL, active_session_last_seen_at=NULL
       WHERE tenant_id=? AND email = ?`,
      [hash, req.tenantId, normalizedEmail]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    invalidateIdentity(req.tenantId, '', normalizedEmail);
    res.json({ ok: true });
  } catch (err) {
    logger.error('[admin/force-reset-password]', err);
    res.status(500).json({ error: 'Reset failed' });
  } finally { conn.release(); }
});

// PUT /api/admin/subscribers/:id/credentials  — admin/online_manager changes login email and/or password
router.put('/api/admin/subscribers/:id/credentials', requireAuth, requireAdminOrOnlineManager, async (req, res) => {
  const { id } = req.params;
  const { currentEmail, newEmail, newPassword } = req.body || {};
  if (!currentEmail) return res.status(400).json({ error: 'currentEmail required' });
  if (!newEmail && !newPassword) return res.status(400).json({ error: 'Nothing to update' });
  const conn = await pool.getConnection();
  try {
    // Validate minimal password length
    if (newPassword && newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    // Validate new email not already taken by another user
    if (newEmail && newEmail.toLowerCase().trim() !== currentEmail.toLowerCase().trim()) {
      const [[existing]] = await conn.execute('SELECT id FROM users WHERE tenant_id=? AND email = ? LIMIT 1', [req.tenantId, newEmail.toLowerCase().trim()]);
      if (existing) return res.status(409).json({ error: `البريد الإلكتروني ${newEmail} مسجل بالفعل لمستخدم آخر` });
    }
    // Build dynamic UPDATE for users table
    const sets = [];
    const params = [];
    if (newEmail) { sets.push('email = ?'); params.push(newEmail.toLowerCase().trim()); }
    if (newPassword) { sets.push('password_hash = ?'); params.push(await bcrypt.hash(newPassword, 12)); }
    sets.push('session_version = session_version + 1');
    sets.push('active_session_id = NULL', 'active_session_ip_hash = NULL',
      'active_session_started_at = NULL', 'active_session_last_seen_at = NULL');
    params.push(req.tenantId, currentEmail.toLowerCase().trim());
    const [result] = await conn.execute(`UPDATE users SET ${sets.join(', ')} WHERE tenant_id=? AND email = ?`, params);
    if (result.affectedRows === 0) {
      // No user account yet — create one using the subscriber's data
      if (!newPassword) return res.status(404).json({ error: 'لم يُعثر على حساب بهذا البريد. يرجى تعيين كلمة مرور لإنشاء الحساب.' });
      const [[sub]] = await conn.execute('SELECT id, name, email, phone FROM subscribers WHERE id = ? AND tenant_id=?', [id, req.tenantId]);
      if (!sub) return res.status(404).json({ error: 'لم يُعثر على المشترك.' });
      const finalEmail = (newEmail || sub.email).toLowerCase().trim();
      // Carry the subscriber's number onto the account, or it is created unable
      // to sign in — WhatsApp OTP has no number and email sign-in is off.
      const phoneForUser = await claimWhatsAppIdentity(conn, { tenantId: req.tenantId, phone: sub.phone });
      await conn.execute(
        'INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [sub.id, req.tenantId, finalEmail, phoneForUser, await bcrypt.hash(newPassword, 12), sub.name || '', 'client']
      );
      if (finalEmail !== sub.email.toLowerCase().trim()) {
        await conn.execute('UPDATE subscribers SET email = ? WHERE id = ? AND tenant_id=?', [finalEmail, id, req.tenantId]);
      }
    } else if (newEmail) {
      // If email changed, sync subscribers table too
      await conn.execute('UPDATE subscribers SET email = ? WHERE id = ? AND tenant_id=?', [newEmail.toLowerCase().trim(), id, req.tenantId]);
    }
    if (result.affectedRows) {
      invalidateIdentity(req.tenantId, '', currentEmail);
      if (newEmail) invalidateIdentity(req.tenantId, '', newEmail);
    }
    res.json({ ok: true, temporaryPassword: newPassword });
  } catch (err) {
    logger.error('[admin/subscribers/credentials]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

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
    });
    setAuthCookie(res, token);
    res.json({ ok: true, token });
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
    const issuer = 'مهاد نفسي';
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
    });
    invalidateIdentity(req.tenantId, user.id, email);
    const fullToken = signAccessToken({
      uid: user.id, email, tenantId: req.tenantId,
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: true,
    });
    setAuthCookie(res, fullToken);
    res.json({ ok: true, token: fullToken, message: 'تم تفعيل المصادقة الثنائية بنجاح' });
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
    const forcedAdmin = ADMIN_EMAILS.includes(req.user.email) || ADMIN_UIDS.includes(req.user.uid);
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
    });
    invalidateIdentity(req.tenantId, user.id, email);
    const token = signAccessToken({
      uid: user.id, email, tenantId: req.tenantId,
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: false,
    });
    setAuthCookie(res, token);
    res.json({ ok: true, token, message: 'تم تعطيل المصادقة الثنائية' });
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
      payload = jwt.verify(pendingToken, JWT_SECRET);
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

    // Issue full JWT
    const session = await rotateSingleSession(pool, {
      userId: payload.uid, tenantId, req,
    });
    invalidateIdentity(tenantId, payload.uid, payload.email);
    const fullToken = signAccessToken({
      uid: payload.uid, email: payload.email, tenantId,
      sessionVersion: session.sessionVersion, sessionId: session.sessionId, mfaVerified: true,
    });
    setAuthCookie(res, fullToken);
    await logLoginAttempt({ userId: payload.uid, email: payload.email, req, tenantId: payload.tid || req.tenantId, status: '2fa_success' });
    res.json({ ok: true, token: fullToken });
  } catch (e) {
    logger.error('[2fa/verify]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
