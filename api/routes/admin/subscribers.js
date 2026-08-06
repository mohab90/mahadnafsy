'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const bcrypt   = require('../../lib/passwordHash');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');
const { generateTemporaryPassword } = require('../../lib/secureCredentials');

const { pool, autoAssignStaff, cacheInvalidate } = require('../../lib/db');
const { mailer } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, parseCrm, calcLeadScoreServer } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logLeadEvent } = require('../../lib/crm');
const { transitionLead } = require('../../lib/leadState');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { getTenantSetting } = require('../../lib/tenantSettings');
const {
  ADMIN_EMAILS, requireAuth, requireAdmin, requireAdminOrStaff, requirePermission, invalidateIdentity,
} = require('../../middleware/auth');
const { DATA_SCOPE, VALID_BRANCHES, FULL_ACCESS_ROLES, hasPermission } = require('../../constants/permissions');
const { safeIsoString, safeDateOnly } = require('../../lib/dates');
const { keyset } = require('../../lib/pagination');
const { branchIdForBranch } = require('../../lib/branches');
const { syncCourseEntitlements } = require('../../lib/entitlements');
const { listCustomerTimeline } = require('../../lib/customerTimeline');
function sendRouteError(res, err) {
  if (res.headersSent) return;
  const dbCodes = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_SERVER_LOST']);
  const status = err && dbCodes.has(err.code) ? 503 : 500;
  res.status(status).json({ error: status === 503 ? 'Database unavailable' : 'Internal server error' });
}

function subscriberTimelineScope(req, alias = 's') {
  const role = String(req.staffRecord?.role || '').toLowerCase();
  if (req.isSuperAdmin || ['admin', 'manager', 'online_manager', 'daqqi_manager'].includes(role)) {
    return { sql: '', params: [] };
  }
  if (role === 'reception_daqqi') return { sql: ` AND ${alias}.branch='DAQQI'`, params: [] };
  return {
    sql: ` AND (${alias}.assigned_sales_id=? OR ${alias}.assigned_cs_id=? OR EXISTS (
      SELECT 1 FROM leads l WHERE l.id=${alias}.lead_id AND l.tenant_id=${alias}.tenant_id
        AND (l.assigned_sales_id=? OR l.assigned_cs_id=?)
    ))`,
    params: Array(4).fill(req.staffRecord?.id || ''),
  };
}

router.get('/api/staff/subscribers/:id/timeline',
  requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'),
  async (req, res) => {
    try {
      const scope = subscriberTimelineScope(req);
      const [[subscriber]] = await pool.query(
        `SELECT s.id FROM subscribers s
          WHERE s.id=? AND s.tenant_id=? AND s.deleted_at IS NULL${scope.sql} LIMIT 1`,
        [req.params.id, req.tenantId, ...scope.params]
      );
      if (!subscriber) return res.status(404).json({ error: 'Subscriber not found' });
      const timeline = await listCustomerTimeline(req.tenantId, subscriber.id);
      const canSeeMoney = req.isSuperAdmin || hasPermission(req.staffRecord, 'view_financial');
      res.json(canSeeMoney ? timeline : timeline.map(({ amount: _amount, currency: _currency, ...event }) => event));
    } catch (error) {
      logger.error('[staff-subscriber-timeline]', error.message);
      sendRouteError(res, error);
    }
  }
);


router.get('/api/staff/client/:code', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const code = req.params.code;
    const isAdminReq = !!req.isSuperAdmin || String(req.staffRecord?.role || '').toUpperCase() === 'ADMIN';
    const staffId = req.staffRecord?.id;

    // ── 1. Try subscriber (by id or client_code) ────────────────────────────
    const [subRows] = await pool.query(
       `SELECT id, firebase_uid, client_code, lead_id, name, email, phone, branch,
       is_active, notes, client_type, assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name,
       crm_json, created_at, updated_at
       FROM subscribers
       WHERE tenant_id=? AND deleted_at IS NULL AND is_active=1 AND (id=? OR client_code=?) LIMIT 1`, [req.tenantId, code, code]
    );
    if (subRows.length > 0) {
      const r = subRows[0];
      const crm = parseCrm(r.crm_json);
      // Access check: admin OR assigned sales OR assigned via lead
    // Access check: admin OR assigned sales OR reception_daqqi for daqqi-branch clients
      if (!isAdminReq) {
        const staffRole = (req.staffRecord?.role || '').toLowerCase();
        // Roles with full subscriber access — can see any client
        const fullAccessRoles = ['online_manager', 'daqqi_manager', 'manager'];
        if (fullAccessRoles.includes(staffRole)) {
          // allow full access
        } else if (staffRole === 'reception_daqqi') {
          // reception_daqqi can see any daqqi-branch subscriber
          const isDaqqiBranch = r.branch && r.branch.toUpperCase().replace(/[-\s]/g,'_') === 'DAQQI';
          if (!isDaqqiBranch) {
            return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذا العميل' });
          }
        } else {
          const assignedId = r.assigned_sales_id || null;
          const assignedCsId = r.assigned_cs_id || null;
          if (assignedId !== staffId && assignedCsId !== staffId) {
            // Also check via lead linkage
            if (r.lead_id) {
              const [[leadRow]] = await pool.query(
                'SELECT assigned_sales_id, assigned_cs_id FROM leads WHERE id=? AND tenant_id=? LIMIT 1',
                [r.lead_id, req.tenantId]
              );
              if (!leadRow || (leadRow.assigned_sales_id !== staffId && leadRow.assigned_cs_id !== staffId)) {
                return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذا العميل' });
              }
            } else {
              return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذا العميل' });
            }
          }
        }
      }
      const [payRows] = await pool.query(
        `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
                payment_type, payment_method, transaction_id, is_installment, course_expected, \`date\`, note,
                status, staff_id, staff_name, from_account, source, item_title, cert_type,
                certificate_request_id, branch
         FROM payments
         WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL
         ORDER BY \`date\` ASC`, [req.tenantId, r.id]
      );
      const paymentHistory = payRows.map(p => {
        const dateStr = safeDateOnly(p.date);
        return { id: p.id, amount: Number(p.amount)||0, currency: p.currency||'EGP',
          paymentType: (p.payment_type||'other').toLowerCase(), paymentMethod: p.payment_method||null,
          transactionId: p.transaction_id||null, isInstallment: !!p.is_installment,
          courseId: p.course_id||null, bundleId: p.bundle_id||null,
          courseExpected: p.course_expected != null ? Number(p.course_expected) : undefined,
          note: p.note||null, at: dateStr,
          status: p.status || 'paid', staffId: p.staff_id || null, staffName: p.staff_name || null,
          fromAccountNumber: p.from_account || null, source: p.source || null, itemTitle: p.item_title || null,
          certType: p.cert_type || null, certId: p.certificate_request_id || null, branch: p.branch || null };
      });
      const [enrollmentRows] = await pool.query(
        "SELECT course_id,bundle_id,access_type,lecture_limit FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND status='active'",
        [req.tenantId, r.id]
      );
      const enrolledCourseIds = [...new Set(enrollmentRows.flatMap(enrollment => {
        if (enrollment.course_id) return [String(enrollment.course_id)];
        if (enrollment.bundle_id) return [`bundle:${enrollment.bundle_id}`];
        return [];
      }))];
      const courseAccess = Object.fromEntries(enrollmentRows.filter(row => row.course_id).map(row => [
        String(row.course_id),
        row.access_type === 'limited'
          ? { mode: 'limited', lectureLimit: Number(row.lecture_limit) || 1 }
          : 'full',
      ]));
      const [certificateRows] = await pool.query(
        `SELECT id, course_id, type, custom_name, name_ar, name_en, nationality, id_number,
                status, price, paid_amount, currency, note, admin_note, requested_at, issued_at
           FROM certificate_requests
          WHERE tenant_id=? AND subscriber_id=?
          ORDER BY requested_at DESC`,
        [req.tenantId, r.id]
      );
      const extraCertificateRequests = certificateRows.map(request => ({
        id: request.id,
        courseId: request.course_id || undefined,
        type: String(request.type || 'OTHER').toLowerCase(),
        customName: request.custom_name || undefined,
        nameAr: request.name_ar || undefined,
        nameEn: request.name_en || undefined,
        nationality: request.nationality ? String(request.nationality).toLowerCase() : undefined,
        idNumber: request.id_number || undefined,
        status: String(request.status || 'PENDING').toLowerCase(),
        price: request.price != null ? Number(request.price) : undefined,
        paidAmount: request.paid_amount != null ? Number(request.paid_amount) : 0,
        currency: request.currency || undefined,
        requestedAt: safeIsoString(request.requested_at) || null,
        issuedAt: safeIsoString(request.issued_at) || undefined,
        note: request.note || undefined,
        adminNote: request.admin_note || undefined,
      }));
      const [completionRows] = await pool.query(
        `SELECT id,course_id,certificate_code,completed_at,status,version,revoked_at,revoke_reason
         FROM course_completions WHERE tenant_id=? AND subscriber_id=?
         ORDER BY completed_at DESC`,
        [req.tenantId, r.id]
      );
      const certificates = completionRows.map(completion => ({
        id: completion.id,
        courseId: completion.course_id,
        certificateNumber: completion.certificate_code,
        issuedAt: safeIsoString(completion.completed_at) || null,
        status: completion.status || 'active',
        version: Number(completion.version || 1),
        revokedAt: safeIsoString(completion.revoked_at) || undefined,
        revokeReason: completion.revoke_reason || undefined,
      }));
      const clientCode = r.client_code || crm.clientCode || null;

      const rawBranch = r.branch || crm.branch || null;
      const normB = rawBranch ? rawBranch.toUpperCase().replace(/[-\s]/g,'_') : null;
      const branch = (normB && VALID_BRANCHES.has(normB)) ? normB : rawBranch;
      return res.json({ type: 'subscriber', data: {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active, notes: r.notes, createdAt: r.created_at,
        ...crm, enrolledCourseIds, courseAccess,
        // P1: payments table is the sole source of truth for money; the stale
        // crm_json.paymentHistory fallback was proven dead (0 subscribers rely on
        // it — every one has its payments in the table) and is removed.
        clientCode, paymentHistory, certificates, extraCertificateRequests,
        branch, clientType: r.client_type || null,
        assignedSalesId: r.assigned_sales_id || null,
        assignedSalesName: r.assigned_sales_name || null,
        assignedCsId: r.assigned_cs_id || null,
        assignedCsName: r.assigned_cs_name || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      }});
    }

    // ── 2. Try lead (by id or client_code) ──────────────────────────────────
    const [leadRows] = await pool.query(
      `SELECT id, client_code, name, email, phone, source, status, lead_type, branch,
       interest_level, interested_course_ids_json, enrolled_course_id, deal_value,
       assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name,
       notes, last_follow_up, next_follow_up_date, crm_json, hidden, score, created_at, updated_at
        FROM leads WHERE tenant_id=? AND deleted_at IS NULL AND (id=? OR client_code=?) AND hidden=0 LIMIT 1`, [req.tenantId, code, code]
    );
    if (leadRows.length > 0) {
      const r = leadRows[0];
      const crm = parseCrm(r.crm_json);
      if (!isAdminReq) {
        const staffRole2 = (req.staffRecord?.role || '').toLowerCase();
        const fullAccessRoles2 = ['online_manager', 'daqqi_manager', 'manager'];
        if (!fullAccessRoles2.includes(staffRole2) && r.assigned_sales_id !== staffId && r.assigned_cs_id !== staffId) {
          return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذا العميل' });
        }
      }
      const clientCode = r.client_code || crm.clientCode || null;
      const status = (r.status || 'new').toLowerCase();
      const interestedCourseIds = tryJson(r.interested_course_ids_json, crm.interestedCourseIds || []);
      return res.json({ type: 'lead', data: {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        source: r.source, status, notes: r.notes, createdAt: r.created_at,
        ...crm, interestedCourseIds, clientCode,
        assignedSalesId: r.assigned_sales_id || null,
        assignedSalesName: r.assigned_sales_name || null,
        clientType: r.client_type || null,
      }});
    }

    return res.status(404).json({ error: 'لم يتم العثور على العميل' });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// POST /api/staff/enrollment-welcome — create account + send welcome email + WA after staff booking
router.post('/api/staff/enrollment-welcome', requireAuth, requireAdminOrStaff, requirePermission('manage_subscribers'), async (req, res) => {
  const { email, name, courseTitle, branch, courseIds, phone } = req.body || {};
  if (!email || !name) return res.status(400).json({ error: 'email and name required' });
  const normEmail = email.toLowerCase().trim();
  if (!normEmail.includes('@')) return res.status(400).json({ error: 'invalid email' });

  const conn = await pool.getConnection();
  try {
    const [[existing]] = await conn.execute('SELECT id FROM users WHERE tenant_id=? AND email = ? LIMIT 1', [req.tenantId, normEmail]);

    let isNew = false;
    let tempPass = '';
    if (!existing) {
      tempPass = generateTemporaryPassword();
      const hash = await bcrypt.hash(tempPass, 12);
      await conn.execute(
        'INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), req.tenantId, normEmail, hash, (name || '').trim(), 'user']
      );
      isNew = true;
    }

    const ONLINE_BRANCHES = new Set(['ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD']);
    const normBranch = (branch || '').toUpperCase().replace(/[-\s]/g, '_');
    const isOnline = ONLINE_BRANCHES.has(normBranch);
    const siteUrl = 'https://mahadnafsy.com';
    const safeTitle = courseTitle || 'الكورس';
    const safeName = (name || 'عزيزنا').trim();

    const videosLine = isOnline
      ? `<div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px 16px; margin:12px 0;">
           <p style="margin:0; color:#166534; font-weight:bold;">✅ تم فتح أول <strong>20 درس</strong> تلقائياً في الكورس المسجَّل — يمكنك البدء الآن!</p>
         </div>`
      : `<div style="background:#fefce8; border:1px solid #fde68a; border-radius:8px; padding:12px 16px; margin:12px 0;">
           <p style="margin:0; color:#854d0e;">📅 سيتم إضافة المحتوى الخاص بك خلال الموعد المحدد مع فريقنا.</p>
         </div>`;

    const passwordBlock = isNew
      ? `<div style="background:#f3f4f6; border:2px solid #7c3aed; border-radius:8px; padding:16px; text-align:center; margin:16px 0;">
           <p style="margin:0 0 6px; color:#6b7280; font-size:13px;">كلمة المرور المؤقتة</p>
           <span style="font-family:monospace; font-size:26px; font-weight:bold; color:#7c3aed; letter-spacing:4px;">${tempPass}</span>
         </div>
         <p style="color:#6b7280; font-size:13px;">يرجى تغيير كلمة المرور بعد أول تسجيل دخول من ملف حسابك.</p>`
      : `<div style="background:#f3f4f6; border:1px solid #d1d5db; border-radius:8px; padding:14px 16px; margin:16px 0;">
           <p style="margin:0 0 8px; font-weight:bold; color:#374151;">🔐 سجّل الدخول بحسابك الحالي</p>
           <p style="margin:0 0 6px; color:#6b7280; font-size:13px;">📧 ${normEmail}</p>
           <a href="${siteUrl}/login" style="display:inline-block; background:#7c3aed; color:#fff; text-decoration:none; padding:8px 20px; border-radius:6px; font-weight:bold; font-size:14px;">الدخول للمنصة →</a>
         </div>`;

    await mailer.sendMail({
      tenantId: req.tenantId,
      from: `"معهد الدراسات النفسية" <${process.env.SMTP_USER || 'info@mahadnafsy.com'}>`,
      to: normEmail,
      subject: `تم تسجيلك في ${safeTitle} — معهد الدراسات النفسية`,
      html: `
        <div dir="rtl" style="font-family:Arial,sans-serif; max-width:520px; margin:0 auto; padding:24px; border:1px solid #e5e7eb; border-radius:12px;">
          <div style="text-align:center; margin-bottom:24px;">
            <div style="width:48px; height:48px; background:#7c3aed; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-size:24px; font-weight:bold;">ن</div>
            <h2 style="color:#1f2937; margin-top:12px;">معهد الدراسات النفسية</h2>
          </div>
          <p style="color:#374151;">مرحباً <strong>${safeName}</strong>،</p>
          <p style="color:#374151;">نُبشِّرك بأنه تم تسجيلك بنجاح في:</p>
          <div style="background:#f0fdf4; border:2px solid #22c55e; border-radius:8px; padding:12px 16px; margin:16px 0; text-align:center;">
            <span style="font-size:18px; font-weight:bold; color:#166534;">🎓 ${safeTitle}</span>
          </div>
          ${videosLine}
          <div style="background:#faf5ff; border:1px solid #e9d5ff; border-radius:8px; padding:12px 16px; margin:16px 0;">
            <p style="margin:0 0 6px; font-weight:bold; color:#6b21a8;">بيانات تسجيل الدخول</p>
            <p style="margin:0 0 4px; color:#374151;">📧 البريد الإلكتروني: <strong>${normEmail}</strong></p>
            <p style="margin:0; color:#374151;">🌐 الموقع: <a href="${siteUrl}" style="color:#7c3aed;">${siteUrl}</a></p>
          </div>
          ${passwordBlock}
          <p style="color:#9ca3af; font-size:12px; margin-top:24px; border-top:1px solid #e5e7eb; padding-top:12px; text-align:center;">
            معهد الدراسات النفسية — <a href="${siteUrl}" style="color:#7c3aed;">${siteUrl}</a>
          </p>
        </div>
      `,
    });

    logger.info(`[enrollment-welcome] Email sent to ${normEmail} | new=${isNew} | online=${isOnline}`);

    // Send WhatsApp welcome if phone provided
    if (phone) {
      const waMsg = isOnline
        ? `مرحباً ${safeName} 🎉\nتم تسجيلك بنجاح في: ${safeTitle}\n✅ تم فتح أول 20 درس تلقائياً — يمكنك البدء الآن!\n🌐 ${siteUrl}${isNew ? `\n\nبيانات دخولك:\nالإيميل: ${normEmail}\nكلمة المرور: ${tempPass}` : ''}`
        : `مرحباً ${safeName} 🎉\nتم تسجيلك بنجاح في: ${safeTitle}\n📅 سيتم إضافة المحتوى خلال الموعد المحدد مع فريقنا.\n🌐 ${siteUrl}${isNew ? `\n\nبيانات دخولك:\nالإيميل: ${normEmail}\nكلمة المرور: ${tempPass}` : ''}`;
      try { await sendWhatsApp(phone, waMsg, { tenantId: req.tenantId }); logger.info(`[enrollment-welcome] WA sent to ${phone}`); }
      catch (waErr) { logger.warn('[enrollment-welcome] WA failed:', waErr.message); }
    }

    res.json({ ok: true, newAccount: isNew });
  } catch (e) {
    logger.error('[enrollment-welcome]', e.message);
    logger.error('[route]', e.message); sendRouteError(res, e);
  } finally { conn.release(); }
});

// POST /api/admin/subscribers/:id/convert-to-lead
// Reverses an accidental/prospective subscriber conversion without allowing
// financial or learning history to be detached from its owning customer.
router.post(
  '/api/admin/subscribers/:id/convert-to-lead',
  requireAuth,
  requireAdminOrStaff,
  requirePermission('manage_subscribers'),
  requirePermission('manage_leads'),
  async (req, res) => {
    const conn = await pool.getConnection();
    let transactionStarted = false;
    try {
      const tenantId = req.tenantId;
      const subscriberId = req.params.id;
      await conn.beginTransaction();
      transactionStarted = true;

      const [[subscriber]] = await conn.query(
        `SELECT id, lead_id, client_code, name, email, phone, branch, branch_id,
                assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name, notes
           FROM subscribers
          WHERE id=? AND tenant_id=? AND deleted_at IS NULL AND is_active=1
          LIMIT 1 FOR UPDATE`,
        [subscriberId, tenantId]
      );
      if (!subscriber) {
        await conn.rollback();
        transactionStarted = false;
        return res.status(404).json({ error: 'Subscriber not found' });
      }

      const [[history]] = await conn.query(
        `SELECT
           (SELECT COUNT(*) FROM payments
             WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL) AS payments_count,
           (SELECT COUNT(*) FROM enrollments
             WHERE tenant_id=? AND subscriber_id=? AND status='active') AS enrollments_count,
           (SELECT COUNT(*) FROM orders
             WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL) AS orders_count,
           (SELECT COUNT(*) FROM certificate_requests
             WHERE tenant_id=? AND subscriber_id=?) AS certificates_count`,
        [
          tenantId, subscriberId,
          tenantId, subscriberId,
          tenantId, subscriberId,
          tenantId, subscriberId,
        ]
      );
      const blockers = {
        payments: Number(history?.payments_count || 0),
        enrollments: Number(history?.enrollments_count || 0),
        orders: Number(history?.orders_count || 0),
        certificates: Number(history?.certificates_count || 0),
      };
      if (Object.values(blockers).some(Boolean)) {
        await conn.rollback();
        transactionStarted = false;
        return res.status(409).json({
          error: 'لا يمكن إعادة العميل إلى Lead لأن له سجل مالي أو تعليمي. استخدم الإيقاف/الإنهاء أو مسار الاسترداد.',
          blockers,
        });
      }

      const email = String(subscriber.email || '').trim().toLowerCase();
      const phone = String(subscriber.phone || '').trim();
      const [[existingLead]] = await conn.query(
        `SELECT id
           FROM leads
          WHERE tenant_id=?
            AND (
              id=?
              OR (? <> '' AND LOWER(TRIM(email))=?)
              OR (? <> '' AND phone=?)
            )
          ORDER BY (id=?) DESC, created_at DESC
          LIMIT 1 FOR UPDATE`,
        [tenantId, subscriber.lead_id || '', email, email, phone, phone, subscriber.lead_id || '']
      );

      const leadId = existingLead?.id || uuidv4();
      const branch = VALID_BRANCHES.has(subscriber.branch) ? subscriber.branch : 'OTHER';
      if (existingLead) {
        await conn.query(
          `UPDATE leads
              SET name=?, email=?, phone=?, status='new', hidden=0, deleted_at=NULL,
                  branch=?, branch_id=?, assigned_sales_id=?, assigned_sales_name=?,
                  assigned_cs_id=?, assigned_cs_name=?,
                  notes=COALESCE(NULLIF(?, ''), notes), updated_at=NOW()
            WHERE id=? AND tenant_id=?`,
          [
            sanitize(subscriber.name, 300), email || null, phone || null,
            branch, subscriber.branch_id || branchIdForBranch(branch),
            subscriber.assigned_sales_id || null, subscriber.assigned_sales_name || null,
            subscriber.assigned_cs_id || null, subscriber.assigned_cs_name || null,
            sanitize(subscriber.notes, 2000), leadId, tenantId,
          ]
        );
      } else {
        await conn.query(
          `INSERT INTO leads
             (id, tenant_id, client_code, name, email, phone, source, status, lead_type,
              branch, branch_id, interest_level, assigned_sales_id, assigned_sales_name,
              assigned_cs_id, assigned_cs_name, notes, hidden, crm_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'subscriber_reversal', 'new', 'COURSE',
                   ?, ?, 'MEDIUM', ?, ?, ?, ?, ?, 0, ?, NOW(), NOW())`,
          [
            leadId, tenantId, subscriber.client_code || null, sanitize(subscriber.name, 300),
            email || null, phone || null, branch, subscriber.branch_id || branchIdForBranch(branch),
            subscriber.assigned_sales_id || null, subscriber.assigned_sales_name || null,
            subscriber.assigned_cs_id || null, subscriber.assigned_cs_name || null,
            sanitize(subscriber.notes, 2000),
            JSON.stringify({ convertedBackFromSubscriberId: subscriberId, convertedBackAt: new Date().toISOString() }),
          ]
        );
      }

      await conn.query(
        `UPDATE subscribers
            SET is_active=0, deleted_at=NOW(), lead_id=?, updated_at=NOW()
          WHERE id=? AND tenant_id=?`,
        [leadId, subscriberId, tenantId]
      );
      await logLeadEvent(
        leadId,
        'subscriber_reverted',
        'تمت إعادة سجل مشترك بلا تاريخ مالي أو تعليمي إلى العملاء المحتملين',
        { subscriberId, actor: req.user?.email || 'admin' },
        tenantId,
        conn
      );

      await conn.commit();
      transactionStarted = false;
      res.json({ ok: true, leadId, subscriberId });
    } catch (error) {
      if (transactionStarted) await conn.rollback().catch(() => {});
      logger.error('[subscriber-convert-to-lead]', error.message);
      sendRouteError(res, error);
    } finally {
      conn.release();
    }
  }
);

// POST /api/admin/subscribers
router.post('/api/admin/subscribers', requireAuth, requireAdminOrStaff, requirePermission('manage_subscribers'), async (req, res) => {
  let conn;
  let transactionStarted = false;
  let identityToInvalidate = null;
  try {
    const tenantId = req.tenantId;
    const s = req.body;
    const id = s.id || uuidv4();
    // Extract base columns; store everything else in crm_json
    // NOTE: crm_json is explicitly excluded to prevent nested crm_json from being saved back
    const {
      id: _id, name, email, phone, isActive, is_active, firebaseUid, firebase_uid,
      notes, createdAt, created_at, clientCode, client_code, updatedAt: clientUpdatedAt,
      credentialUpdate,
      crm_json: _nested_crm,
      // These projections belong to dedicated tables. Never copy a stale UI
      // snapshot back into crm_json when a staff member edits profile fields.
      paymentHistory: _paymentHistory,
      extraCertificateRequests: _certificateRequests,
      certificates: _courseCompletions,
      lectureProgress: _lectureProgress,
      ...crmData
    } = s;
    const staffRole = String(req.staffRecord?.role || '').toLowerCase();
    const canUpdateCredentials = Boolean(
      req.isSuperAdmin
      || FULL_ACCESS_ROLES.includes(staffRole)
      || staffRole === 'online_manager'
      || ADMIN_EMAILS.some(adminEmail => adminEmail.toLowerCase() === String(req.user?.email || '').toLowerCase())
    );
    if (credentialUpdate && !canUpdateCredentials) {
      return res.status(403).json({ error: 'Insufficient permissions to update login credentials' });
    }
    const requestedPassword = String(credentialUpdate?.newPassword || '');
    if (requestedPassword && requestedPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    // Hash before reserving a database connection. Holding a pool connection
    // during bcrypt caused login/profile updates to deadlock under concurrency.
    const requestedPasswordHash = requestedPassword ? await bcrypt.hash(requestedPassword, 12) : null;
    conn = await pool.getConnection();

    // Unwrap nested crm_json: if the payload includes a crm_json key (from old buggy code or stale loads),
    // merge it into the top-level crmData so clientStatus, transferAnswers etc. are properly saved.
    if (_nested_crm && typeof _nested_crm === 'object') {
      Object.assign(crmData, { ..._nested_crm, ...crmData });
    }
    delete crmData.paymentHistory;
    delete crmData.extraCertificateRequests;
    delete crmData.certificates;
    delete crmData.lectureProgress;
    const requestedCourseIds = Array.isArray(crmData.enrolledCourseIds)
      ? crmData.enrolledCourseIds.map(String) : [];
    const requestedCourseAccess = crmData.courseAccess || {};
    delete crmData.enrolledCourseIds;
    delete crmData.courseAccess;

    await conn.beginTransaction();
    transactionStarted = true;

    const [[foreignId]] = await conn.query('SELECT id FROM subscribers WHERE id=? AND tenant_id<>? LIMIT 1', [id, tenantId]);
    if (foreignId) return res.status(409).json({ error: 'Subscriber id is not available in this tenant' });

    // Optimistic Concurrency Check — if client sent updatedAt, verify it matches DB before overwriting
    if (clientUpdatedAt && id) {
      try {
        const [[current]] = await conn.query('SELECT updated_at FROM subscribers WHERE id = ? AND tenant_id=? LIMIT 1 FOR UPDATE', [id, tenantId]);
        if (current) {
          const dbTs = safeIsoString(current.updated_at);
          const clientTs = String(clientUpdatedAt);
          // Compare truncated to seconds (DB might lose sub-second precision)
          if (dbTs.slice(0, 19) !== clientTs.slice(0, 19)) {
            return res.status(409).json({
              error: 'تعارض في البيانات — تم تعديل هذا المشترك من طرف آخر. يرجى إعادة التحميل.',
              conflict: true,
              serverUpdatedAt: dbTs,
            });
          }
        }
      } catch (_) { /* OCC check failure is non-fatal — proceed with save */ }
    }
    const active = isActive !== undefined ? isActive : (is_active !== undefined ? is_active : 1);
    // Sanitize text inputs at the system boundary
    const safeName  = sanitize(name,  300);
    const safeEmailRaw = (email || '').toLowerCase().trim().substring(0, 255);
    const safeEmail = safeEmailRaw || null; // use NULL (not '') so UNIQUE constraint allows multiple clients without email
    const safePhoneRaw = (phone || '').replace(/[^\d+\-\s()]/g, '').trim().substring(0, 30);
    const safePhone = safePhoneRaw || null; // store NULL not '' so UNIQUE constraint works
    const safeNotes = sanitize(notes, 2000);
    // Auto-generate client_code if not provided — never allow a subscriber to be saved without one
    let code = clientCode || client_code || null;
    if (!code) {
      try { code = await getNextClientCode(conn); } catch { /* handled by uniqueness validation below */ }
    }
    // ── Uniqueness checks ──────────────────────────────────────────────────────
    // Email uniqueness (subscribers table, excluding current record)
    if (safeEmail) {
      const [[emailRow]] = await conn.query(
        'SELECT id FROM subscribers WHERE tenant_id=? AND LOWER(TRIM(email))=? AND id != ? LIMIT 1', [tenantId, safeEmail, id]
      );
      if (emailRow) return res.status(409).json({
        error: `البريد الإلكتروني ${safeEmail} مسجل بالفعل لعميل آخر`,
        existingId: emailRow.id,
      });
    }
    // Phone uniqueness (excluding current record) — normalize digits before comparing
    if (safePhone) {
      const [[phoneRow]] = await conn.query(
        `SELECT id FROM subscribers WHERE tenant_id=? AND phone=? AND id != ? LIMIT 1`,
        [tenantId, safePhone, id]
      );
      if (phoneRow) return res.status(409).json({
        error: `رقم الهاتف ${safePhone} مسجل بالفعل لعميل آخر`,
        existingId: phoneRow.id,
      });
    }
    // client_code uniqueness (excluding current record)
    if (code) {
      const [[codeRow]] = await conn.query(
        'SELECT id FROM subscribers WHERE tenant_id=? AND client_code=? AND id != ? LIMIT 1', [tenantId, code, id]
      );
      if (codeRow) {
        // Auto-generate a new unique code instead of rejecting
        try { code = await getNextClientCode(conn); } catch { /* duplicate key will fail closed */ }
      }
    }
    // ───────────────────────────────────────────────────────────────────────────
    // Detect if this is a new insert (for auto-assign)
    const [[existingSub]] = await conn.query(
      'SELECT id, email, assigned_cs_id FROM subscribers WHERE id = ? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [id, tenantId]
    );
    const isNewSub = !existingSub;
    // Auto-assign to COLLECTION staff on new subscriber if not already assigned
    let csId   = crmData.assignedCollectionId   || null;
    let csName = crmData.assignedCollectionName || null;
    if (isNewSub && !csId) {
      const rep = await autoAssignStaff('COLLECTION', req.tenantId);
      if (rep) { csId = rep.id; csName = rep.name; }
    }
    // Extract sales assignment and branch for dedicated DB columns
    const salesId   = crmData.assignedSalesId   || null;
    const salesName = crmData.assignedSalesName || null;

    const rawBranch = crmData.branch || null;
    const normBranch = rawBranch ? rawBranch.toUpperCase().replace(/[-\s]/g,'_') : null;
    const branchVal = (normBranch && VALID_BRANCHES.has(normBranch)) ? normBranch : null;
    const branchIdVal = branchIdForBranch(branchVal || 'ONLINE_EGYPT');
    const VALID_CLIENT_TYPES = new Set([
      'ONLINE_LOCAL_NEW','ONLINE_LOCAL_OLD','ONLINE_SAUDI_NEW','ONLINE_SAUDI_OLD',
      'ONLINE_ABROAD','DAQQI_NEW','DAQQI_OLD','QATAMIYA',
      'LEAD_LOCAL_NEW','LEAD_LOCAL_OLD','LEAD_INTL_NEW','LEAD_INTL_OLD']);
    const rawClientType = crmData.clientType || s.client_type || null;
    const clientTypeVal = (rawClientType && VALID_CLIENT_TYPES.has(rawClientType.toUpperCase())) ? rawClientType.toUpperCase() : (rawClientType || null);
    if (existingSub) {
      // COALESCE alone cannot express "unassign": a caller that omits the field
      // and one that explicitly sends null both arrive here as NULL, so the old
      // owner stuck forever and a subscriber left behind by a departed rep could
      // never be freed. Same defect that was just fixed on leads. Distinguish the
      // two — an explicitly present null clears, an absent key leaves it alone.
      const clearCs    = Object.prototype.hasOwnProperty.call(crmData, 'assignedCollectionId') && !crmData.assignedCollectionId;
      const clearSales = Object.prototype.hasOwnProperty.call(crmData, 'assignedSalesId') && !crmData.assignedSalesId;
      await conn.query(
        `UPDATE subscribers SET name=?, email=?, phone=?, firebase_uid=COALESCE(?,firebase_uid),
           client_code=COALESCE(client_code, ?), is_active=?, notes=COALESCE(?,notes),
           assigned_cs_id=IF(?,NULL,COALESCE(?,assigned_cs_id)),
           assigned_cs_name=IF(?,NULL,COALESCE(?,assigned_cs_name)),
           assigned_sales_id=IF(?,NULL,COALESCE(?,assigned_sales_id)),
           assigned_sales_name=IF(?,NULL,COALESCE(?,assigned_sales_name)),
           branch=COALESCE(?,branch), branch_id=COALESCE(NULLIF(?,''),branch_id),
           client_type=COALESCE(?,client_type), crm_json=?
         WHERE id=? AND tenant_id=?`,
        [safeName||'', safeEmail, safePhone, firebaseUid || firebase_uid || null, code, active?1:0,
         safeNotes||null,
         clearCs ? 1 : 0, csId, clearCs ? 1 : 0, csName,
         clearSales ? 1 : 0, salesId, clearSales ? 1 : 0, salesName,
         branchVal, branchIdVal, clientTypeVal,
         JSON.stringify(crmData), id, tenantId]
      );
    } else {
      await conn.query(
        `INSERT INTO subscribers (id, tenant_id, firebase_uid, client_code, name, email, phone, is_active, notes,
           assigned_cs_id, assigned_cs_name, assigned_sales_id, assigned_sales_name, branch, branch_id, client_type, crm_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, tenantId, firebaseUid || firebase_uid || null, code, safeName||'', safeEmail, safePhone, active?1:0,
         safeNotes||null, csId, csName, salesId, salesName, branchVal, branchIdVal, clientTypeVal, JSON.stringify(crmData)]
      );
    }
    if (credentialUpdate) {
      const currentLoginEmail = String(credentialUpdate.currentEmail || existingSub?.email || '').toLowerCase().trim();
      const nextLoginEmail = safeEmail || currentLoginEmail;
      const [[account]] = await conn.query(
        `SELECT id, email FROM users
         WHERE tenant_id=? AND (id=? OR email=?) LIMIT 1 FOR UPDATE`,
        [tenantId, id, currentLoginEmail]
      );
      if (account && nextLoginEmail && nextLoginEmail !== String(account.email || '').toLowerCase()) {
        const [[emailOwner]] = await conn.query(
          'SELECT id FROM users WHERE tenant_id=? AND email=? AND id<>? LIMIT 1',
          [tenantId, nextLoginEmail, account.id]
        );
        if (emailOwner) {
          return res.status(409).json({ error: `البريد الإلكتروني ${nextLoginEmail} مسجل بالفعل لمستخدم آخر` });
        }
      }
      if (account) {
        const credentialSets = [];
        const credentialParams = [];
        if (nextLoginEmail) {
          credentialSets.push('email=?');
          credentialParams.push(nextLoginEmail);
        }
        if (requestedPasswordHash) {
          credentialSets.push('password_hash=?');
          credentialParams.push(requestedPasswordHash);
        }
        if (credentialSets.length) {
          credentialSets.push('session_version=session_version+1');
          await conn.query(
            `UPDATE users SET ${credentialSets.join(', ')} WHERE tenant_id=? AND id=?`,
            [...credentialParams, tenantId, account.id]
          );
        }
        identityToInvalidate = { oldEmail: account.email, newEmail: nextLoginEmail };
      } else if (requestedPasswordHash && nextLoginEmail) {
        await conn.query(
          `INSERT INTO users (id, tenant_id, email, password_hash, name, role)
           VALUES (?, ?, ?, ?, ?, 'client')`,
          [id, tenantId, nextLoginEmail, requestedPasswordHash, safeName || '']
        );
        identityToInvalidate = { oldEmail: currentLoginEmail, newEmail: nextLoginEmail };
      }
    }
    await syncCourseEntitlements({
      tenantId,
      subscriberId: id,
      courses: requestedCourseIds.map(courseId => {
        const raw = requestedCourseAccess[courseId];
        return {
          courseId,
          accessType: typeof raw === 'object' ? raw?.mode : raw,
          lectureLimit: typeof raw === 'object' ? raw?.lectureLimit : null,
        };
      }),
      branchId: branchIdVal,
      source: 'subscriber_admin',
      actor: req.user?.email || req.staffRecord?.name || 'admin',
    }, conn);
    // Automation #3: Auto-link this subscriber to their matching lead (by phone or email)
    // Runs on both new AND existing subscribers without a lead_id — closes the "update" gap
    {
      const [[subCheck]] = await conn.query('SELECT lead_id FROM subscribers WHERE id = ? AND tenant_id=? LIMIT 1', [id, tenantId]);
      const needsLink = !subCheck?.lead_id;
      if (needsLink && (safePhone || safeEmail)) {
        const normPhone = safePhone ? safePhone.replace(/\D/g, '').replace(/^(20|0020)?([0-9]{10})$/, '0$2') : null;
        const matchQ = normPhone
          ? `SELECT id, status FROM leads WHERE tenant_id=? AND (REGEXP_REPLACE(phone,'[^0-9]','') LIKE ? OR email = ?) AND hidden=0 ORDER BY created_at DESC LIMIT 1`
          : 'SELECT id, status FROM leads WHERE tenant_id=? AND email = ? AND hidden=0 ORDER BY created_at DESC LIMIT 1';
        const matchParams = normPhone ? [tenantId, `%${normPhone.slice(-9)}`, safeEmail || ''] : [tenantId, safeEmail];
        const [[matchedLead]] = await conn.query(matchQ, matchParams);
        if (matchedLead) {
          await conn.query(
            "UPDATE subscribers SET lead_id=? WHERE id=? AND tenant_id=? AND lead_id IS NULL",
            [matchedLead.id, id, tenantId]
          );
          await transitionLead({
            tenantId, leadId: matchedLead.id, toStatus: 'converted', db: conn,
            actor: req.user?.email || req.staffRecord?.name || 'subscriber-save',
            reason: 'Subscriber linked and lead converted', metadata: { subscriberId: id },
          });
        }
      }
    }
    // Payments are never accepted through subscriber CRM JSON. Money moves only
    // through the transactional payment endpoints, which also post the journal,
    // enforce period locks and create entitlements atomically.
    // Return the server-side updatedAt so the frontend can update OCC state
    const [[savedRow]] = await conn.query('SELECT updated_at FROM subscribers WHERE id = ? AND tenant_id=? LIMIT 1', [id, tenantId]);
    const savedUpdatedAt = safeIsoString(savedRow?.updated_at) || new Date().toISOString();
    await conn.commit();
    transactionStarted = false;
    if (identityToInvalidate) {
      invalidateIdentity(tenantId, '', identityToInvalidate.oldEmail);
      invalidateIdentity(tenantId, '', identityToInvalidate.newEmail);
    }
    res.json({ ok: true, id, updatedAt: savedUpdatedAt, assignedCs: csId ? { id: csId, name: csName } : null });
    // External notifications only start after the subscriber/enrollment transaction commits.
    if (isNewSub && safePhone) {
      setImmediate(async () => {
        try {
          const settings = await getTenantSetting('settings', { tenantId, fallback: {} });
          const welcomeMsg = settings.subscriberWelcomeMsg
            || `أهلاً ${safeName || ''} 🎉\nيسعدنا انضمامك لأسرة مهد نفسي. سيتواصل معك فريقنا قريباً لتجهيز اشتراكك.`;
          await sendWhatsApp(safePhone.replace(/\D/g, ''), welcomeMsg, { tenantId: req.tenantId });
        } catch (_) { /* welcome msg is best-effort */ }
      });
    }
    // Notify admins of new subscriber registration
    if (isNewSub) {
      createNotification('subscriber', '🎉 مشترك جديد', `${safeName || 'مشترك جديد'} انضم للمنصة`, { subscriberId: id, phone: safePhone }, tenantId).catch(() => {});
    }
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY' && e.message.includes('email')) {
      return res.status(409).json({ error: `البريد الإلكتروني ${req.body.email} مسجل بالفعل` });
    }
    logger.error('[route]', e.message); sendRouteError(res, e);
  } finally {
    if (transactionStarted && conn) { try { await conn.rollback(); } catch (_) {} }
    if (conn) conn.release();
  }
});

// POST /api/admin/leads
module.exports = router;
