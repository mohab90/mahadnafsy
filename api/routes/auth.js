'use strict';
const logger = require('../lib/logger');
const { Router } = require('express');
const router = Router();

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { uuidv4 } = require('../lib/id');

const { pool, getStaffIdByEmail, ensureUsersTable, requireDb } = require('../lib/db');
const { sanitize, validate, EMAIL_RE, PHONE_RE } = require('../lib/helpers');
const { sendEmail, htmlEmail, mailer } = require('../lib/email');
const { getNextClientCode } = require('../lib/mappers');
const { logLeadEvent } = require('../lib/crm');
const { sendWhatsApp } = require('../lib/whatsapp');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { JWT_SECRET, JWT_EXPIRY, revokeToken } = require('../lib/token');
const { ADMIN_EMAILS, ADMIN_UIDS, requireAuth, requireAdmin, requireAdminOrOnlineManager } = require('../middleware/auth');
const { registerLimiter, loginLimiter, otpLimiter, forgotPasswordLimiter } = require('../middleware/rateLimits');
const { isString, isEmail, validateBody } = require('../middleware/validate');
// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/register
router.post('/api/auth/register', registerLimiter, requireDb,
  validateBody({
    email:    v => isEmail(v)            || 'Email address is invalid',
    password: v => isString(v, 200) && (v || '').length >= 6 || 'Password must be at least 6 characters',
  }),
  async (req, res) => {
  const { email, password, name, phone, country, interest, ref } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await ensureUsersTable(conn);
    const [existing] = await conn.execute('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const id = uuidv4();
    const hash = await bcrypt.hash(password, 12);
    await conn.execute(
      'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)',
      [id, email.toLowerCase().trim(), hash, (name || '').trim(), 'user']
    );
    // Also write to registrations table (best-effort)
    try {
      await conn.execute(
        `INSERT IGNORE INTO registrations (id, uid, name, email, phone, country, interest, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [uuidv4(), id, (name || '').trim(), email.toLowerCase().trim(), phone || '', country || '', interest || '']
      );
    } catch { /* registrations table may not exist — ignore */ }
    // If this is a staff/admin email — skip creating CRM lead/subscriber records
    const [[isStaffEmail]] = await conn.execute(
      'SELECT id FROM staff WHERE LOWER(email) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1',
      [email.toLowerCase().trim()]
    ).catch(() => [[null]]);
    if (isStaffEmail || ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase().trim())) {
      const token = jwt.sign({ uid: id, email: email.toLowerCase().trim(), jti: uuidv4() }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      res.setHeader('Set-Cookie', `authToken=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=None; Secure`);
      return res.json({ ok: true, token, user: { uid: id, email: email.toLowerCase().trim(), displayName: (name || '').trim() } });
    }
    // Generate ONE shared client code — same code on both lead and subscriber for this person
    let sharedClientCode = null;
    try { sharedClientCode = await getNextClientCode(conn); } catch (codeErr) { logger.warn('[register] Could not get client code:', codeErr.message); }
    // Auto-create lead in CRM so admin sees new registrations in العملاء المحتملين (best-effort)
    let createdLeadId = null;
    try {
      // Check for existing lead with same phone or email first
      const normalizedPhone = (phone || '').replace(/\D/g, '');
      const normalizedEmail = email.toLowerCase().trim();
      let existingLeadId = null;
      if (normalizedPhone.length >= 7) {
        const [[byPhone]] = await conn.execute(
          'SELECT id FROM leads WHERE REGEXP_REPLACE(phone, "[^0-9]", "") = ? AND hidden = 0 LIMIT 1',
          [normalizedPhone]
        );
        if (byPhone) existingLeadId = byPhone.id;
      }
      if (!existingLeadId) {
        const [[byEmail]] = await conn.execute(
          'SELECT id FROM leads WHERE LOWER(TRIM(email)) = ? AND hidden = 0 LIMIT 1',
          [normalizedEmail]
        );
        if (byEmail) existingLeadId = byEmail.id;
      }
      if (existingLeadId) {
        // Update existing lead with better name/code instead of creating duplicate
        createdLeadId = existingLeadId;
        const newName = (name || '').trim();
        await conn.execute(
          'UPDATE leads SET name = IF(LENGTH(?) > 0, ?, name), client_code = IF(client_code IS NULL, ?, client_code) WHERE id = ?',
          [newName, newName, sharedClientCode, existingLeadId]
        );
        logger.info(`[register] Reused existing lead ${existingLeadId} for ${normalizedEmail}`);
      } else {
        const leadId = `lead-reg-${uuidv4()}`;
        createdLeadId = leadId;
        await conn.execute(
          `INSERT INTO leads (id, client_code, name, email, phone, source, status, hidden, created_at)
           VALUES (?, ?, ?, ?, ?, 'تسجيل دخول', 'new', 0, NOW())`,
          [leadId, sharedClientCode, (name || '').trim() || email.split('@')[0], normalizedEmail, phone || '']
        );
        logger.info(`[register] Created lead ${leadId} code=${sharedClientCode} for ${normalizedEmail}`);
        await logLeadEvent(leadId, 'created', 'تسجيل جديد عبر الموقع', { source: 'تسجيل دخول', phone, status: 'new' }).catch(() => {});
      }
    } catch (leadErr) { logger.warn('[register] Could not create lead:', leadErr.message); }
    // NOTE: No subscriber record created on register — client stays in عملاء محتملين until admin manually
    // converts them after payment (admin moves them to عملاء الأونلاين and assigns a course).
    const token = jwt.sign({ uid: id, email: email.toLowerCase().trim(), jti: uuidv4() }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.setHeader('Set-Cookie', `authToken=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=None; Secure`);
    res.json({ ok: true, token, user: { uid: id, email: email.toLowerCase().trim(), displayName: (name || '').trim() } });

    // Best-effort referral tracking
    if (ref) {
      pool.query('UPDATE referral_codes SET uses = uses + 1 WHERE code = ?', [String(ref).trim().toUpperCase()]).catch(() => {});
      if (createdLeadId) pool.query("UPDATE leads SET notes = CONCAT(IFNULL(notes,''), ?) WHERE id=?", [`\n[مُحال من كود: ${ref}]`, createdLeadId]).catch(() => {});
    }

    // Best-effort WhatsApp welcome message
    if (phone) {
      sendWhatsApp(phone, `أهلاً وسهلاً ${(name || '').trim() || ''}! 🎉\nنرحب بك في معهد مهاد للدراسات النفسية.\nيمكنك الآن الدخول لحسابك واستعراض كورساتنا المتاحة.\nللتواصل أو الاستفسار راسلنا هنا. 💚`).catch(() => {});
    }
    // Enqueue registration email sequence (best-effort)
    enqueueEmailSequence('registration', email.toLowerCase().trim(), (name || '').trim(), Date.now()).catch(() => {});
  } catch (err) {
    logger.error('[auth/register]', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally { conn.release(); }
});
// Alias — WAF on shared hosting may block /api/auth/ paths; this exposes the same handler under /api/user/signup
router.post('/api/user/signup', registerLimiter,
  validateBody({
    email:    v => isEmail(v)            || 'Email address is invalid',
    password: v => isString(v, 200) && (v || '').length >= 6 || 'Password must be at least 6 characters',
  }),
  async (req, res) => {
  const { email, password, name, phone, country, interest, ref } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await ensureUsersTable(conn);
    const [existing] = await conn.execute('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const id = uuidv4();
    const hash = await bcrypt.hash(password, 12);
    await conn.execute(
      'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)',
      [id, email.toLowerCase().trim(), hash, (name || '').trim(), 'user']
    );
    // Referral attribution (best-effort): credit the referrer + tag the new user.
    if (ref) {
      const refCode = String(ref).trim().toUpperCase();
      conn.query('UPDATE referral_codes SET uses = uses + 1 WHERE code = ?', [refCode]).catch(() => {});
      conn.query('UPDATE subscribers SET referred_by = ? WHERE LOWER(TRIM(email)) = ? AND (referred_by IS NULL OR referred_by = "")', [refCode, email.toLowerCase().trim()]).catch(() => {});
    }
    try {
      await conn.execute(
        `INSERT IGNORE INTO registrations (id, uid, name, email, phone, country, interest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [uuidv4(), id, (name || '').trim(), email.toLowerCase().trim(), phone || '', country || '', interest || '']
      );
    } catch { /* ignore */ }
    const [[isStaffEmail]] = await conn.execute(
      'SELECT id FROM staff WHERE LOWER(email) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1',
      [email.toLowerCase().trim()]
    ).catch(() => [[null]]);
    if (isStaffEmail || ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase().trim())) {
      const token = jwt.sign({ uid: id, email: email.toLowerCase().trim(), jti: uuidv4() }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      res.setHeader('Set-Cookie', `authToken=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=None; Secure`);
      return res.json({ ok: true, token, user: { uid: id, email: email.toLowerCase().trim(), displayName: (name || '').trim() } });
    }
    let sharedClientCode = null;
    try { sharedClientCode = await getNextClientCode(conn); } catch { }
    try {
      const normalizedPhone = (phone || '').replace(/\D/g, '');
      const normalizedEmail = email.toLowerCase().trim();
      let existingLeadId = null;
      if (normalizedPhone.length >= 7) {
        const [[byPhone]] = await conn.execute('SELECT id FROM leads WHERE REGEXP_REPLACE(phone, "[^0-9]", "") = ? AND hidden = 0 LIMIT 1', [normalizedPhone]);
        if (byPhone) existingLeadId = byPhone.id;
      }
      if (!existingLeadId) {
        const [[byEmail]] = await conn.execute('SELECT id FROM leads WHERE LOWER(TRIM(email)) = ? AND hidden = 0 LIMIT 1', [normalizedEmail]);
        if (byEmail) existingLeadId = byEmail.id;
      }
      if (existingLeadId) {
        const newName = (name || '').trim();
        await conn.execute('UPDATE leads SET name = IF(LENGTH(?) > 0, ?, name), client_code = IF(client_code IS NULL, ?, client_code) WHERE id = ?', [newName, newName, sharedClientCode, existingLeadId]);
      } else {
        const leadId = `lead-reg-${uuidv4()}`;
        await conn.execute(`INSERT INTO leads (id, client_code, name, email, phone, source, status, hidden, created_at) VALUES (?, ?, ?, ?, ?, 'تسجيل دخول', 'new', 0, NOW())`, [leadId, sharedClientCode, (name || '').trim() || email.split('@')[0], normalizedEmail, phone || '']);
        await logLeadEvent(leadId, 'created', 'تسجيل جديد عبر الموقع', { source: 'تسجيل دخول', phone, status: 'new' }).catch(() => {});
      }
    } catch { }
    const token = jwt.sign({ uid: id, email: email.toLowerCase().trim(), jti: uuidv4() }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.setHeader('Set-Cookie', `authToken=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=None; Secure`);
    res.json({ ok: true, token, user: { uid: id, email: email.toLowerCase().trim(), displayName: (name || '').trim() } });
    if (phone) sendWhatsApp(phone, `أهلاً وسهلاً ${(name || '').trim() || ''}! 🎉\nنرحب بك في معهد مهاد للدراسات النفسية.\nيمكنك الآن الدخول لحسابك واستعراض كورساتنا المتاحة.\nللتواصل أو الاستفسار راسلنا هنا. 💚`).catch(() => {});
  } catch (err) {
    logger.error('[user/signup]', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally { conn.release(); }
});

// POST /api/admin/staff-account — create login account for a staff member (admin only)
// Creates the user in `users` table + inserts/updates `staff` table
router.post('/api/admin/staff-account', requireAuth, requireAdmin,
  validateBody({
    email:    v => isEmail(v)            || 'Email address is invalid',
    password: v => isString(v, 200) && (v || '').length >= 6 || 'Password must be at least 6 characters',
    name:     v => isString(v, 200)      || 'name is required',
  }),
  async (req, res) => {
  const { email, password, name, phone, role, staffId } = req.body || {};
  const conn = await pool.getConnection();
  try {
    // Upsert into users table
    const [existing] = await conn.execute('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    let uid;
    if (existing.length > 0) {
      uid = existing[0].id;
      const hash = await bcrypt.hash(password, 12);
      await conn.execute('UPDATE users SET password_hash=?, name=?, is_active=1 WHERE id=?', [hash, name.trim(), uid]);
    } else {
      uid = uuidv4();
      const hash = await bcrypt.hash(password, 12);
      await conn.execute('INSERT INTO users (id,email,password_hash,name,role,is_active) VALUES (?,?,?,?,?,1)',
        [uid, email.toLowerCase().trim(), hash, name.trim(), 'staff']);
    }
    // Upsert into staff table
    const id = staffId || uuidv4();
    const dbRole = ((role || 'OTHER').toUpperCase());
    await conn.execute(
      `INSERT INTO staff (id,name,email,phone,role,is_active,joined_at) VALUES (?,?,?,?,?,1,NOW())
       ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), role=VALUES(role), is_active=1`,
      [id, name.trim(), email.toLowerCase().trim(), phone||'', dbRole]
    );
    res.json({ ok: true, uid, staffId: id });
  } catch (err) {
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
      'SELECT id, email, name, is_active, role, created_at, (password_hash IS NOT NULL AND password_hash != "") AS has_password FROM users WHERE email = ? LIMIT 1',
      [safeEmail]
    );
    const [[sub]] = await pool.query(
      'SELECT id, name, email FROM subscribers WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [safeEmail]
    );
    const [[otp]] = await pool.query(
      "SELECT code, type, expires_at, used FROM otp_codes WHERE email=? ORDER BY created_at DESC LIMIT 1",
      [safeEmail]
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
router.post('/api/admin/create-account', requireAuth, requireAdminOrOnlineManager, async (req, res) => {
  const { email, name, password, phone, courses, firstPayment } = req.body || {};
  const normEmail = (email || '').toLowerCase().trim();
  if (!normEmail || !normEmail.includes('@')) return res.status(400).json({ error: 'valid email required' });
  const conn = await pool.getConnection();
  try {
    const [[existing]] = await conn.execute('SELECT id, name, is_active FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1', [normEmail]);
    if (existing && existing.is_active) return res.status(409).json({ error: 'حساب فعّال موجود بالفعل بهذا البريد' });

    let tempPass = password && password.trim() ? password.trim() : '';
    if (!tempPass) {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      for (let i = 0; i < 8; i++) tempPass += chars[Math.floor(Math.random() * chars.length)];
    }
    const hash = await bcrypt.hash(tempPass, 12);
    const displayName = (name || existing?.name || normEmail).trim();
    const phoneVal = (phone || '').trim() || null; // NULL not '' so UNIQUE constraint works
    let action = '';

    if (existing) {
      await conn.execute('UPDATE users SET password_hash=?, name=?, is_active=1 WHERE id=?', [hash, displayName, existing.id]);
      if (phoneVal) await conn.execute('UPDATE subscribers SET phone=? WHERE LOWER(TRIM(email))=? AND (phone IS NULL OR phone=\'\') LIMIT 1', [phoneVal, normEmail]);
      // Also save courses for reactivated user
      if (courses && courses.length > 0) {
        const [[reSub]] = await conn.execute('SELECT id, crm_json FROM subscribers WHERE LOWER(TRIM(email))=? LIMIT 1', [normEmail]);
        if (reSub) {
          const validCourses = courses.filter(c => c.courseId && c.courseId.trim());
          if (validCourses.length > 0) {
            // Expand bundle IDs to individual course UUIDs (bundle:xyz → individual course ids)
            const rawCourseIds = validCourses.map(c => c.courseId.trim());
            const enrolledCourseIds = [];
            const courseAccess = {};
            for (const c of validCourses) {
              const cid = c.courseId.trim();
              const mode = c.accessType === 'limited' ? 'limited' : 'full';
              const lim = c.accessType === 'limited' && c.videoCount ? parseInt(c.videoCount) || null : null;
              if (cid.startsWith('bundle:')) {
                const bId = cid.replace('bundle:', '');
                const [bRows] = await conn.execute('SELECT course_id FROM bundle_courses WHERE bundle_id = ?', [bId]).catch(() => [[]]);
                for (const br of bRows) {
                  courseAccess[br.course_id] = { mode, lectureLimit: lim };
                  enrolledCourseIds.push(br.course_id);
                }
                courseAccess[cid] = { mode, lectureLimit: lim }; // keep bundle key for reference
              } else {
                courseAccess[cid] = { mode, lectureLimit: lim };
                enrolledCourseIds.push(cid);
              }
            }
            const existingCrm = reSub.crm_json ? JSON.parse(reSub.crm_json) : {};
            const mergedIds = [...new Set([...(existingCrm.enrolledCourseIds || []), ...enrolledCourseIds])];
            const mergedAccess = { ...(existingCrm.courseAccess || {}), ...courseAccess };
            const newCrm = { ...existingCrm, enrolledCourseIds: mergedIds, courseAccess: mergedAccess };
            await conn.execute('UPDATE subscribers SET crm_json=? WHERE id=?', [JSON.stringify(newCrm), reSub.id]);
            for (const c of validCourses) {
              const cid = c.courseId.trim();
              if (cid.startsWith('bundle:')) continue;
              const mode = c.accessType === 'limited' ? 'limited' : 'full';
              const lim = c.accessType === 'limited' && c.videoCount ? parseInt(c.videoCount) || null : null;
              await conn.execute(
                `INSERT INTO enrollments (id, subscriber_id, course_id, enrolled_at, access_type, lecture_limit)
                 VALUES (UUID(), ?, ?, NOW(), ?, ?)
                 ON DUPLICATE KEY UPDATE access_type=VALUES(access_type), lecture_limit=VALUES(lecture_limit)`,
                [reSub.id, cid, mode, lim]
              ).catch(() => {});
            }
          }
        }
      }
      action = 'reactivated';
    } else {
      const newUserId = uuidv4();
      await conn.execute(
        'INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?,?,?,?,?,1)',
        [newUserId, normEmail, hash, displayName, 'user']
      );
      // Create subscriber record if not exists
      const [[subExists]] = await conn.execute('SELECT id FROM subscribers WHERE LOWER(TRIM(email))=? LIMIT 1', [normEmail]);
      let targetSubId;
      if (!subExists) {
        targetSubId = uuidv4();
        await conn.execute(
          'INSERT INTO subscribers (id, email, name, phone, is_active, created_at, updated_at) VALUES (?,?,?,?,1,NOW(),NOW())',
          [targetSubId, normEmail, displayName, phoneVal]
        );
      } else {
        targetSubId = subExists.id;
        if (phoneVal) await conn.execute('UPDATE subscribers SET phone=? WHERE LOWER(TRIM(email))=? AND (phone IS NULL OR phone=\'\') LIMIT 1', [phoneVal, normEmail]);
      }
      // Save course access: update crm_json + insert into enrollments
      if (courses && courses.length > 0) {
        const validCourses = courses.filter(c => c.courseId && c.courseId.trim());
        if (validCourses.length > 0) {
          // Build enrolledCourseIds and courseAccess for crm_json
          // Expand bundle IDs to individual course UUIDs so isEnrolled works on the client
          const enrolledCourseIds = [];
          const courseAccess = {};
          for (const c of validCourses) {
            const cid = c.courseId.trim();
            const mode = c.accessType === 'limited' ? 'limited' : 'full';
            const lim = c.accessType === 'limited' && c.videoCount ? parseInt(c.videoCount) || null : null;
            if (cid.startsWith('bundle:')) {
              // Bundle — expand to individual course IDs via bundle_courses table
              const bId = cid.replace('bundle:', '');
              const [bRows] = await conn.execute('SELECT course_id FROM bundle_courses WHERE bundle_id = ?', [bId]).catch(() => [[]]);
              for (const br of bRows) {
                courseAccess[br.course_id] = { mode, lectureLimit: lim };
                enrolledCourseIds.push(br.course_id);
              }
              courseAccess[cid] = { mode, lectureLimit: lim }; // keep bundle key for reference
            } else {
              courseAccess[cid] = { mode, lectureLimit: lim };
              enrolledCourseIds.push(cid);
            }
          }
          // Fetch existing crm_json (if subscriber already existed)
          const [[subRow]] = await conn.execute('SELECT crm_json FROM subscribers WHERE id=? LIMIT 1', [targetSubId]);
          const existingCrm = subRow?.crm_json ? JSON.parse(subRow.crm_json) : {};
          const mergedIds = [...new Set([...(existingCrm.enrolledCourseIds || []), ...enrolledCourseIds])];
          const mergedAccess = { ...(existingCrm.courseAccess || {}), ...courseAccess };
          const newCrm = { ...existingCrm, enrolledCourseIds: mergedIds, courseAccess: mergedAccess };
          await conn.execute('UPDATE subscribers SET crm_json=? WHERE id=?', [JSON.stringify(newCrm), targetSubId]);
          // Insert into enrollments table for each plain course (non-bundle)
          for (const c of validCourses) {
            const cid = c.courseId.trim();
            if (cid.startsWith('bundle:')) continue; // bundles handled via crm_json
            const mode = c.accessType === 'limited' ? 'limited' : 'full';
            const lim = c.accessType === 'limited' && c.videoCount ? parseInt(c.videoCount) || null : null;
            await conn.execute(
              `INSERT INTO enrollments (id, subscriber_id, course_id, enrolled_at, access_type, lecture_limit)
               VALUES (UUID(), ?, ?, NOW(), ?, ?)
               ON DUPLICATE KEY UPDATE access_type=VALUES(access_type), lecture_limit=VALUES(lecture_limit)`,
              [targetSubId, cid, mode, lim]
            ).catch(() => {});
          }
        }
      }
      action = 'created';
    }

    // ── Optional first payment — record it against the subscriber (atomic with account) ──
    if (firstPayment && Number(firstPayment.amount) > 0) {
      try {
        const [[paySub]] = await conn.execute('SELECT id FROM subscribers WHERE LOWER(TRIM(email))=? LIMIT 1', [normEmail]);
        if (paySub) {
          await conn.execute(
            `INSERT INTO payments
               (id, subscriber_id, course_id, amount, currency, payment_type, payment_method,
                transaction_id, is_installment, date, note, status, source, staff_id, staff_name)
             VALUES (UUID(), ?, ?, ?, ?, 'COURSE', ?, ?, 0, ?, ?, 'paid', 'staff', ?, ?)`,
            [
              paySub.id,
              (firstPayment.courseId && !String(firstPayment.courseId).startsWith('bundle:')) ? firstPayment.courseId : null,
              Number(firstPayment.amount),
              ['EGP', 'SAR', 'USD'].includes(firstPayment.currency) ? firstPayment.currency : 'EGP',
              firstPayment.paymentMethod || null,
              firstPayment.transactionId || null,
              firstPayment.date || new Date().toISOString().slice(0, 10),
              firstPayment.note || null,
              req.staffRecord?.id || null,
              req.staffRecord?.name || req.user?.email || null,
            ]
          );
        }
      } catch (payErr) {
        logger.warn('[create-account] firstPayment insert failed:', payErr.message);
      }
    }

    // Send welcome email with new password
    try {
      await mailer.sendMail({
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

    res.json({ ok: true, action, email: normEmail, tempPass });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
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
    const [[sub]] = await pool.query('SELECT email FROM subscribers WHERE id = ? LIMIT 1', [id]);
    if (!sub) return res.json({ login_count: 0, last_login: null });
    const [[user]] = await pool.query(
      'SELECT login_count, last_login FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [sub.email.toLowerCase().trim()]
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
       WHERE s.email IS NOT NULL AND s.email != '' AND s.email LIKE '%@%'
       AND NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(TRIM(u.email))=LOWER(TRIM(s.email)) AND u.is_active=1)`
    );
    res.json({ total });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/bulk-create-accounts — create accounts for subscribers without one
router.post('/api/admin/bulk-create-accounts', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.body?.limit) || 50, 200);
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT s.name, s.email FROM subscribers s
       WHERE s.email IS NOT NULL AND s.email != '' AND s.email LIKE '%@%'
       AND NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(TRIM(u.email))=LOWER(TRIM(s.email)) AND u.is_active=1)
       LIMIT ?`, [limit]
    );
    let created = 0, failed = 0, emailsSent = 0;
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    for (const sub of rows) {
      const normEmail = sub.email.toLowerCase().trim();
      try {
        let tempPass = '';
        for (let i = 0; i < 8; i++) tempPass += chars[Math.floor(Math.random() * chars.length)];
        const hash = await bcrypt.hash(tempPass, 12);
        const displayName = (sub.name || normEmail).trim();
        await conn.execute(
          'INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?,?,?,?,?,1)',
          [uuidv4(), normEmail, hash, displayName, 'user']
        );
        created++;
        try {
          await mailer.sendMail({
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
    logger.info(`[bulk-create-accounts] created=${created} failed=${failed} emails=${emailsSent}`);
    res.json({ ok: true, created, failed, emailsSent, total: rows.length });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
  finally { conn.release(); }
});


// POST /api/auth/login
router.post('/api/auth/login', loginLimiter, requireDb,
  validateBody({
    email:    v => isEmail(v)         || 'Email address is invalid',
    password: v => isString(v, 200)   || 'Password is required',
  }),
  async (req, res) => {
  const { email, password } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await ensureUsersTable(conn);
    const [rows] = await conn.execute(
      'SELECT id, email, name, password_hash FROM users WHERE email = ? AND is_active = 1',
      [email.toLowerCase().trim()]);
    if (rows.length === 0) {
      // No users record — check if they exist as a subscriber (admin-added clients)
      // If found, show a helpful error directing them to use forgot-password to set a password
      const [[subExists]] = await conn.execute(
        'SELECT id FROM subscribers WHERE LOWER(TRIM(email)) = ? AND is_active = 1 LIMIT 1',
        [email.toLowerCase().trim()]
      );
      if (subExists) {
        logger.info('[login] subscriber exists but no users record — directing to reset:', email.toLowerCase().trim());
        return res.status(401).json({
          error: 'لم يتم تعيين كلمة مرور لهذا الحساب بعد. يرجى الضغط على "نسيت كلمة المرور" لتعيين كلمة مرور جديدة.',
          needsPasswordReset: true,
        });
      }
      logger.info('[login] no active account for:', email.toLowerCase().trim());
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      logger.info('[login] wrong password for:', email.toLowerCase().trim());
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // ── Admin 2FA: check if this user is a staff member with TOTP enabled ──
    const [[staffWith2FA]] = await pool.query(
      'SELECT id, totp_enabled FROM staff WHERE LOWER(TRIM(email))=? AND totp_enabled=1 LIMIT 1',
      [user.email?.toLowerCase().trim()]
    ).catch(() => [[]]);
    if (staffWith2FA?.totp_enabled) {
      // Issue a short-lived "pending" token — full session not granted until TOTP verified
      const pendingToken = jwt.sign(
        { uid: user.id, email: user.email, purpose: 'totp_pending', jti: uuidv4() },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ ok: false, totpRequired: true, pendingToken });
    }
    const token = jwt.sign({ uid: user.id, email: user.email, jti: uuidv4() }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    // Link subscriber record to this user account (best-effort)
    pool.query(
      `UPDATE subscribers SET firebase_uid = ? WHERE LOWER(TRIM(email)) = ? AND firebase_uid IS NULL LIMIT 1`,
      [user.id, user.email]
    ).catch(() => {});
    // Track login count and last login (best-effort ALTER + UPDATE for new columns)
    pool.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INT DEFAULT 0, ADD COLUMN IF NOT EXISTS last_login DATETIME`
    ).catch(() => {});
    pool.query(
      `UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login = NOW() WHERE id = ?`,
      [user.id]
    ).catch(() => {});
    // NOTE: Do NOT auto-create a subscriber record on login.
    // Only real paid subscribers (created by admin staff) should appear in the subscribers table.
    // Unenrolled users will see the "حسابك قيد المراجعة" screen after login — this is intentional.
    // Set httpOnly cookie (secure, 7-day expiry) + return token in body for backward compat
    const cookieOpts = 'HttpOnly; Path=/; Max-Age=604800; SameSite=None; Secure';
    res.setHeader('Set-Cookie', `authToken=${token}; ${cookieOpts}`);
    res.json({ ok: true, token, user: { uid: user.id, email: user.email, displayName: user.name || '' } });
  } catch (err) {
    logger.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  } finally { conn.release(); }
});

// POST /api/auth/logout — invalidate token immediately (client must clear storage too)
router.post('/api/auth/logout', requireAuth, async (req, res) => {
  const { jti } = req.user || {};
  if (jti) await revokeToken(jti, Date.now() + 30 * 24 * 60 * 60 * 1000); // expire after 30d max
  // Clear httpOnly cookie
  res.setHeader('Set-Cookie', 'authToken=; HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure');
  res.json({ ok: true });
});

// Roles that grant full admin-level access in the frontend
const FULL_ACCESS_ROLES_AUTH = ['manager', 'admin', 'daqqi_manager', 'online_manager'];

// GET /api/auth/me
router.get('/api/auth/me', requireAuth, requireDb, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT id, email, name FROM users WHERE id = ?', [req.user.uid]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    let isAdmin = ADMIN_EMAILS.includes(u.email) || ADMIN_UIDS.includes(u.id);
    if (!isAdmin) {
      // Also grant admin access to staff with full-access roles (manager, admin, daqqi_manager, online_manager)
      const [[staff]] = await conn.execute(
        `SELECT role FROM staff WHERE LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1`,
        [u.email.toLowerCase().trim()]
      );
      if (staff && FULL_ACCESS_ROLES_AUTH.includes(staff.role)) isAdmin = true;
    }
    // Surface the user's phone (users table has none) — prefer subscriber, then most recent lead.
    let phone = '';
    try {
      const em = (u.email || '').toLowerCase().trim();
      const [[subRow]] = await conn.execute(
        "SELECT phone FROM subscribers WHERE LOWER(TRIM(email))=? AND phone IS NOT NULL AND phone<>'' LIMIT 1", [em]
      );
      phone = subRow?.phone || '';
      if (!phone) {
        const [[leadRow]] = await conn.execute(
          "SELECT phone FROM leads WHERE LOWER(TRIM(email))=? AND phone IS NOT NULL AND phone<>'' ORDER BY created_at DESC LIMIT 1", [em]
        );
        phone = leadRow?.phone || '';
      }
    } catch { /* phone is best-effort */ }
    res.json({ uid: u.id, email: u.email, displayName: u.name || '', phone, isAdmin });
  } catch (err) {
    logger.error('[auth/me]', err);
    res.status(500).json({ error: 'Server error' });
  } finally { conn.release(); }
});

// ── Forgot Password + OTP + 2FA ───────────────────────────────────────────────
// POST /api/auth/forgot-password — send 6-digit OTP via email
router.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });
  const safeEmail = email.toLowerCase().trim();
  try {
    let user = null;

    // 1. Check users table (primary auth table — registered via website)
    const [[existingUser]] = await pool.query('SELECT id, name FROM users WHERE email = ? AND is_active = 1 LIMIT 1', [safeEmail]);
    if (existingUser) {
      user = existingUser;
    } else {
      // 2. Fallback: check subscribers table — admin-added clients don't have a users record
      const [[sub]] = await pool.query('SELECT id, name, email FROM subscribers WHERE LOWER(TRIM(email)) = ? AND is_active = 1 LIMIT 1', [safeEmail]);
      if (sub) {
        // Auto-create a users record so they can authenticate going forward
        // Use a locked (un-guessable) password hash — they MUST reset via OTP
        const tempHash = await bcrypt.hash(uuidv4() + Date.now(), 10); // random unhittable hash
        const newUserId = uuidv4();
        await pool.query(
          'INSERT IGNORE INTO users (id, email, password_hash, name, role, is_active) VALUES (?,?,?,?,?,1)',
          [newUserId, safeEmail, tempHash, sub.name || safeEmail.split('@')[0], 'user']
        );
        // Fetch back the inserted (or pre-existing race-condition) record
        const [[createdUser]] = await pool.query('SELECT id, name FROM users WHERE email = ? LIMIT 1', [safeEmail]);
        if (createdUser) {
          user = createdUser;
          logger.info('[forgot-password] auto-created users record for subscriber:', safeEmail);
        }
      }
    }

    // Always return success to prevent user enumeration
    if (!user) {
      logger.info('[forgot-password] no active account found for:', safeEmail);
      return res.json({ ok: true });
    }

    // Expire previous unused OTPs for this email
    await pool.query("UPDATE otp_codes SET used=1 WHERE email=? AND type='password_reset' AND used=0", [safeEmail]).catch(() => {});
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await pool.query(
      `INSERT INTO otp_codes (id, user_id, email, code, type, expires_at) VALUES (?,?,?,?,?,?)`,
      [uuidv4(), user.id, safeEmail, otp, 'password_reset', expiresAt]
    );
    try {
      await sendEmail(safeEmail, 'رمز إعادة تعيين كلمة المرور',
        `<p>أهلاً ${user.name || ''}،</p>
         <p>تلقّينا طلب إعادة تعيين كلمة المرور لحسابك.</p>
         <div class="otp-box">${otp}</div>
         <p style="color:#888;font-size:13px;text-align:center;">صالح لمدة 15 دقيقة فقط. إذا لم تطلب ذلك، تجاهل هذا البريد.</p>`
      );
      logger.info('[forgot-password] OTP sent to:', safeEmail);
      res.json({ ok: true });
    } catch (mailErr) {
      logger.error('[forgot-password] SMTP error for', safeEmail, ':', mailErr.message);
      // Invalidate the OTP we just created since email didn't go out
      await pool.query("UPDATE otp_codes SET used=1 WHERE email=? AND type='password_reset' AND used=0", [safeEmail]).catch(() => {});
      res.status(422).json({ error: 'فشل إرسال البريد الإلكتروني — تحقق من البريد الصحيح أو تواصل مع الدعم' });
    }
  } catch (e) { logger.error('[forgot-password]', e); res.status(500).json({ error: 'فشل الإرسال' }); }
});

// POST /api/auth/verify-otp — verify OTP and return a short-lived reset token
router.post('/api/auth/verify-otp', otpLimiter, async (req, res) => {
  const { email, code, type = 'password_reset' } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'البريد والرمز مطلوبان' });
  const safeEmail = email.toLowerCase().trim();
  try {
    const [[row]] = await pool.query(
      `SELECT id, user_id FROM otp_codes WHERE email=? AND code=? AND type=? AND used=0 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`,
      [safeEmail, String(code).trim(), type]
    );
    if (!row) return res.status(400).json({ error: 'الرمز غير صحيح أو منتهي الصلاحية' });
    await pool.query('UPDATE otp_codes SET used=1 WHERE id=?', [row.id]);
    // Issue a short-lived reset token (5 min)
    const resetToken = jwt.sign({ uid: row.user_id, purpose: 'reset', jti: uuidv4() }, JWT_SECRET, { expiresIn: '5m' });
    res.json({ ok: true, resetToken });
  } catch (e) { res.status(500).json({ error: 'فشل التحقق' }); }
});

// POST /api/auth/reset-password — set new password using reset token
router.post('/api/auth/reset-password', loginLimiter, async (req, res) => {
  const { resetToken, newPassword } = req.body || {};
  if (!resetToken || !newPassword) return res.status(400).json({ error: 'البيانات مطلوبة' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  try {
    const payload = jwt.verify(resetToken, JWT_SECRET);
    if (payload.purpose !== 'reset') return res.status(400).json({ error: 'رمز غير صالح' });
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash=? WHERE id=?', [hash, payload.uid]);
    res.json({ ok: true });
  } catch { res.status(400).json({ error: 'انتهت صلاحية الرمز' }); }
});

// POST /api/auth/verify-2fa — verify admin 2FA OTP and issue full JWT
router.post('/api/auth/verify-2fa', otpLimiter, async (req, res) => {
  const { tempToken, code } = req.body || {};
  if (!tempToken || !code) return res.status(400).json({ error: 'البيانات مطلوبة' });
  try {
    const payload = jwt.verify(tempToken, JWT_SECRET);
    if (payload.purpose !== '2fa_pending') return res.status(400).json({ error: 'رمز غير صالح' });
    const [[row]] = await pool.query(
      `SELECT id FROM otp_codes WHERE email=? AND code=? AND type='2fa' AND used=0 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`,
      [payload.email, String(code).trim()]
    );
    if (!row) return res.status(400).json({ error: 'الرمز غير صحيح أو منتهي الصلاحية' });
    await pool.query('UPDATE otp_codes SET used=1 WHERE id=?', [row.id]);
    // Issue full JWT
    const token = jwt.sign({ uid: payload.uid, email: payload.email, jti: uuidv4() }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    pool.query(`UPDATE subscribers SET firebase_uid=? WHERE LOWER(TRIM(email))=? AND firebase_uid IS NULL LIMIT 1`, [payload.uid, payload.email]).catch(() => {});
    const cookieOpts = 'HttpOnly; Path=/; Max-Age=604800; SameSite=None; Secure';
    res.setHeader('Set-Cookie', `authToken=${token}; ${cookieOpts}`);
    const [[user]] = await pool.query('SELECT name FROM subscribers WHERE firebase_uid = ? LIMIT 1', [payload.uid]).catch(() => [[null]]);
    res.json({ ok: true, token, user: { uid: payload.uid, email: payload.email, displayName: user?.name || '' } });
  } catch { res.status(400).json({ error: 'انتهت صلاحية الجلسة، أعد تسجيل الدخول' }); }
});

// PUT /api/auth/update-profile
router.put('/api/auth/update-profile', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const conn = await pool.getConnection();
  try {
    const trimmedName = (name || '').trim();
    // Update auth user record
    await conn.execute('UPDATE users SET name = ? WHERE id = ?', [trimmedName, req.user.uid]);
    // Sync name to subscribers table so CRM stays consistent
    await conn.execute(
      'UPDATE subscribers SET name = ? WHERE email = ?',
      [trimmedName, req.user.email]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error('[auth/update-profile]', err);
    res.status(500).json({ error: 'Update failed' });
  } finally { conn.release(); }
});

// PUT /api/auth/update-password
router.put('/api/auth/update-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT password_hash FROM users WHERE id = ?', [req.user.uid]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await conn.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.uid]);
    res.json({ ok: true });
  } catch (err) {
    logger.error('[auth/update-password]', err);
    res.status(500).json({ error: 'Update failed' });
  } finally { conn.release(); }
});

// POST /api/admin/force-reset-password (admin-only direct password reset by email)
router.post('/api/admin/force-reset-password', requireAuth, requireAdmin, async (req, res) => {
  const { email, newPassword } = req.body || {};
  if (!email || !newPassword) return res.status(400).json({ error: 'Email and new password required' });
  const conn = await pool.getConnection();
  try {
    const hash = await bcrypt.hash(newPassword, 12);
    const [result] = await conn.execute('UPDATE users SET password_hash = ? WHERE email = ?', [hash, email.toLowerCase().trim()]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
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
    if (newPassword && newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    // Validate new email not already taken by another user
    if (newEmail && newEmail.toLowerCase().trim() !== currentEmail.toLowerCase().trim()) {
      const [[existing]] = await conn.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [newEmail.toLowerCase().trim()]);
      if (existing) return res.status(409).json({ error: `البريد الإلكتروني ${newEmail} مسجل بالفعل لمستخدم آخر` });
    }
    // Build dynamic UPDATE for users table
    const sets = [];
    const params = [];
    if (newEmail) { sets.push('email = ?'); params.push(newEmail.toLowerCase().trim()); }
    if (newPassword) { sets.push('password_hash = ?'); params.push(await bcrypt.hash(newPassword, 12)); }
    params.push(currentEmail.toLowerCase().trim());
    const [result] = await conn.execute(`UPDATE users SET ${sets.join(', ')} WHERE email = ?`, params);
    if (result.affectedRows === 0) {
      // No user account yet — create one using the subscriber's data
      if (!newPassword) return res.status(404).json({ error: 'لم يُعثر على حساب بهذا البريد. يرجى تعيين كلمة مرور لإنشاء الحساب.' });
      const [[sub]] = await conn.execute('SELECT id, name, email FROM subscribers WHERE id = ?', [id]);
      if (!sub) return res.status(404).json({ error: 'لم يُعثر على المشترك.' });
      const finalEmail = (newEmail || sub.email).toLowerCase().trim();
      await conn.execute(
        'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)',
        [sub.id, finalEmail, await bcrypt.hash(newPassword, 12), sub.name || '', 'client']
      );
      if (finalEmail !== sub.email.toLowerCase().trim()) {
        await conn.execute('UPDATE subscribers SET email = ? WHERE id = ?', [finalEmail, id]);
      }
    } else if (newEmail) {
      // If email changed, sync subscribers table too
      await conn.execute('UPDATE subscribers SET email = ? WHERE id = ?', [newEmail.toLowerCase().trim(), id]);
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error('[admin/subscribers/credentials]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// NOTE: duplicate POST /api/auth/forgot-password (temp-password flow) removed.
// The OTP-based flow above (loginLimiter, sends OTP code) is the correct active handler.

// POST /api/auth/refresh  — issues a new 7-day token; revokes the old jti
router.post('/api/auth/refresh', requireAuth, async (req, res) => {
  try {
    const { jti: oldJti } = req.user || {};
    if (oldJti) revokeToken(oldJti, Date.now() + 7 * 24 * 60 * 60 * 1000);
    const token = jwt.sign(
      { uid: req.user.uid, email: req.user.email, jti: uuidv4() },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );
    res.setHeader('Set-Cookie', `authToken=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=None; Secure`);
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
      'SELECT totp_enabled FROM staff WHERE LOWER(TRIM(email))=? LIMIT 1',
      [req.user.email?.toLowerCase().trim()]
    );
    res.json({ enabled: !!row?.totp_enabled });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/auth/2fa/setup — generate TOTP secret + QR code for current staff
router.post('/api/auth/2fa/setup', requireAuth, async (req, res) => {
  try {
    const { authenticator } = require('otplib');
    const QRCode = require('qrcode');
    const email = req.user.email?.toLowerCase().trim();
    const [[staff]] = await pool.query('SELECT id, name FROM staff WHERE LOWER(TRIM(email))=? LIMIT 1', [email]);
    if (!staff) return res.status(403).json({ error: 'Staff account not found' });

    const secret = authenticator.generateSecret();
    const issuer = 'مهاد نفسي';
    const otpAuthUrl = authenticator.keyuri(email, issuer, secret);
    const qrDataUrl = await QRCode.toDataURL(otpAuthUrl);

    // Store secret but don't enable yet — only enable after first successful verify
    await pool.query('UPDATE staff SET totp_secret=?, totp_enabled=0 WHERE id=?', [secret, staff.id]);
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
    const { authenticator } = require('otplib');
    const email = req.user.email?.toLowerCase().trim();
    const [[staff]] = await pool.query('SELECT id, totp_secret FROM staff WHERE LOWER(TRIM(email))=? LIMIT 1', [email]);
    if (!staff?.totp_secret) return res.status(400).json({ error: 'Setup not initiated — call /2fa/setup first' });

    const valid = authenticator.verify({ token: String(totpToken), secret: staff.totp_secret });
    if (!valid) return res.status(400).json({ error: 'الرمز غير صحيح — تحقق من الوقت على جهازك' });

    await pool.query('UPDATE staff SET totp_enabled=1 WHERE id=?', [staff.id]);
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
    const [[staff]] = await pool.query('SELECT id, totp_secret, totp_enabled FROM staff WHERE LOWER(TRIM(email))=? LIMIT 1', [email]);
    if (!staff) return res.status(403).json({ error: 'Staff account not found' });

    // Must provide valid TOTP to disable (unless admin override)
    const isAdmin = ADMIN_EMAILS.includes(req.user.email);
    if (!isAdmin && staff.totp_enabled) {
      if (!totpToken) return res.status(400).json({ error: 'TOTP token required to disable 2FA' });
      const { authenticator } = require('otplib');
      const valid = authenticator.verify({ token: String(totpToken), secret: staff.totp_secret });
      if (!valid) return res.status(400).json({ error: 'الرمز غير صحيح' });
    }
    await pool.query('UPDATE staff SET totp_enabled=0, totp_secret=NULL WHERE id=?', [staff.id]);
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
    const { authenticator } = require('otplib');

    // Decode the pending token (limited JWT issued before TOTP check)
    let payload;
    try {
      payload = jwt.verify(pendingToken, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ error: 'رمز انتهت صلاحيته — أعد تسجيل الدخول' });
    }
    if (payload.purpose !== 'totp_pending') return res.status(400).json({ error: 'رمز غير صالح' });

    const [[staff]] = await pool.query(
      'SELECT id, totp_secret FROM staff WHERE LOWER(TRIM(email))=? AND totp_enabled=1 LIMIT 1',
      [payload.email?.toLowerCase().trim()]
    );
    if (!staff?.totp_secret) return res.status(400).json({ error: 'TOTP not configured' });

    const valid = authenticator.verify({ token: String(totpToken), secret: staff.totp_secret });
    if (!valid) return res.status(401).json({ error: 'رمز المصادقة غير صحيح' });

    // Issue full JWT
    const fullToken = jwt.sign(
      { uid: payload.uid, email: payload.email, jti: uuidv4() },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );
    const cookieOpts = 'HttpOnly; Path=/; Max-Age=604800; SameSite=None; Secure';
    res.setHeader('Set-Cookie', `authToken=${fullToken}; ${cookieOpts}`);
    res.json({ ok: true, token: fullToken });
  } catch (e) {
    logger.error('[2fa/verify]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
