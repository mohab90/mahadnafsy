'use strict';
// Accounts made by staff: staff logins, client accounts, bulk creation.
// One part of routes/auth.js, which puts the parts back together in order.
const { signerName } = require('../../lib/staffNames');
const { Router } = require('express');
const {
  logger,
  bcrypt,
  uuidv4,
  assertGrantable,
  heldByTarget,
  generateTemporaryPassword,
  pool,
  queuePaymentReceipt,
  resolveCatalogPrice,
  setAgreedPrice,
  mailer,
  sendWhatsApp,
  branchIdForBranch,
  grantCourseSelections,
  ADMIN_EMAILS,
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  requireAdminOrOnlineManager,
  requireAdminOrStaff,
  requirePermission,
  invalidateIdentity,
  bulkOperationLimiter,
  isString,
  isEmail,
  validateBody,
  postPaymentJournal,
  logPaymentAudit,
  assertWritable,
  hasPermission,
  requireTenantQuota,
  recordPaymentCompensation,
  claimWhatsAppIdentity,
  isRealPhone,
  identitySpellings,
  cairoToday,
} = require('./_shared');

const router = Router();

// POST /api/admin/staff-account — create login account for a staff member (admin only)
// Creates the user in `users` table + inserts/updates `staff` table
router.post('/api/admin/staff-account', requireAuth, requireAdminOrStaff, requirePermission('manage_staff'), requireTenantQuota('staff'),
  validateBody({
    email:    v => isEmail(v)            || 'Email address is invalid',
    password: v => isString(v, 200) && (v || '').length >= 8 || 'Password must be at least 8 characters',
    name:     v => isString(v, 200)      || 'name is required',
  }),
  async (req, res) => {
  const { email, password, name, phone, role, staffId } = req.body || {};

  // The same guard POST /api/admin/staff carries: manage_staff is the right to
  // onboard staff, not the right to create an account that can take the tenant
  // over. Checked before any connection is taken.
  const requestedRole = String(role || 'other').toUpperCase();
  if (!req.isSuperAdmin && ['ADMIN', 'MANAGER'].includes(requestedRole)) {
    return res.status(403).json({
      error: 'إنشاء حساب دخول بصلاحية مدير أو أدمن يحتاج صلاحية المالك',
      code: 'OWNER_REQUIRED_FOR_PRIVILEGED_ROLE',
    });
  }

  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const tenantId = req.tenantId;
    const normalizedEmail = email.toLowerCase().trim();
    await conn.beginTransaction();
    transactionStarted = true;
    // Refusals happen before anything is written. Each returns through the
    // finally below, which releases the connection — once.
    const refuse = async (status, body) => {
      await conn.rollback();
      transactionStarted = false;
      return res.status(status).json(body);
    };

    const [existing] = await conn.execute('SELECT id FROM users WHERE tenant_id=? AND email = ? FOR UPDATE', [tenantId, normalizedEmail]);

    // This route resets the password of whatever login already holds the
    // address. For the owner and the managers that is their account: an owner
    // is recognised by email, so a new password here is a new owner — and no
    // owner or manager on this system has MFA to stand in the way. The role
    // guard above only stopped *creating* an admin; it never looked at whose
    // account the email already opened.
    const [[staffByEmail]] = await conn.execute(
      'SELECT id, role, branch_id FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? AND deleted_at IS NULL LIMIT 1',
      [tenantId, normalizedEmail]);
    if (!req.isSuperAdmin) {
      const ownerEmail = ADMIN_EMAILS.some(e => String(e).toLowerCase() === normalizedEmail);
      const privilegedStaff = staffByEmail && ['admin', 'manager'].includes(String(staffByEmail.role || '').toLowerCase());
      if (ownerEmail || privilegedStaff) {
        return refuse(403, {
          error: 'تعديل دخول حساب مالك أو مدير يحتاج صلاحية المالك',
          code: 'OWNER_REQUIRED_FOR_PRIVILEGED_ACCOUNT',
        });
      }
      // A login with no staff record is a customer. Turning it into staff and
      // resetting its password is taking over somebody's student account.
      if (existing.length > 0 && !staffByEmail) {
        return refuse(403, {
          error: 'هذا البريد مسجّل لحساب عميل — تحويله لحساب موظف يحتاج صلاحية المالك',
          code: 'CUSTOMER_ACCOUNT_REQUIRES_OWNER',
        });
      }
    }

    // The staff row being upserted, when the caller names one. It has to be
    // this tenant's, and a non-owner may neither overwrite a manager's row nor
    // re-point somebody else's row at a different login.
    let existingStaff = null;
    if (staffId) {
      const [[row]] = await conn.execute(
        'SELECT id, tenant_id, role, email, permissions_json FROM staff WHERE id=? LIMIT 1', [staffId]);
      if (row && row.tenant_id !== tenantId) {
        return refuse(403, { error: 'Staff id belongs to another tenant', code: 'STAFF_TENANT_MISMATCH' });
      }
      if (row && !req.isSuperAdmin) {
        if (['admin', 'manager'].includes(String(row.role || '').toLowerCase())) {
          return refuse(403, {
            error: 'تعديل حساب مدير يحتاج صلاحية المالك',
            code: 'OWNER_REQUIRED_FOR_PRIVILEGED_ACCOUNT',
          });
        }
        const rowEmail = String(row.email || '').trim().toLowerCase();
        if (rowEmail && rowEmail !== normalizedEmail) {
          return refuse(409, {
            error: 'بريد الموظف مختلف عن البريد المُرسل — عدّل بريده من ملفه أولاً',
            code: 'STAFF_EMAIL_MISMATCH',
          });
        }
      }
      existingStaff = row || null;
    }

    // The role guard above stops manage_staff minting an ADMIN. Permissions
    // are the other axis and used to be copied into the INSERT unread, so the
    // same right also minted an account holding anything in the system — with
    // a password the creator picked. What the employee already holds, and what
    // the chosen role brings anyway, are not new grants.
    const grant = assertGrantable(req, req.body, {
      alreadyHeld: heldByTarget({ existingStaff, role: String(role || 'other').toLowerCase(), tenantId }),
    });
    if (!grant.ok) return refuse(grant.status, grant.body);
    const permissionsJson = grant.permissionsJson;

    // Upsert into users table
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
        [uid, tenantId, normalizedEmail, hash, name.trim(), 'staff']);
    }
    // Upsert into staff table.
    //
    // The branch is kept, not re-decided. This statement's ON DUPLICATE clause
    // rewrites branch_id, and the request that reaches it from the staff page's
    // "create a login" button carries no branch at all — the object it posts has
    // no branch field, and the two onboarding screens that do send one spell it
    // branch_id. So creating a login for an employee at Dokki moved them to
    // branch-other, which is a silent way to drop somebody out of every
    // branch-wide message. Both spellings are accepted; the row's own branch is
    // the fallback, and branch-other only names a row that never had one.
    const id = staffId || uuidv4();
    const branchId = req.body.branch_id ?? req.body.branchId ?? staffByEmail?.branch_id ?? 'branch-other';
    const dbRole = ((role || 'OTHER').toUpperCase());
    const joinedAt = String(req.body.joinedAt || req.body.joined_at || new Date().toISOString()).slice(0, 19).replace('T', ' ');
    const numberOrNull = value => value === undefined || value === null || value === '' ? null : Number(value);
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
        id, tenantId, branchId, uid, name.trim(),
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
    // No money against a client who cannot be reached (lib/phoneNumber isRealPhone).
    if (!isRealPhone(phone)) {
      return res.status(400).json({
        error: 'لازم يكون للعميل رقم تليفون حقيقي قبل تسجيل أي دفعة — موبايل مصري أو رقم بكود الدولة.',
        code: 'PHONE_REQUIRED',
      });
    }
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
    // A staff address cannot be given a login here.
    //
    // /api/auth/register and /api/user/signup have refused this since the
    // identity work; this route was written without it, and it is reachable by
    // an online manager — a role requireSuperAdmin deliberately excludes so it
    // cannot escalate. Six staff rows on production are active with no login
    // row of their own, among them a MANAGER, and every privileged check
    // resolves staff BY EMAIL ALONE. So: read the staff list (online managers
    // hold view_staff), create an account on a manager's address with a chosen
    // password, sign in, and findActiveStaff hands back that manager's row and
    // with it isSuperAdmin. Full takeover, no MFA in the way — the policy is
    // off by default and does not cover this role in any case.
    const [[protectedStaff]] = await conn.execute(
      'SELECT id FROM staff WHERE tenant_id=? AND LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1',
      [tenantId, normEmail]
    );
    if (protectedStaff || ADMIN_EMAILS.some(e => e.toLowerCase() === normEmail)) {
      return res.status(403).json({
        error: 'لا يمكن إنشاء حساب على بريد موظف — استخدم شاشة حسابات الموظفين',
        code: 'STAFF_INVITATION_REQUIRED',
      });
    }
    const [[existing]] = await conn.execute('SELECT id, name, is_active FROM users WHERE tenant_id=? AND LOWER(TRIM(email)) = ? LIMIT 1', [tenantId, normEmail]);
    if (existing && existing.is_active) return res.status(409).json({ error: 'حساب فعّال موجود بالفعل بهذا البريد' });

    const tempPass = password && password.trim() ? password.trim() : generateTemporaryPassword();
    if (tempPass.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(tempPass, 12);
    const displayName = (name || existing?.name || normEmail).trim();
    const phoneVal = (phone || '').trim() || null; // NULL not '' so UNIQUE constraint works
    let action = '';
    let firstPaymentStatus = null;
    let firstPaymentId = null;
    let createdSubscriberId = null;
    // The client's record the courses and the first payment go on.
    let targetSubId = null;
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
      // The client's record: by the address, else by the number, else a new one.
      // Found by address alone, a login whose record carried another address
      // (or none) took no courses, and its first payment failed the whole
      // request with «Payment subscriber not found» — five times on 5 Oct.
      let [[reSub]] = await conn.execute('SELECT id, branch_id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [tenantId, normEmail]);
      if (!reSub && phoneVal) {
        [[reSub]] = await conn.query(
          'SELECT id, branch_id FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND phone IN (?) LIMIT 1',
          [tenantId, [...new Set([phoneVal, ...identitySpellings(phoneVal)])]]);
      }
      if (!reSub) {
        reSub = { id: uuidv4(), branch_id: branchIdForBranch(defaultBranch) };
        await conn.execute(
          `INSERT INTO subscribers
             (id, tenant_id, email, name, phone, branch, branch_id, is_active, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,1,NOW(),NOW())`,
          [reSub.id, tenantId, normEmail, displayName, phoneVal, defaultBranch, reSub.branch_id]
        );
        createdSubscriberId = reSub.id;
      }
      targetSubId = reSub.id;
      // Also save courses for reactivated user
      if (courses && courses.length > 0) {
        const validCourses = courses.filter(c => c.courseId && c.courseId.trim());
        if (validCourses.length > 0) {
          await grantCourseSelections({
            tenantId, subscriberId: reSub.id, selections: validCourses,
            branchId: reSub.branch_id, source: 'account_reactivation',
            actor: req.user?.email || 'admin',
          }, conn);
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
        'SELECT id, tenant_id, branch, branch_id FROM subscribers WHERE tenant_id=? AND id=? LIMIT 1',
        [tenantId, targetSubId]
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
      const paymentDate = firstPayment.date || cairoToday();
      const courseExpected = firstPayment.courseExpected === undefined || firstPayment.courseExpected === null
        ? null : Number(firstPayment.courseExpected);
      const currency = ['EGP', 'SAR', 'USD'].includes(firstPayment.currency) ? firstPayment.currency : 'EGP';
      const paymentBranch = paySub.branch || defaultBranch;
      const paymentBranchId = paySub.branch_id || branchIdForBranch(paymentBranch);
      const canApproveFinancial = !!req.isSuperAdmin || hasPermission(req.staffRecord, 'manage_financial');
      firstPaymentStatus = canApproveFinancial ? 'paid' : 'pending';
      firstPaymentId = paymentId;
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
         signerName(req), tenantId, paymentBranch, paymentBranchId, courseExpected]
      );
      if (firstPaymentStatus === 'paid') {
        const journalId = await postPaymentJournal({
          paymentId, amount, currency, payType: 'COURSE',
          date: paymentDate, actor: req.user?.email || 'create-account', tenantId,
        }, conn);
        if (!journalId) throw new Error('First payment journal posting failed');
        // Commission and the instructor's share, as every other approved payment
        // records them; one left pending gets them when it is approved
        // (core/financepay.js). This one, approved here, got neither.
        await recordPaymentCompensation({
          paymentId, tenantId, actor: req.user?.email || 'create-account',
        }, conn);
      }
      // Logged whether it was approved or left pending: who took the money and
      // which of the two states it landed in is precisely what someone asks
      // later, and a pending row that nobody can trace is the worse of the two.
      await logPaymentAudit(paymentId, 'create', null, firstPaymentStatus, amount, paySub.id,
        req.user?.email || req.staffRecord?.name || 'create-account', tenantId, conn, true);
    }

    const [[responseSubscriber]] = await conn.execute(
      'SELECT id FROM subscribers WHERE tenant_id=? AND id=? LIMIT 1',
      [tenantId, targetSubId]
    );

    // Each course's own price, as the desk set it on this screen — a price, or
    // a discount off the catalogue. Only the first course's typed price ever
    // reached the payment, and a discount reached nothing, so the client's
    // total read list price from the first screen they appeared on.
    if (responseSubscriber && Array.isArray(courses)) {
      const priceCurrency = ['EGP', 'SAR', 'USD'].includes(firstPayment?.currency) ? firstPayment.currency : 'EGP';
      for (const course of courses) {
        const item = String(course?.courseId || '').trim();
        if (!item) continue;
        const bundleId = item.startsWith('bundle:') ? item.slice(7) : null;
        const courseId = bundleId ? null : item;
        const custom = Number(course.customPrice) || 0;
        const discount = Number(course.discount) || 0;
        let price = custom > 0 ? custom : null;
        if (!price && discount > 0 && discount < 100) {
          const catalogue = await resolveCatalogPrice(conn, {
            type: bundleId ? 'bundle' : 'course', itemId: bundleId || courseId, currency: priceCurrency, tenantId,
          }).catch(() => null);
          if (catalogue) price = Math.round(catalogue * (1 - discount / 100));
        }
        if (price) await setAgreedPrice(conn, { tenantId, subscriberId: responseSubscriber.id, courseId, bundleId, price });
      }
    }
    if (!responseSubscriber) throw new Error('Subscriber account projection was not created');
    createdSubscriberId = responseSubscriber.id;
    await conn.commit();
    if (existing) invalidateIdentity(tenantId, existing.id, normEmail);
    if (firstPaymentId) queuePaymentReceipt(tenantId, firstPaymentId);

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
    if (!sub || !sub.email) return res.json({ login_count: 0, last_login: null });
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
            { tenantId: req.tenantId, category: 'welcome' }
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

module.exports = router;
