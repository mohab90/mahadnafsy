'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');

const { pool, autoAssignStaff, cacheInvalidate } = require('../../lib/db');
const { mailer } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, parseCrm, calcLeadScoreServer } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logLeadEvent } = require('../../lib/crm');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { DATA_SCOPE, VALID_BRANCHES, VALID_PAY_TYPES, VALID_SOURCES } = require('../../constants/permissions');
const { onlineMap } = require('../../lib/onlineUsers');
const { safeIsoString, safeDateOnly } = require('../../lib/dates');
const { keyset } = require('../../lib/pagination');
const { branchIdForBranch } = require('../../lib/branches');
function sendRouteError(res, err) {
  if (res.headersSent) return;
  const dbCodes = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_SERVER_LOST']);
  const status = err && dbCodes.has(err.code) ? 503 : 500;
  res.status(status).json({ error: status === 503 ? 'Database unavailable' : 'Internal server error' });
}


router.get('/api/staff/client/:code', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const code = req.params.code;
    const isAdminReq = req.staffRecord?.role === 'ADMIN';
    const staffId = req.staffRecord?.id;

    // ── 1. Try subscriber (by id or client_code) ────────────────────────────
    const [subRows] = await pool.query(
      `SELECT id, firebase_uid, client_code, lead_id, name, email, phone, branch,
       is_active, notes, assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name,
       crm_json, created_at, updated_at
       FROM subscribers WHERE id=? OR client_code=? LIMIT 1`, [code, code]
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
          const assignedId = r.assigned_sales_id || crm.assignedSalesId || null;
          const assignedCsId = r.assigned_cs_id || crm.assignedCsId || null;
          if (assignedId !== staffId && assignedCsId !== staffId) {
            // Also check via lead linkage
            if (r.lead_id) {
              const [[leadRow]] = await pool.query('SELECT assigned_sales_id, assigned_cs_id FROM leads WHERE id=? LIMIT 1', [r.lead_id]);
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
                payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
                status, staff_id
         FROM payments WHERE subscriber_id=? ORDER BY \`date\` ASC`, [r.id]
      );
      const paymentHistory = payRows.map(p => {
        const dateStr = safeDateOnly(p.date);
        return { id: p.id, amount: Number(p.amount)||0, currency: p.currency||'EGP',
          paymentType: (p.payment_type||'other').toLowerCase(), paymentMethod: p.payment_method||null,
          transactionId: p.transaction_id||null, isInstallment: !!p.is_installment,
          courseId: p.course_id||null, bundleId: p.bundle_id||null, note: p.note||null, at: dateStr,
          status: p.status || 'paid', staffId: p.staff_id || null };
      });
      const clientCode = r.client_code || crm.clientCode || null;

      const rawBranch = r.branch || crm.branch || null;
      const normB = rawBranch ? rawBranch.toUpperCase().replace(/[-\s]/g,'_') : null;
      const branch = (normB && VALID_BRANCHES.has(normB)) ? normB : rawBranch;
      return res.json({ type: 'subscriber', data: {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active, notes: r.notes, createdAt: r.created_at,
        ...crm, enrolledCourseIds: Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds : [],
        // P1: payments table is the sole source of truth for money; the stale
        // crm_json.paymentHistory fallback was proven dead (0 subscribers rely on
        // it — every one has its payments in the table) and is removed.
        clientCode, paymentHistory,
        branch, clientType: r.client_type || null,
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      }});
    }

    // ── 2. Try lead (by id or client_code) ──────────────────────────────────
    const [leadRows] = await pool.query(
      `SELECT id, client_code, name, email, phone, source, status, lead_type, branch,
       interest_level, interested_course_ids_json, enrolled_course_id, deal_value,
       assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name,
       notes, last_follow_up, next_follow_up_date, crm_json, hidden, score, created_at, updated_at
       FROM leads WHERE (id=? OR client_code=?) AND hidden=0 LIMIT 1`, [code, code]
    );
    if (leadRows.length > 0) {
      const r = leadRows[0];
      const crm = parseCrm(r.crm_json);
      if (!isAdminReq) {
        const staffRole2 = (req.staffRecord?.role || '').toLowerCase();
        const fullAccessRoles2 = ['online_manager', 'daqqi_manager', 'manager'];
        if (!fullAccessRoles2.includes(staffRole2) && r.assigned_sales_id !== staffId && (crm.assignedCsId || r.assigned_cs_id) !== staffId) {
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
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        clientType: r.client_type || null,
      }});
    }

    return res.status(404).json({ error: 'لم يتم العثور على العميل' });
  } catch (e) { logger.error('[route]', e.message); sendRouteError(res, e); }
});

// POST /api/staff/enrollment-welcome — create account + send welcome email + WA after staff booking
router.post('/api/staff/enrollment-welcome', requireAuth, requireAdminOrStaff, async (req, res) => {
  const { email, name, courseTitle, branch, courseIds, phone } = req.body || {};
  if (!email || !name) return res.status(400).json({ error: 'email and name required' });
  const normEmail = email.toLowerCase().trim();
  if (!normEmail.includes('@')) return res.status(400).json({ error: 'invalid email' });

  const conn = await pool.getConnection();
  try {
    const [[existing]] = await conn.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [normEmail]);

    let isNew = false;
    let tempPass = '';
    if (!existing) {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      for (let i = 0; i < 8; i++) tempPass += chars[Math.floor(Math.random() * chars.length)];
      const hash = await bcrypt.hash(tempPass, 12);
      await conn.execute(
        'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), normEmail, hash, (name || '').trim(), 'user']
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
      try { await sendWhatsApp(phone, waMsg); logger.info(`[enrollment-welcome] WA sent to ${phone}`); }
      catch (waErr) { logger.warn('[enrollment-welcome] WA failed:', waErr.message); }
    }

    res.json({ ok: true, newAccount: isNew });
  } catch (e) {
    logger.error('[enrollment-welcome]', e.message);
    logger.error('[route]', e.message); sendRouteError(res, e);
  } finally { conn.release(); }
});

// POST /api/admin/subscribers
router.post('/api/admin/subscribers', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const s = req.body;
    const id = s.id || uuidv4();
    // Extract base columns; store everything else in crm_json
    // NOTE: crm_json is explicitly excluded to prevent nested crm_json from being saved back
    const { id: _id, name, email, phone, isActive, is_active, firebaseUid, firebase_uid, notes, createdAt, created_at, clientCode, client_code, updatedAt: clientUpdatedAt, crm_json: _nested_crm, ...crmData } = s;

    // Unwrap nested crm_json: if the payload includes a crm_json key (from old buggy code or stale loads),
    // merge it into the top-level crmData so clientStatus, transferAnswers etc. are properly saved.
    if (_nested_crm && typeof _nested_crm === 'object') {
      Object.assign(crmData, { ..._nested_crm, ...crmData });
    }

    // Optimistic Concurrency Check — if client sent updatedAt, verify it matches DB before overwriting
    if (clientUpdatedAt && id) {
      try {
        const [[current]] = await pool.query('SELECT updated_at FROM subscribers WHERE id = ? LIMIT 1', [id]);
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
      const conn2 = await pool.getConnection();
      try { code = await getNextClientCode(conn2); } catch { /* ignore */ } finally { conn2.release(); }
    }
    // ── Uniqueness checks ──────────────────────────────────────────────────────
    // Email uniqueness (subscribers table, excluding current record)
    if (safeEmail) {
      const [[emailRow]] = await pool.query(
        'SELECT id FROM subscribers WHERE LOWER(TRIM(email))=? AND id != ? LIMIT 1', [safeEmail, id]
      );
      if (emailRow) return res.status(409).json({
        error: `البريد الإلكتروني ${safeEmail} مسجل بالفعل لعميل آخر`,
        existingId: emailRow.id,
      });
    }
    // Phone uniqueness (excluding current record) — normalize digits before comparing
    if (safePhone) {
      const [[phoneRow]] = await pool.query(
        `SELECT id FROM subscribers WHERE phone=? AND id != ? LIMIT 1`,
        [safePhone, id]
      );
      if (phoneRow) return res.status(409).json({
        error: `رقم الهاتف ${safePhone} مسجل بالفعل لعميل آخر`,
        existingId: phoneRow.id,
      });
    }
    // client_code uniqueness (excluding current record)
    if (code) {
      const [[codeRow]] = await pool.query(
        'SELECT id FROM subscribers WHERE client_code=? AND id != ? LIMIT 1', [code, id]
      );
      if (codeRow) {
        // Auto-generate a new unique code instead of rejecting
        const conn3 = await pool.getConnection();
        try { code = await getNextClientCode(conn3); } catch { /* ignore */ } finally { conn3.release(); }
      }
    }
    // ───────────────────────────────────────────────────────────────────────────
    // Detect if this is a new insert (for auto-assign)
    const [[existingSub]] = await pool.query('SELECT id, assigned_cs_id FROM subscribers WHERE id = ? LIMIT 1', [id]);
    const isNewSub = !existingSub;
    // Auto-assign to COLLECTION staff on new subscriber if not already assigned
    let csId   = crmData.assignedCollectionId   || null;
    let csName = crmData.assignedCollectionName || null;
    if (isNewSub && !csId) {
      const rep = await autoAssignStaff('COLLECTION');
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
    await pool.query(
      `INSERT INTO subscribers (id, firebase_uid, client_code, name, email, phone, is_active, notes,
         assigned_cs_id, assigned_cs_name, assigned_sales_id, assigned_sales_name, branch, branch_id, client_type, crm_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), phone=COALESCE(VALUES(phone), phone), firebase_uid=COALESCE(VALUES(firebase_uid),firebase_uid),
         client_code=COALESCE(client_code, VALUES(client_code)),
         is_active=VALUES(is_active), notes=COALESCE(VALUES(notes),notes),
         assigned_cs_id=COALESCE(VALUES(assigned_cs_id), assigned_cs_id),
         assigned_cs_name=COALESCE(VALUES(assigned_cs_name), assigned_cs_name),
         assigned_sales_id=COALESCE(VALUES(assigned_sales_id), assigned_sales_id),
         assigned_sales_name=COALESCE(VALUES(assigned_sales_name), assigned_sales_name),
         branch=COALESCE(VALUES(branch), branch),
         branch_id=COALESCE(NULLIF(VALUES(branch_id),''), branch_id),
         client_type=COALESCE(VALUES(client_type), client_type),
         crm_json=VALUES(crm_json)`,
      [id, firebaseUid || firebase_uid || null, code, safeName||'', safeEmail, safePhone, active?1:0,
       safeNotes||null, csId, csName, salesId, salesName, branchVal, branchIdVal, clientTypeVal, JSON.stringify(crmData)]
    );
    // Full bi-directional sync: enrolledCourseIds in crm_json ↔ enrollments table
    // This is the authoritative sync — always runs, handles add/remove/update access
    {
      const newEnrolledIds = new Set((Array.isArray(crmData.enrolledCourseIds) ? crmData.enrolledCourseIds : []).map(String));
      const [existingRows] = await pool.query(
        'SELECT id, course_id, access_type, lecture_limit FROM enrollments WHERE subscriber_id = ?', [id]);
      const existingMap = new Map(existingRows.map(r => [String(r.course_id), r]));

      // 1. DELETE rows for courses that were removed
      const toDelete = existingRows.filter(r => !newEnrolledIds.has(String(r.course_id)));
      if (toDelete.length > 0) {
        const deleteIds = toDelete.map(r => r.id);
        await pool.query('DELETE FROM enrollments WHERE id IN (?)', [deleteIds]).catch(() => {});
      }

      // 2. INSERT new courses / UPDATE changed access for existing ones (batched)
      const enrollInsertRows = [], enrollInsertParams = [], enrollUpdates = [];
      for (const courseId of newEnrolledIds) {
        const rawAccess = crmData.courseAccess?.[courseId];
        const newAccessMode = (typeof rawAccess === 'object' ? rawAccess?.mode : rawAccess) || 'full';
        const newLectureLimit = (typeof rawAccess === 'object' ? rawAccess?.lectureLimit : null) || null;
        const existing = existingMap.get(courseId);
        if (!existing) {
          enrollInsertRows.push('(?, ?, ?, NOW(), ?, ?, ?)');
          enrollInsertParams.push(uuidv4(), id, courseId, newAccessMode, newLectureLimit, branchIdVal);
        } else if (existing.access_type !== newAccessMode || String(existing.lecture_limit ?? '') !== String(newLectureLimit ?? '')) {
          enrollUpdates.push(pool.query(
            'UPDATE enrollments SET access_type=?, lecture_limit=? WHERE id=?',
            [newAccessMode, newLectureLimit, existing.id]
          ).catch(() => {}));
        }
      }
      if (enrollInsertRows.length > 0) {
        await pool.query(
          `INSERT IGNORE INTO enrollments (id, subscriber_id, course_id, enrolled_at, access_type, lecture_limit, branch_id) VALUES ${enrollInsertRows.join(',')}`,
          enrollInsertParams
        ).catch(() => {});
      }
      if (enrollUpdates.length > 0) await Promise.all(enrollUpdates);
    }
    // Automation #3: Auto-link this subscriber to their matching lead (by phone or email)
    // Runs on both new AND existing subscribers without a lead_id — closes the "update" gap
    {
      const [[subCheck]] = await pool.query('SELECT lead_id FROM subscribers WHERE id = ? LIMIT 1', [id]).catch(() => [[null]]);
      const needsLink = !subCheck?.lead_id;
      if (needsLink && (safePhone || safeEmail)) {
        const normPhone = safePhone ? safePhone.replace(/\D/g, '').replace(/^(20|0020)?([0-9]{10})$/, '0$2') : null;
        const matchQ = normPhone
          ? `SELECT id FROM leads WHERE (REGEXP_REPLACE(phone,'[^0-9]','') LIKE ? OR LOWER(email)=LOWER(?)) AND hidden=0 ORDER BY created_at DESC LIMIT 1`
          : 'SELECT id FROM leads WHERE LOWER(email)=LOWER(?) AND hidden=0 ORDER BY created_at DESC LIMIT 1';
        const matchParams = normPhone ? [`%${normPhone.slice(-9)}`, safeEmail || ''] : [safeEmail];
        try {
          const [[matchedLead]] = await pool.query(matchQ, matchParams);
          if (matchedLead) {
            await pool.query(
              "UPDATE subscribers SET lead_id=? WHERE id=? AND lead_id IS NULL",
              [matchedLead.id, id]
            );
            // Mark the lead as converted (if not already)
            await pool.query(
              "UPDATE leads SET status='converted' WHERE id=? AND LOWER(status) NOT IN ('converted','lost')",
              [matchedLead.id]
            );
          }
        } catch (_) {}
      }
    }
    // Automation #5: Send WhatsApp welcome message to new subscriber
    if (isNewSub && safePhone) {
      setImmediate(async () => {
        try {
          const [[cfg]] = await pool.query("SELECT `value` FROM site_config WHERE `key`='settings' LIMIT 1");
          const settings = cfg?.value ? JSON.parse(cfg.value) : {};
          const welcomeMsg = settings.subscriberWelcomeMsg
            || `أهلاً ${safeName || ''} 🎉\nيسعدنا انضمامك لأسرة مهد نفسي. سيتواصل معك فريقنا قريباً لتجهيز اشتراكك.`;
          await sendWhatsApp(safePhone.replace(/\D/g, ''), welcomeMsg);
        } catch (_) { /* welcome msg is best-effort */ }
      });
    }
    // ── AUTO-SYNC: write any new paymentHistory entries → payments table ──────
    // This is the single source of truth guarantee: every time a subscriber is saved,
    // we reconcile their paymentHistory into the payments table (INSERT IGNORE = idempotent).
    if (Array.isArray(crmData.paymentHistory) && crmData.paymentHistory.length > 0) {


      setImmediate(async () => {
        try {
          const payBatchRows = [], payBatchParams = [];
          for (const p of crmData.paymentHistory) {
            if (!p.id || !p.amount || Number(p.amount) <= 0) continue;
            const pType = (p.paymentType || 'OTHER').toUpperCase();
            const safePayType = VALID_PAY_TYPES.has(pType) ? pType : 'OTHER';
            const dateVal = safeDateOnly(p.at || p.date || new Date()) || new Date().toISOString().slice(0, 10);
            const payStatus = p.status || 'paid';
            const safeSource = VALID_SOURCES.has(p.source) ? p.source : null;
            payBatchRows.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
            payBatchParams.push(
              p.id, id,
              p.courseId || null, p.bundleId || null,
              Number(p.amount) || 0,
              p.currency || 'EGP',
              safePayType,
              p.paymentMethod || null,
              p.transactionId || null,
              p.isInstallment ? 1 : 0,
              p.courseExpected != null ? Number(p.courseExpected) : null,
              dateVal,
              p.note || null,
              p.staffId || null,
              payStatus,
              p.staffName || null,
              p.fromAccountNumber || null,
              safeSource,
              p.itemTitle || null,
              p.certType || null,
              'tenant-default',
              branchVal || 'ONLINE_EGYPT',
              branchIdVal,
            );
          }
          if (payBatchRows.length > 0) {
            await pool.query(
              `INSERT INTO payments
                 (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
                  payment_method, transaction_id, is_installment, course_expected, date, note, staff_id, status,
                  staff_name, from_account, source, item_title, cert_type, tenant_id, branch, branch_id)
               VALUES ${payBatchRows.join(',')}
               ON DUPLICATE KEY UPDATE status=VALUES(status), note=COALESCE(VALUES(note),note),
                 staff_name=COALESCE(VALUES(staff_name),staff_name),
                 from_account=COALESCE(VALUES(from_account),from_account),
                 source=COALESCE(VALUES(source),source),
                 item_title=COALESCE(VALUES(item_title),item_title),
                 cert_type=COALESCE(VALUES(cert_type),cert_type),
                 tenant_id=COALESCE(tenant_id,VALUES(tenant_id)),
                 branch=COALESCE(branch,VALUES(branch)),
                 branch_id=COALESCE(NULLIF(branch_id,''),VALUES(branch_id)),
                 course_expected=COALESCE(course_expected,VALUES(course_expected))`,
              payBatchParams
            ).catch(e => logger.error('[payment-sync] batch', e.message));
          }
        } catch (syncErr) { logger.error('[payment-sync] subscriber', id, syncErr.message); }
      });
    }
    // Return the server-side updatedAt so the frontend can update OCC state
    const [[savedRow]] = await pool.query('SELECT updated_at FROM subscribers WHERE id = ? LIMIT 1', [id]).catch(() => [[null]]);
    const savedUpdatedAt = safeIsoString(savedRow?.updated_at) || new Date().toISOString();
    res.json({ ok: true, id, updatedAt: savedUpdatedAt, assignedCs: csId ? { id: csId, name: csName } : null });
    // Notify admins of new subscriber registration
    if (isNewSub) {
      createNotification('subscriber', '🎉 مشترك جديد', `${safeName || 'مشترك جديد'} انضم للمنصة`, { subscriberId: id, phone: safePhone }).catch(() => {});
    }
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY' && e.message.includes('email')) {
      return res.status(409).json({ error: `البريد الإلكتروني ${req.body.email} مسجل بالفعل` });
    }
    logger.error('[route]', e.message); sendRouteError(res, e);
  }
});

// POST /api/admin/leads
module.exports = router;
