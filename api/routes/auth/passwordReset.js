'use strict';
// Forgotten passwords: the code, its check, the new password.
// One part of routes/auth.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  logger,
  bcrypt,
  jwt,
  createHmac,
  resolveSecret,
  uuidv4,
  generateNumericCode,
  pool,
  sendEmailBase,
  describeReason,
  sendWhatsApp,
  JWT_SECRET,
  invalidateIdentity,
  loginLimiter,
  otpLimiter,
  forgotPasswordLimiter,
  isEmail,
  normalizeWhatsAppNumber,
  toDialable,
} = require('./_shared');

const router = Router();

function hashOtp({ tenantId, email, type, code }) {
  const secret = String(resolveSecret('OTP_HMAC_SECRET') || JWT_SECRET);
  return createHmac('sha256', secret)
    .update(`${tenantId}\0${String(email).toLowerCase().trim()}\0${type}\0${String(code).trim()}`)
    .digest('hex');
}

router.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  // 'otp': this route sends the password-reset code. Without a category the
  // send is refused as soon as EMAIL_OUTBOUND_CATEGORIES is set to anything,
  // which would lock every customer out of their own account the moment
  // somebody used that variable to stop marketing mail.
  const sendEmail = (to, subject, html) =>
    sendEmailBase(to, subject, html, { tenantId: req.tenantId, category: 'otp' });
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
      const [[existingUser]] = await pool.query('SELECT id, name, email, phone FROM users WHERE tenant_id=? AND phone = ? AND is_active = 1 LIMIT 1', [req.tenantId, phoneIdentity]);
      if (existingUser) {
        user = existingUser;
      } else {
        // Same fallback the email branch has had all along: a client added by an
        // admin has a subscribers row and no users row. Without this, a paying
        // customer who types their WhatsApp number gets the silent "ok" below and
        // no code ever arrives — so "just use forgot password" could not work for
        // them however many times they tried.
        const [[sub]] = await pool.query(
          `SELECT id, name, email, phone FROM subscribers
            WHERE tenant_id=? AND phone = ? AND is_active = 1 AND deleted_at IS NULL
            LIMIT 1`,
          [req.tenantId, phoneIdentity]
        );
        if (sub) {
          // Locked, un-guessable hash: the only way in is the OTP they are about
          // to receive. Email stays NULL when the subscriber has none — phone is
          // the identity here.
          const tempHash = await bcrypt.hash(uuidv4() + Date.now(), 10);
          const newUserId = uuidv4();
          await pool.query(
            `INSERT IGNORE INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active)
             VALUES (?,?,?,?,?,?,?,1)`,
            [newUserId, req.tenantId, sub.email ? String(sub.email).toLowerCase().trim() : null,
              phoneIdentity, tempHash, sub.name || '', 'user']
          );
          const [[createdUser]] = await pool.query(
            'SELECT id, name, email, phone FROM users WHERE tenant_id=? AND phone = ? LIMIT 1',
            [req.tenantId, phoneIdentity]
          );
          if (createdUser) {
            user = createdUser;
            logger.info('[forgot-password] auto-created users record for subscriber by phone:', phoneIdentity);
          }
        }
      }
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
      // Keyed by user_id, not email: an account with no email (phone-only
      // registration, or a subscriber claimed by number) has email NULL, and
      // `email=NULL` matches nothing in SQL — so older codes were never
      // invalidated for exactly the accounts that rely on WhatsApp.
      await otpConn.query(
        "UPDATE otp_codes SET used=1 WHERE tenant_id=? AND user_id=? AND type='password_reset' AND used=0",
        [req.tenantId, user.id]
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
        // A password-reset code is an OTP: it stays on with the sign-in code.
        { tenantId: req.tenantId, category: 'otp' }
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
    // Phone-only accounts (registration no longer requires an email — see
    // /api/user/signup) can reach here with user.email === null. Falling
    // through used to call sendEmail(null, ...), which SMTP always rejects,
    // producing the same generic "email delivery failed" error a real bounce
    // would — misleading for an account that never had an email to try. Fail
    // with the true reason instead of a fabricated SMTP one.
    if (!user.email) {
      await pool.query(
        `UPDATE otp_codes SET used=1, delivery_status='failed', delivery_error_code=? WHERE id=? AND tenant_id=?`,
        ['NO_CHANNEL_AVAILABLE', otpId, req.tenantId]
      ).catch(() => {});
      logger.warn('[forgot-password] no deliverable channel (no email on file, WhatsApp unavailable) for:', logIdentifier);
      return res.status(503).json({
        error: 'تعذر إرسال رمز الاسترجاع الآن؛ خدمة واتساب غير متاحة مؤقتاً ولا يوجد بريد إلكتروني مسجل على الحساب. تواصل مع الدعم لاستعادة كلمة المرور.',
        code: 'NO_RECOVERY_CHANNEL',
      });
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
  // Resolve the account first, then look the code up by its id. The row used to
  // be found by email, which silently never matched for an account whose email
  // is NULL (phone-only registration, or a subscriber claimed by number): the
  // code arrived on WhatsApp and every attempt to enter it answered "الرمز غير
  // صحيح" forever. The hash still covers the email value so codes already in
  // flight stay valid.
  let account = null;
  if (isEmail(rawIdentifier)) {
    const safeEmail = rawIdentifier.toLowerCase().trim();
    const [[byEmail]] = await pool.query(
      'SELECT id, email FROM users WHERE tenant_id=? AND email=? AND is_active=1 LIMIT 1',
      [req.tenantId, safeEmail]
    );
    account = byEmail || { id: null, email: safeEmail };
  } else {
    const phoneIdentity = normalizeWhatsAppNumber(rawIdentifier);
    const [[byPhone]] = await pool.query(
      'SELECT id, email FROM users WHERE tenant_id=? AND phone=? AND is_active=1 LIMIT 1',
      [req.tenantId, phoneIdentity]
    );
    // Deliberately fall through to the ordinary "code incorrect or expired"
    // rejection below rather than a distinct error — an unresolvable phone
    // must not read differently from a wrong code, or it becomes a way to
    // probe which numbers have accounts.
    account = byPhone || { id: null, email: `unresolved:${phoneIdentity}` };
  }
  const safeEmail = account.email;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      `SELECT id, user_id FROM otp_codes
        WHERE tenant_id=? AND user_id=? AND code=? AND type=? AND used=0
          AND delivery_status IN ('accepted','sent','delivered','read') AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [req.tenantId, account.id, hashOtp({
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
    const payload = jwt.verify(resetToken, JWT_SECRET, { algorithms: ['HS256'] });
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

module.exports = router;
