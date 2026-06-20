'use strict';
const logger = require('../lib/logger');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool, autoAssignStaff, cacheInvalidate } = require('../lib/db');
const { mailer } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, parseCrm, calcLeadScoreServer } = require('../lib/helpers');
const { COURSE_COLS, mapCourse, getNextClientCode } = require('../lib/mappers');
const { createNotification } = require('../lib/notification');
const { logLeadEvent } = require('../lib/crm');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { ADMIN_EMAILS, requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { DATA_SCOPE, VALID_BRANCHES, VALID_PAY_TYPES, VALID_SOURCES } = require('../constants/permissions');
const { onlineMap } = require('../lib/onlineUsers');
const { safeIsoString, safeDateOnly } = require('../lib/dates');
const { keyset } = require('../lib/pagination');

// GET /api/admin/online-users — العملاء المتصلون الآن (آخر دقيقتين)
router.get('/api/admin/online-users', requireAuth, requireAdmin, (_req, res) => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  const users = [];
  for (const [uid, data] of onlineMap.entries()) {
    if (data.lastSeen >= cutoff) {
      users.push({ uid, name: data.name, email: data.email, lastActiveAt: new Date(data.lastSeen).toISOString() });
    }
  }
  res.json(users);
});

// GET /api/admin/courses?limit=500&offset=0  (كل الكورسات بما فيها غير المنشورة)
router.get('/api/admin/courses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 500, 1000);
    const offset = parseOffset(req.query.offset);
    const [rows] = await pool.query(
      `SELECT ${COURSE_COLS} FROM courses ORDER BY sort_order ASC, created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json(rows.map(mapCourse));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/courses
router.post('/api/admin/courses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const c = req.body;
    const id = c.id || uuidv4();
    // Support both camelCase (admin UI) and snake_case payloads
    const courseCode      = c.course_code      ?? c.courseCode      ?? null;
    const slug            = c.slug             || id;
    const titleEn         = c.title_en         ?? c.titleEn         ?? null;
    const titleAr         = c.title_ar         ?? c.titleAr         ?? null;
    const shortDesc       = c.short_description ?? c.shortDescription ?? '';
    const priceEGP        = c.price_egp        ?? c.price?.EGP      ?? 0;
    const priceSAR        = c.price_sar        ?? c.price?.SAR      ?? 0;
    const priceUSD        = c.price_usd        ?? c.price?.USD      ?? 0;
    const origEGP         = c.orig_price_egp   ?? c.originalPrice?.EGP ?? 0;
    const origSAR         = c.orig_price_sar   ?? c.originalPrice?.SAR ?? 0;
    const origUSD         = c.orig_price_usd   ?? c.originalPrice?.USD ?? 0;
    const promoUrl        = c.promo_video_url  ?? c.promoVideoUrl   ?? null;
    const liveUrl         = c.live_session_url ?? c.liveSessionUrl  ?? null;
    const certUrl         = c.certificate_template_url  ?? c.certificateTemplateUrl  ?? null;
    const certName        = c.certificate_template_name ?? c.certificateTemplateName ?? null;
    const seoTitle        = c.seo_title        ?? null;
    const seoDesc         = c.seo_description  ?? null;
    const seoKeywords     = c.seo_keywords     ?? null;
    const category        = c.category || 'GENERAL';
    const courseType      = c.type || 'RECORDED';
    const isPublished     = c.is_published     ?? c.isPublished     ?? false;
    const sortOrder       = c.sort_order       ?? c.sortOrder       ?? 0;
    const modulesJson     = c.modules_json     ?? (c.modules        != null ? JSON.stringify(c.modules)        : null);
    const galleryJson     = c.gallery_images_json ?? (c.galleryImages != null ? JSON.stringify(c.galleryImages) : null);
    const detailsJson     = c.details_content_json ?? (c.detailsContent != null ? JSON.stringify(c.detailsContent) : null);
    const courseModJson   = c.course_modules_json  ?? (c.courseModules  != null ? JSON.stringify(c.courseModules)  : null);

    await pool.query(
      `INSERT INTO courses
         (id, course_code, slug, title, title_en, title_ar,
          description, short_description, instructor, thumbnail,
          category, type,
          price_egp, price_sar, price_usd,
          orig_price_egp, orig_price_sar, orig_price_usd,
          rating, students, duration, level, hours,
          promo_video_url, live_session_url,
          certificate_template_url, certificate_template_name,
          is_published, sort_order,
          modules_json, gallery_images_json, details_content_json, course_modules_json,
          seo_title, seo_description, seo_keywords)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), title_en=VALUES(title_en), title_ar=VALUES(title_ar),
         description=VALUES(description), short_description=VALUES(short_description),
         instructor=VALUES(instructor), thumbnail=VALUES(thumbnail),
         category=VALUES(category), type=VALUES(type),
         course_code=VALUES(course_code), slug=VALUES(slug),
         price_egp=VALUES(price_egp), price_sar=VALUES(price_sar), price_usd=VALUES(price_usd),
         orig_price_egp=VALUES(orig_price_egp), orig_price_sar=VALUES(orig_price_sar), orig_price_usd=VALUES(orig_price_usd),
         rating=VALUES(rating), students=VALUES(students), duration=VALUES(duration),
         level=VALUES(level), hours=VALUES(hours),
         is_published=VALUES(is_published), sort_order=VALUES(sort_order),
         promo_video_url=VALUES(promo_video_url), live_session_url=VALUES(live_session_url),
         certificate_template_url=VALUES(certificate_template_url),
         certificate_template_name=VALUES(certificate_template_name),
         modules_json=VALUES(modules_json), gallery_images_json=VALUES(gallery_images_json),
         details_content_json=VALUES(details_content_json), course_modules_json=VALUES(course_modules_json),
         seo_title=VALUES(seo_title), seo_description=VALUES(seo_description), seo_keywords=VALUES(seo_keywords),
         updated_at=CURRENT_TIMESTAMP`,
      [
        id, courseCode, slug, c.title, titleEn, titleAr,
        c.description||'', shortDesc, c.instructor||'', c.thumbnail||'',
        category, courseType,
        priceEGP, priceSAR, priceUSD,
        origEGP, origSAR, origUSD,
        c.rating||0, c.students||0, c.duration||'', c.level||'', c.hours||null,
        promoUrl, liveUrl, certUrl, certName,
        isPublished?1:0, sortOrder,
        modulesJson, galleryJson, detailsJson, courseModJson,
        seoTitle, seoDesc, seoKeywords,
      ]
    );
    cacheInvalidate('courses', 'bundles');
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/courses/:id
router.delete('/api/admin/courses/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM courses WHERE id = ?', [req.params.id]);
    cacheInvalidate('courses', 'bundles');
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/subscribers?limit=500&offset=0
// Allow collection staff (and admins) to fetch all subscribers
router.get('/api/admin/subscribers', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 500, 5000);
    const offset = parseOffset(req.query.offset);
    // Exclude staff accounts and admin emails from the subscribers list
    const adminExclusions = ADMIN_EMAILS.length > 0
      ? `AND (s.email IS NULL OR LOWER(s.email) NOT IN (${ADMIN_EMAILS.map(() => '?').join(',')}))`
      : '';
    const [rows] = await pool.query(
      `SELECT s.*,
              COALESCE(ss.name, s.assigned_sales_name) AS assigned_sales_name,
              COALESCE(cs.name, s.assigned_cs_name)    AS assigned_cs_name
       FROM subscribers s
       LEFT JOIN staff ss ON ss.id = s.assigned_sales_id
       LEFT JOIN staff cs ON cs.id = s.assigned_cs_id
       WHERE NOT EXISTS (
         SELECT 1 FROM staff st WHERE LOWER(st.email) = LOWER(s.email) AND st.is_active = 1
       ) ${adminExclusions}
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [...ADMIN_EMAILS.map(e => e.toLowerCase()), limit, offset]
    );
    if (rows.length === 0) return res.json([]);

    // Batch-load payments from the payments table (authoritative source, one query for all)
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title, cert_type
       FROM payments WHERE subscriber_id IN (${placeholders}) ORDER BY \`date\` ASC`,
      ids
    );
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id,
        amount: Number(p.amount) || 0,
        currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(),
        paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null,
        isInstallment: !!p.is_installment,
        courseId: p.course_id || null,
        bundleId: p.bundle_id || null,
        note: p.note || null,
        at: dateStr,
        status: p.status || 'paid',
        staffId: p.staff_id || null,
        staffName: p.staff_name || null,
        fromAccountNumber: p.from_account || null,
        source: p.source || null,
        itemTitle: p.item_title || null,
        certType: p.cert_type || null,
        branch: p.branch || null,
      });
    });

    // Batch-load enrollments from the enrollments table (authoritative source)
    const [enrollRows] = await pool.query(
      `SELECT subscriber_id, course_id, bundle_id FROM enrollments WHERE subscriber_id IN (${placeholders})`,
      ids
    );
    const enrollBySub = {};
    enrollRows.forEach(e => {
      if (!enrollBySub[e.subscriber_id]) enrollBySub[e.subscriber_id] = [];
      const cid = e.course_id ? String(e.course_id) : (e.bundle_id ? `bundle:${e.bundle_id}` : null);
      if (cid) enrollBySub[e.subscriber_id].push(cid);
    });

    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      // client_code column is authoritative
      const clientCode = r.client_code || crm.clientCode || null;
      // payments table is authoritative; fall back to crm_json if no DB records found
      const paymentHistory = payBySubId[r.id] && payBySubId[r.id].length > 0
        ? payBySubId[r.id]
        : (crm.paymentHistory || []);
      // enrollments table is authoritative; merge with crm_json for backwards compat
      const enrolledCourseIds = [...new Set([
        ...(enrollBySub[r.id] || []),
        ...(Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds.map(String) : []),
      ])];
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at,
        ...crm,          // other CRM fields: courseAccess, installmentPlans, etc.
        enrolledCourseIds,  // merged from enrollments table + crm_json
        clientCode,      // authoritative
        paymentHistory,  // authoritative from payments table
        branch: (() => { const rb = r.branch || crm.branch || null; if (!rb) return null; const nb = rb.toUpperCase().replace(/[-\s]/g,'_'); return ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'].includes(nb) ? nb : rb; })(),
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        assignedCsId: r.assigned_cs_id || crm.assignedCsId || null,
        assignedCsName: r.assigned_cs_name || crm.assignedCsName || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/staff/subscribers
// UNIFIED endpoint — server scopes data automatically based on role.
// All staff roles call this ONE endpoint. The server decides what they see.
// Scoping rules are defined in api/constants/permissions.js → DATA_SCOPE.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/staff/subscribers', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const staffId  = req.staffRecord?.id;
    const role     = (req.staffRecord?.role || '').toLowerCase();
    const isSuper  = !!req.isSuperAdmin;
    const scope    = isSuper ? 'all' : (DATA_SCOPE[role] || 'assigned_sales');

    let whereClause = '1=1';
    const params    = [];

    if (scope === 'all') {
      // Full access — return everything (excluding staff/admin emails)
      whereClause = `NOT EXISTS (
        SELECT 1 FROM staff st WHERE LOWER(st.email) = LOWER(s.email) AND st.is_active = 1
      )`;
    } else if (scope === 'assigned_sales') {
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      whereClause = `(s.assigned_sales_id = ? OR (s.assigned_sales_id IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedSalesId')) = ?) OR (s.lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = s.lead_id AND l.assigned_sales_id = ?)))`;
      params.push(staffId, staffId, staffId);
    } else if (scope === 'assigned_cs') {
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      whereClause = `(s.assigned_cs_id = ? OR (s.crm_json IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedCollectionId')) = ?))`;
      params.push(staffId, staffId);
    } else if (scope.startsWith('branch:')) {
      const branch = scope.slice(7); // e.g. 'DAQQI'
      whereClause = `s.branch = ?`;
      params.push(branch);
    }

    const limit  = parseLimit(req.query.limit, 5000, 10000);
    const offset = parseOffset(req.query.offset || 0);
    params.push(limit, offset);

    const [rows] = await pool.query(
      `SELECT s.*,
              COALESCE(ss.name, s.assigned_sales_name) AS assigned_sales_name,
              COALESCE(cs.name, s.assigned_cs_name)    AS assigned_cs_name
       FROM subscribers s
       LEFT JOIN staff ss ON ss.id = s.assigned_sales_id
       LEFT JOIN staff cs ON cs.id = s.assigned_cs_id
       WHERE ${whereClause}
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    if (rows.length === 0) return res.json([]);

    const ids = rows.map(r => r.id);
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments WHERE subscriber_id IN (${ids.map(() => '?').join(',')}) ORDER BY \`date\` ASC`,
      ids
    );
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount)||0, currency: p.currency||'EGP',
        paymentType: (p.payment_type||'other').toLowerCase(), paymentMethod: p.payment_method||null,
        transactionId: p.transaction_id||null, isInstallment: !!p.is_installment,
        courseId: p.course_id||null, bundleId: p.bundle_id||null, note: p.note||null, at: dateStr,
        status: p.status||'paid', staffId: p.staff_id||null, staffName: p.staff_name||null,
        fromAccountNumber: p.from_account||null, source: p.source||null, itemTitle: p.item_title||null,
      });
    });

    // Batch-load enrollments from the enrollments table (authoritative source)
    const [staffEnrollRows] = await pool.query(
      `SELECT subscriber_id, course_id, bundle_id FROM enrollments WHERE subscriber_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const staffEnrollBySub = {};
    staffEnrollRows.forEach(e => {
      if (!staffEnrollBySub[e.subscriber_id]) staffEnrollBySub[e.subscriber_id] = [];
      const cid = e.course_id ? String(e.course_id) : (e.bundle_id ? `bundle:${e.bundle_id}` : null);
      if (cid) staffEnrollBySub[e.subscriber_id].push(cid);
    });

    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : (crm.paymentHistory || []);
      const enrolledCourseIds = [...new Set([
        ...(staffEnrollBySub[r.id] || []),
        ...(Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds.map(String) : []),
      ])];
      const rb = r.branch || crm.branch || null;
      const nb = rb ? rb.toUpperCase().replace(/[-\s]/g,'_') : null;
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at,
        ...crm,
        enrolledCourseIds,
        clientCode: r.client_code || crm.clientCode || null,
        paymentHistory,
        branch: (nb && VALID_BRANCHES.has(nb)) ? nb : rb,
        clientType: r.client_type || null,
        assignedSalesId:   r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        assignedCsId:      r.assigned_cs_id || crm.assignedCsId || null,
        assignedCsName:    r.assigned_cs_name || crm.assignedCsName || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[/api/staff/subscribers]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/staff/leads
// UNIFIED endpoint — server scopes leads automatically based on role.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/staff/leads', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    const role    = (req.staffRecord?.role || '').toLowerCase();
    const isSuper = !!req.isSuperAdmin;
    const scope   = isSuper ? 'all' : (DATA_SCOPE[role] || 'assigned_sales');

    // Roles that should NOT see leads at all
    const noLeadsRoles = new Set(['collection', 'accountant', 'trainer', 'instructor']);
    if (!isSuper && noLeadsRoles.has(role)) return res.json([]);

    let whereClause = 'hidden = 0';
    const params = [];

    if (scope === 'assigned_sales') {
      if (!staffId) return res.status(403).json({ error: 'Staff record required' });
      whereClause = 'hidden = 0 AND assigned_sales_id = ?';
      params.push(staffId);
    }
    // 'all' and branch scopes see all leads (with branch filter for Daqqi)
    else if (scope.startsWith('branch:')) {
      whereClause = 'hidden = 0'; // Daqqi staff see all leads for now
    }

    const limit  = parseLimit(req.query.limit, 5000, 20000);
    const offset = parseOffset(req.query.offset || 0);
    params.push(limit, offset);

    const [rows] = await pool.query(
      `SELECT * FROM leads WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    res.json(rows.map(r => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone,
      status: r.status, source: r.source, notes: r.notes,
      assignedSalesId: r.assigned_sales_id, assignedSalesName: r.assigned_sales_name,
      interestedCourseIds: tryJson(r.interested_course_ids, []),
      createdAt: r.created_at, updatedAt: r.updated_at,
      communications: tryJson(r.communications, []),
      nextFollowUpDate: r.next_follow_up_date,
      paidAmount: r.paid_amount, clientCode: r.client_code,
      hidden: !!r.hidden, branch: r.branch, clientType: r.client_type || null,
    })));
  } catch (e) { logger.error('[/api/staff/leads]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/my-subscribers — SALES staff fetch their own subscribers (assigned_sales_id = me)
router.get('/api/staff/my-subscribers', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    if (!staffId) return res.status(403).json({ error: 'Staff record not found' });

    const [rows] = await pool.query(
      `SELECT DISTINCT s.* FROM subscribers s
       LEFT JOIN leads l ON l.id = s.lead_id
       WHERE s.assigned_sales_id = ?
          OR (s.assigned_sales_id IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedSalesId')) = ?)
          OR (s.lead_id IS NOT NULL AND l.assigned_sales_id = ?)
       ORDER BY s.created_at DESC LIMIT 2000`,
      [staffId, staffId, staffId]
    );
    if (rows.length === 0) return res.json([]);

    // Auto-backfill: fix any rows that came via crm_json fallback (missing assigned_sales_id column)
    const toBackfill = rows.filter(r => !r.assigned_sales_id);
    if (toBackfill.length > 0) {
      // Fire-and-forget background update — don't block the response
      Promise.all(toBackfill.map(r => {
        const crm = parseCrm(r.crm_json);
        const salesName = crm.assignedSalesName || null;
        const rawBranch = r.branch || crm.branch || null;

        const normB = rawBranch ? rawBranch.toUpperCase().replace(/[-\s]/g,'_') : null;
        const branchVal = (normB && VALID_BRANCHES.has(normB)) ? normB : null;
        return pool.query(
          'UPDATE subscribers SET assigned_sales_id=?, assigned_sales_name=COALESCE(assigned_sales_name,?), branch=COALESCE(branch,?) WHERE id=?',
          [staffId, salesName, branchVal, r.id]
        ).catch(() => {});
      })).catch(() => {});
    }

    const ids = rows.map(r => r.id);
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments WHERE subscriber_id IN (${ids.map(() => '?').join(',')}) ORDER BY \`date\` ASC`,
      ids
    );
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(), paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        courseId: p.course_id || null, bundleId: p.bundle_id || null, note: p.note || null, at: dateStr,
        status: p.status || 'paid', staffId: p.staff_id || null,
        staffName: p.staff_name || null, fromAccountNumber: p.from_account || null,
        source: p.source || null, itemTitle: p.item_title || null,
      });
    });

    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      const clientCode = r.client_code || crm.clientCode || null;
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : (crm.paymentHistory || []);
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at, ...crm,
        enrolledCourseIds: Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds : [],
        clientCode, paymentHistory,
        branch: (() => { const rb = r.branch || crm.branch || null; if (!rb) return null; const nb = rb.toUpperCase().replace(/[-\s]/g,'_'); return ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'].includes(nb) ? nb : rb; })(),
        clientType: r.client_type || null,
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/my-collection-clients — collection staff fetch their own assigned subscribers
router.get('/api/staff/my-collection-clients', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const staffId = req.staffRecord?.id;
    if (!staffId) return res.status(403).json({ error: 'Staff record not found' });

    const [rows] = await pool.query(
      `SELECT DISTINCT s.* FROM subscribers s
       WHERE s.assigned_cs_id = ?
          OR ((s.assigned_cs_id IS NULL OR s.assigned_cs_id = '') AND s.assigned_cs_name = (SELECT name FROM staff WHERE id=? LIMIT 1))
          OR (s.crm_json IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedCollectionId')) = ?)
          OR ((s.assigned_cs_id IS NULL OR s.assigned_cs_id = '') AND s.crm_json IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, '$.assignedCollectionName')) = (SELECT name FROM staff WHERE id=? LIMIT 1))
       ORDER BY s.created_at DESC LIMIT 5000`,
      [staffId, staffId, staffId, staffId]
    );
    if (rows.length === 0) return res.json([]);

    const ids = rows.map(r => r.id);
    // Show ALL payments for assigned clients (not filtered by staff_id — client may have payments from multiple staff)
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments
       WHERE subscriber_id IN (${ids.map(() => '?').join(',')})
       ORDER BY \`date\` ASC`,
      ids
    );
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(), paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        courseId: p.course_id || null, bundleId: p.bundle_id || null, note: p.note || null, at: dateStr,
        status: p.status || 'paid', staffId: p.staff_id || null,
        staffName: p.staff_name || null, fromAccountNumber: p.from_account || null,
        source: p.source || null, itemTitle: p.item_title || null,
      });
    });

    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      const clientCode = r.client_code || crm.clientCode || null;
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : (crm.paymentHistory || []);
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at, ...crm,
        enrolledCourseIds: Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds : [],
        clientCode, paymentHistory,
        branch: (() => { const rb = r.branch || crm.branch || null; if (!rb) return null; const nb = rb.toUpperCase().replace(/[-\s]/g,'_'); return ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'].includes(nb) ? nb : rb; })(),
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        assignedCollectionId: r.assigned_cs_id || crm.assignedCollectionId || null,
        assignedCollectionName: r.assigned_cs_name || crm.assignedCollectionName || null,
        updatedAt: safeIsoString(r.updated_at) || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/my-daqqi-clients — reception_daqqi staff fetch subscribers with branch=DAQQI
router.get('/api/staff/my-daqqi-clients', requireAuth, requireAdminOrStaff, async (req, res) => {
  // SECURITY: only RECEPTION_DAQQI staff (or super-admins) may access this endpoint
  if (!req.isSuperAdmin) {
    const allowedRoles = new Set(['RECEPTION_DAQQI', 'DAQQI_MANAGER', 'ADMIN', 'MANAGER']);
    const staffRole = (req.staffRecord?.role || '').toUpperCase();
    if (!allowedRoles.has(staffRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
  }
  try {
    const [rows] = await pool.query(
      `SELECT s.* FROM subscribers s
       WHERE s.branch = 'DAQQI'
       ORDER BY s.created_at DESC LIMIT 5000`
    );
    if (rows.length === 0) return res.json([]);

    const ids = rows.map(r => r.id);
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title
       FROM payments
       WHERE subscriber_id IN (${ids.map(() => '?').join(',')})
       ORDER BY \`date\` ASC`,
      ids
    );
    const payBySubId = {};
    payRows.forEach(p => {
      if (!payBySubId[p.subscriber_id]) payBySubId[p.subscriber_id] = [];
      const dateStr = safeDateOnly(p.date);
      payBySubId[p.subscriber_id].push({
        id: p.id, amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(), paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        courseId: p.course_id || null, bundleId: p.bundle_id || null, note: p.note || null, at: dateStr,
        status: p.status || 'paid', staffId: p.staff_id || null, staffName: p.staff_name || null,
        fromAccountNumber: p.from_account || null, source: p.source || null, itemTitle: p.item_title || null,
      });
    });

    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      const clientCode = r.client_code || crm.clientCode || null;
      const paymentHistory = payBySubId[r.id]?.length > 0 ? payBySubId[r.id] : (crm.paymentHistory || []);
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        firebaseUid: r.firebase_uid, isActive: !!r.is_active,
        notes: r.notes, createdAt: r.created_at, ...crm,
        enrolledCourseIds: Array.isArray(crm.enrolledCourseIds) ? crm.enrolledCourseIds : [],
        clientCode, paymentHistory,
        branch: 'DAQQI',
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        assignedCsId: r.assigned_cs_id || crm.assignedCollectionId || null,
        assignedCsName: r.assigned_cs_name || crm.assignedCollectionName || null,
        status: crm.status || (r.is_active ? 'active' : 'inactive'),
        installmentPlans: crm.installmentPlans || [],
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/subscribers/:id/assign-collection — assign a subscriber to a collection staff
router.put('/api/admin/subscribers/:id/assign-collection', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const subId = req.params.id;
    const { collectionId, collectionName } = req.body || {};
    if (!subId) return res.status(400).json({ error: 'Missing subscriber id' });
    await pool.query(
      'UPDATE subscribers SET assigned_cs_id=?, assigned_cs_name=? WHERE id=?',
      [collectionId || null, collectionName || null, subId]
    );
    // Also update crm_json to keep in sync
    const [[row]] = await pool.query('SELECT crm_json FROM subscribers WHERE id=? LIMIT 1', [subId]);
    if (row) {
      const crm = tryJson(row.crm_json, {});
      crm.assignedCollectionId   = collectionId   || null;
      crm.assignedCollectionName = collectionName || null;
      await pool.query('UPDATE subscribers SET crm_json=? WHERE id=?', [JSON.stringify(crm), subId]);
    }
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/bulk-assign-collection — round-robin assign all unassigned subscribers to collection staff
router.post('/api/admin/bulk-assign-collection', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get all active collection staff
    const [csRows] = await pool.query(
      "SELECT id, name FROM staff WHERE role='COLLECTION' AND is_active=1 ORDER BY name"
    );
    if (csRows.length === 0) return res.status(400).json({ error: 'لا يوجد موظفو تحصيل نشطون' });

    // Get all subscribers with no assigned_cs_id (and not daqqi branch)
    const [unassigned] = await pool.query(
      "SELECT id FROM subscribers WHERE (assigned_cs_id IS NULL OR assigned_cs_id='') AND (branch IS NULL OR branch NOT LIKE '%DAQQI%') ORDER BY created_at ASC"
    );
    if (unassigned.length === 0) return res.json({ ok: true, assigned: 0, message: 'لا يوجد مشتركون غير معيّنون' });

    let idx = 0;
    let assigned = 0;
    // Batch in chunks of 100 for performance
    const CHUNK = 100;
    for (let i = 0; i < unassigned.length; i += CHUNK) {
      const chunk = unassigned.slice(i, i + CHUNK);
      await Promise.all(chunk.map(row => {
        const cs = csRows[idx % csRows.length];
        idx++;
        return pool.query(
          'UPDATE subscribers SET assigned_cs_id=?, assigned_cs_name=? WHERE id=?',
          [cs.id, cs.name, row.id]
        );
      }));
      assigned += chunk.length;
    }
    res.json({ ok: true, assigned, staffCount: csRows.length, staff: csRows.map(s => s.name) });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/client/:code — fetch ONE subscriber or lead by clientCode/id (staff-accessible)
// Sales staff can only see their own clients; admin sees any.
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
        clientCode, paymentHistory: paymentHistory.length > 0 ? paymentHistory : (crm.paymentHistory || []),
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
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
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
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
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
    const VALID_CLIENT_TYPES = new Set([
      'ONLINE_LOCAL_NEW','ONLINE_LOCAL_OLD','ONLINE_SAUDI_NEW','ONLINE_SAUDI_OLD',
      'ONLINE_ABROAD','DAQQI_NEW','DAQQI_OLD','QATAMIYA',
      'LEAD_LOCAL_NEW','LEAD_LOCAL_OLD','LEAD_INTL_NEW','LEAD_INTL_OLD']);
    const rawClientType = crmData.clientType || s.client_type || null;
    const clientTypeVal = (rawClientType && VALID_CLIENT_TYPES.has(rawClientType.toUpperCase())) ? rawClientType.toUpperCase() : (rawClientType || null);
    await pool.query(
      `INSERT INTO subscribers (id, firebase_uid, client_code, name, email, phone, is_active, notes,
         assigned_cs_id, assigned_cs_name, assigned_sales_id, assigned_sales_name, branch, client_type, crm_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), phone=COALESCE(VALUES(phone), phone), firebase_uid=COALESCE(VALUES(firebase_uid),firebase_uid),
         client_code=COALESCE(client_code, VALUES(client_code)),
         is_active=VALUES(is_active), notes=COALESCE(VALUES(notes),notes),
         assigned_cs_id=COALESCE(VALUES(assigned_cs_id), assigned_cs_id),
         assigned_cs_name=COALESCE(VALUES(assigned_cs_name), assigned_cs_name),
         assigned_sales_id=COALESCE(assigned_sales_id, VALUES(assigned_sales_id)),
         assigned_sales_name=COALESCE(assigned_sales_name, VALUES(assigned_sales_name)),
         branch=COALESCE(branch, VALUES(branch)),
         client_type=COALESCE(VALUES(client_type), client_type),
         crm_json=VALUES(crm_json)`,
      [id, firebaseUid || firebase_uid || null, code, safeName||'', safeEmail, safePhone, active?1:0,
       safeNotes||null, csId, csName, salesId, salesName, branchVal, clientTypeVal, JSON.stringify(crmData)]
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
          enrollInsertRows.push('(?, ?, ?, NOW(), ?, ?)');
          enrollInsertParams.push(uuidv4(), id, courseId, newAccessMode, newLectureLimit);
        } else if (existing.access_type !== newAccessMode || String(existing.lecture_limit ?? '') !== String(newLectureLimit ?? '')) {
          enrollUpdates.push(pool.query(
            'UPDATE enrollments SET access_type=?, lecture_limit=? WHERE id=?',
            [newAccessMode, newLectureLimit, existing.id]
          ).catch(() => {}));
        }
      }
      if (enrollInsertRows.length > 0) {
        await pool.query(
          `INSERT IGNORE INTO enrollments (id, subscriber_id, course_id, enrolled_at, access_type, lecture_limit) VALUES ${enrollInsertRows.join(',')}`,
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
            payBatchRows.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
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
            );
          }
          if (payBatchRows.length > 0) {
            await pool.query(
              `INSERT INTO payments
                 (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
                  payment_method, transaction_id, is_installment, course_expected, date, note, staff_id, status,
                  staff_name, from_account, source, item_title, cert_type)
               VALUES ${payBatchRows.join(',')}
               ON DUPLICATE KEY UPDATE status=VALUES(status), note=COALESCE(VALUES(note),note),
                 staff_name=COALESCE(VALUES(staff_name),staff_name),
                 from_account=COALESCE(VALUES(from_account),from_account),
                 source=COALESCE(VALUES(source),source),
                 item_title=COALESCE(VALUES(item_title),item_title),
                 cert_type=COALESCE(VALUES(cert_type),cert_type),
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
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/leads
router.post('/api/admin/leads', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const l = req.body;
    const id = l.id || uuidv4();
    // SALES staff can only update their OWN assigned leads (not reassign to others)
    if (req.staffRecord?.role === 'SALES') {
      // If this is an update (existing lead), verify ownership
      const [[ownCheck]] = await pool.query('SELECT assigned_sales_id FROM leads WHERE id = ? LIMIT 1', [id]);
      if (ownCheck && ownCheck.assigned_sales_id && ownCheck.assigned_sales_id !== req.staffRecord.id) {
        return res.status(403).json({ error: 'غير مصرح: يمكنك فقط تعديل الليدز المعيّنة لك' });
      }
    }
    // Extract base columns; store everything else in crm_json
    const { id: _id, name, email, phone, source, status, notes, hidden, createdAt, created_at, clientCode, client_code, ...crmData } = l;
    // Sanitize at system boundary
    const safeName   = sanitize(name,   300);
    const safeEmail  = (email  || '').toLowerCase().trim().substring(0, 255);
    const safePhone  = ((phone  || '').replace(/[^\d+\-\s()]/g, '').trim().substring(0, 30)) || null;
    const safeNotes  = sanitize(notes,  2000);
    const safeSource = sanitize(source, 200);
    // Auto-generate client_code for new leads if not provided
    let code = clientCode || client_code || null;
    // Fetch existing record FIRST (needed to decide if this is insert vs update)
    const [[existing]] = await pool.query('SELECT status, crm_json, assigned_sales_id FROM leads WHERE id = ?', [id]);
    const isNew = !existing;
    // Only check for duplicate phone when CREATING a new lead (not updating)
    if (isNew && safePhone) {
      // Check against subscribers first (phone already enrolled)
      const [[existSub]] = await pool.query(
        'SELECT id, name, client_code FROM subscribers WHERE phone=? LIMIT 1', [safePhone]
      );
      if (existSub) return res.status(409).json({
        error: `رقم الهاتف ${safePhone} مسجل بالفعل كمشترك (${existSub.name || ''})`,
        existingId: existSub.id,
        existingCode: existSub.client_code,
        type: 'subscriber',
      });
      const [[existLead]] = await pool.query(
        'SELECT id, name FROM leads WHERE phone=? AND id != ? AND hidden=0 LIMIT 1', [safePhone, id]
      );
      if (existLead) return res.status(409).json({
        error: `رقم الهاتف ${safePhone} مسجل بالفعل في العملاء المحتملين (${existLead.name || ''})`,
        existingId: existLead.id,
        type: 'lead',
      });
    }
    // Check for duplicate email on new lead
    if (isNew && safeEmail) {
      const [[existByEmail]] = await pool.query(
        'SELECT id, name FROM leads WHERE email=? AND id != ? AND hidden=0 LIMIT 1', [safeEmail, id]
      );
      if (existByEmail) return res.status(409).json({
        error: `البريد الإلكتروني مسجل بالفعل (${existByEmail.name || ''})`,
        existingId: existByEmail.id,
      });
    }
    // Auto-generate client_code for new leads
    if (isNew && !code) {
      const conn2 = await pool.getConnection();
      try { code = await getNextClientCode(conn2); } catch { /* ignore */ } finally { conn2.release(); }
    }
    // Auto-assign to sales on new lead if not already assigned
    let salesId   = crmData.assignedSalesId   || null;
    let salesName = crmData.assignedSalesName || null;
    if (isNew && !salesId) {
      const rep = await autoAssignStaff('SALES');
      if (rep) { salesId = rep.id; salesName = rep.name; crmData.assignedSalesId = rep.id; crmData.assignedSalesName = rep.name; }
    }
    const prevStatus = existing ? existing.status : null;
    const prevCrm = existing ? tryJson(existing.crm_json, {}) : {};
    const prevCommCount = (prevCrm.communications || []).length;
    const newCommCount  = (crmData.communications || []).length;

    // ── Merge crm_json instead of overwriting it ──────────────────────────
    // Two agents editing the same lead used to be last-write-wins on the WHOLE
    // blob — the slower save erased the other agent's logged communications.
    // We merge: scalar fields take the incoming value, communications are a
    // union of both sides (deduped by id, falling back to date+type+notes).
    let crmToStore = crmData;
    if (!isNew) {
      const commKey = (c) => c?.id || `${c?.date || ''}|${c?.type || ''}|${String(c?.notes || '').slice(0, 80)}`;
      const mergedComms = [];
      const seenComms = new Set();
      for (const c of [...(Array.isArray(prevCrm.communications) ? prevCrm.communications : []),
                       ...(Array.isArray(crmData.communications) ? crmData.communications : [])]) {
        const k = commKey(c);
        if (!seenComms.has(k)) { seenComms.add(k); mergedComms.push(c); }
      }
      crmToStore = { ...prevCrm, ...crmData, communications: mergedComms };
    }

    // Extract branch — accept any non-empty string (supports both legacy ENUM values and
    // dynamic institution branches configured via content['institute.branches']).
    // The leads.branch column is VARCHAR so no ENUM restriction needed here.
    const branchRaw = crmData.branch || null;
    const branchVal = branchRaw ? String(branchRaw).trim().substring(0, 100) : null;
    // Extract client_type for dedicated column
    const VALID_CLIENT_TYPES_LEAD = new Set([
      'ONLINE_LOCAL_NEW','ONLINE_LOCAL_OLD','ONLINE_SAUDI_NEW','ONLINE_SAUDI_OLD',
      'ONLINE_ABROAD','DAQQI_NEW','DAQQI_OLD','QATAMIYA',
      'LEAD_LOCAL_NEW','LEAD_LOCAL_OLD','LEAD_INTL_NEW','LEAD_INTL_OLD']);
    const rawLeadClientType = crmData.clientType || null;
    const leadClientTypeVal = (rawLeadClientType && VALID_CLIENT_TYPES_LEAD.has(rawLeadClientType.toUpperCase())) ? rawLeadClientType.toUpperCase() : (rawLeadClientType || null);
    // Extract interestedCourseIds for dedicated column
    const courseIdsJson = Array.isArray(crmData.interestedCourseIds) && crmData.interestedCourseIds.length
      ? JSON.stringify(crmData.interestedCourseIds) : null;

    await pool.query(
      `INSERT INTO leads (id, client_code, name, email, phone, source, status, notes, hidden,
         assigned_sales_id, assigned_sales_name, crm_json, branch, client_type, interested_course_ids_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), status=VALUES(status), notes=COALESCE(VALUES(notes),notes),
         client_code=COALESCE(client_code, VALUES(client_code)),
         assigned_sales_id=IF(VALUES(assigned_sales_id) IS NOT NULL, VALUES(assigned_sales_id), assigned_sales_id),
         assigned_sales_name=IF(VALUES(assigned_sales_id) IS NOT NULL, VALUES(assigned_sales_name), assigned_sales_name),
         crm_json=VALUES(crm_json),
         branch=IF(VALUES(branch) IS NOT NULL AND VALUES(branch) != '', VALUES(branch), branch),
         client_type=COALESCE(VALUES(client_type), client_type),
         interested_course_ids_json=COALESCE(VALUES(interested_course_ids_json), interested_course_ids_json)`,
      [id, code, safeName||'', safeEmail||'', safePhone||null, safeSource||null, (status||'new').toLowerCase(),
       safeNotes||null, hidden||0, salesId, salesName, JSON.stringify(crmToStore), branchVal, leadClientTypeVal, courseIdsJson]
    );
    // Update persisted score after every save
    const newScore = calcLeadScoreServer(
      status, crmData.interestLevel,
      crmData.communications, crmData.nextFollowUpDate, crmData.interestedCourseIds,
      crmData.createdAt || new Date().toISOString()
    );
    pool.query('UPDATE leads SET score = ? WHERE id = ?', [newScore, id]).catch(() => {});

    // ── Log timeline events ────────────────────────────────────────────────
    const normalizedNew = (status || 'new').toLowerCase();
    const normalizedPrev = (prevStatus || '').toLowerCase();
    if (isNew) {
      await logLeadEvent(id, 'created', `تم إضافة الليد من: ${source || 'غير محدد'}`, { source, status: normalizedNew, name, phone });
      if (salesId) await logLeadEvent(id, 'assigned', `تعيين تلقائي للمبيعات: ${salesName || salesId}`, { salesId, salesName, auto: true });
      // Automation #4: Auto-set follow-up date to +2 days if none specified
      if (!crmData.nextFollowUpDate) {
        const followUpDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        pool.query('UPDATE leads SET next_follow_up_date=? WHERE id=? AND next_follow_up_date IS NULL', [followUpDate, id]).catch(() => {});
        await logLeadEvent(id, 'followup_set', `موعد متابعة تلقائي: ${followUpDate}`, { date: followUpDate, auto: true });
      }
      // Notify assigned sales staff (or all admins) of new lead
      createNotification('lead', '📋 ليد جديد',
        `${safeName || 'مجهول'} — ${safeSource || 'بدون مصدر'}${safePhone ? ' | ' + safePhone : ''}`,
        { leadId: id, assignedSalesId: salesId }
      ).catch(() => {});
    } else {
      // Status changed?
      if (normalizedPrev && normalizedPrev !== normalizedNew) {
        const STATUS_AR = { new:'جديد', contacted:'تم التواصل', interested:'مهتم', not_interested:'غير مهتم', no_answer:'لا جواب', closed:'مغلق', converted:'تحوّل لعميل', lost:'خسرنا' };
        await logLeadEvent(id, 'status_changed', `تغيير الحالة: ${STATUS_AR[normalizedPrev] || normalizedPrev} ← ${STATUS_AR[normalizedNew] || normalizedNew}`, { from: normalizedPrev, to: normalizedNew });
      }
      // New communication added?
      if (newCommCount > prevCommCount) {
        const added = (crmData.communications || []).slice(-1)[0];
        const TYPE_AR = { call:'مكالمة', whatsapp:'واتساب', email:'إيميل', meeting:'اجتماع', note:'ملاحظة', payment_followup:'متابعة دفع', new_course_sale:'بيع كورس', certificate:'شهادة' };
        await logLeadEvent(id, 'communication', `تواصل جديد: ${TYPE_AR[added?.type] || added?.type || '؟'}${added?.notes ? ' — ' + added.notes.slice(0, 80) : ''}`, { type: added?.type, notes: added?.notes, outcome: added?.outcome });
      }
      // Assignment changed?
      if (crmData.assignedSalesId && crmData.assignedSalesId !== prevCrm.assignedSalesId) {
        await logLeadEvent(id, 'assigned', `تعيين لـ: ${crmData.assignedSalesName || crmData.assignedSalesId}`, { salesId: crmData.assignedSalesId, salesName: crmData.assignedSalesName });
        createNotification('lead', '👤 تعيين ليد',
          `${safeName || 'ليد'} تم تعيينه لـ: ${crmData.assignedSalesName || crmData.assignedSalesId}`,
          { leadId: id, assignedSalesId: crmData.assignedSalesId, assignedSalesName: crmData.assignedSalesName }
        ).catch(() => {});
      }
      // Follow-up date set/changed?
      if (crmData.nextFollowUpDate && crmData.nextFollowUpDate !== prevCrm.nextFollowUpDate) {
        await logLeadEvent(id, 'followup_set', `موعد متابعة: ${crmData.nextFollowUpDate}`, { date: crmData.nextFollowUpDate });
      }
    }

    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── POST /api/admin/import/daqqi — bulk import subscribers + enrollments + payments for DAQQI branch ──
router.post('/api/admin/import/daqqi', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    if (req.staffRecord?.role === 'SALES') return res.status(403).json({ error: 'غير مصرح' });
    const { rows, dryRun } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'لا توجد بيانات للاستيراد' });

    const VALID_NATIONALITY = ['EGYPTIAN','NON_EGYPTIAN_EGYPT','SAUDI_RESIDENT','INTERNATIONAL'];
    const VALID_CURRENCY    = ['EGP','SAR','USD'];
    const VALID_METHOD      = ['CASH','VODAFONE_CASH','INSTAPAY','BANK_TRANSFER','ONLINE','PAYMOB','CHECK','OTHER'];

    // Helper: get next client code for DAQQI (DQ-XXXX)
    const getNextDaqqiCode = async (conn) => {
      const [[row]] = await conn.query(
        `SELECT client_code FROM subscribers WHERE client_code REGEXP '^DQ-[0-9]+$'
         ORDER BY CAST(SUBSTRING(client_code,4) AS UNSIGNED) DESC LIMIT 1`
      );
      if (row?.client_code) {
        const num = parseInt(row.client_code.replace('DQ-',''), 10);
        return `DQ-${String(num+1).padStart(4,'0')}`;
      }
      return 'DQ-0001';
    };

    const stats    = { total: rows.length, newSubscribers: 0, existingSubscribers: 0, newEnrollments: 0, newPayments: 0, errors: [] };
    const results  = [];
    const conn     = await pool.getConnection();

    try {
      for (const r of rows) {
        const name  = sanitize(String(r.name  || '').trim(), 255);
        const email = String(r.email || '').toLowerCase().trim().substring(0,255);
        const phone = String(r.phone || '').replace(/[^\d+]/g,'').substring(0,30) || null;

        if (!name || !email || !phone || !email.includes('@')) {
          stats.errors.push(`سطر "${r.name || '?'}": بيانات ناقصة أو غير صحيحة`);
          results.push({ ...r, _status: 'error', _msg: 'بيانات ناقصة' });
          continue;
        }

        const nationalId  = r.national_id ? String(r.national_id).substring(0,50) : null;
        const whatsapp    = r.whatsapp ? String(r.whatsapp).replace(/[^\d+]/g,'').substring(0,30) : phone;
        const natRaw      = String(r.nationality || '').toUpperCase();
        const nationality = VALID_NATIONALITY.includes(natRaw) ? natRaw : 'EGYPTIAN';
        const notes       = r.notes ? sanitize(String(r.notes),1000) : null;
        const discount    = r.discount ? parseFloat(r.discount) : null;
        const createdAt   = r.enrollment_date || r.created_at || new Date().toISOString().slice(0,10);

        const courseId      = r.course_id     ? String(r.course_id).trim()     : null;
        const payAmount     = r.payment_amount ? parseFloat(r.payment_amount) : 0;
        const payCurRaw     = String(r.payment_currency || 'EGP').toUpperCase();
        const payCurrency   = VALID_CURRENCY.includes(payCurRaw) ? payCurRaw : 'EGP';
        const payMethodRaw  = String(r.payment_method || 'CASH').toUpperCase();
        const payMethod     = VALID_METHOD.includes(payMethodRaw) ? payMethodRaw : 'CASH';
        const payDate       = r.payment_date || createdAt;
        const transactionId = r.transaction_id ? String(r.transaction_id).substring(0,255) : null;
        const isInstallment = r.is_installment === '1' || r.is_installment === 1 ? 1 : 0;
        const payNote       = r.payment_note ? sanitize(String(r.payment_note),500) : notes;
        const courseExpected= r.course_expected ? parseFloat(r.course_expected) : payAmount;

        // Find or create subscriber
        let subscriberId, clientCode, isNew = false;
        const [[existing]] = await conn.query(
          'SELECT id, client_code FROM subscribers WHERE email=? OR phone=? LIMIT 1',
          [email, phone]
        );

        if (existing) {
          subscriberId = existing.id;
          clientCode   = existing.client_code;
          stats.existingSubscribers++;
        } else {
          subscriberId = uuidv4();
          clientCode   = await getNextDaqqiCode(conn);
          isNew        = true;
          if (!dryRun) {
            await conn.query(
              `INSERT INTO subscribers (id,client_code,name,email,phone,national_id,whatsapp,nationality,branch,discount,is_active,notes,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
              [subscriberId,clientCode,name,email,phone,nationalId,whatsapp,nationality,'DAQQI',discount,notes,createdAt]
            );
          }
          stats.newSubscribers++;
        }

        // Enrollment
        let enrollStatus = 'skipped';
        if (courseId) {
          const [[courseExists]] = await conn.query('SELECT id FROM courses WHERE id=? LIMIT 1',[courseId]);
          if (!courseExists) {
            stats.errors.push(`سطر "${name}": course_id="${courseId}" غير موجود`);
          } else {
            if (!dryRun) {
              await conn.query(
                `INSERT INTO enrollments (id,subscriber_id,course_id,enrolled_at,access_type) VALUES (?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE access_type=VALUES(access_type)`,
                [uuidv4(),subscriberId,courseId,createdAt,'FULL']
              );
            }
            stats.newEnrollments++;
            enrollStatus = 'ok';
          }
        }

        // Payment
        let payStatus = 'skipped';
        if (payAmount > 0) {
          if (!dryRun) {
            await conn.query(
              `INSERT INTO payments (id,subscriber_id,course_id,amount,currency,payment_type,payment_method,transaction_id,is_installment,course_expected,date,note,status)
               VALUES (?,?,?,?,?,'COURSE',?,?,?,?,?,?,'paid')`,
              [uuidv4(),subscriberId,courseId||null,payAmount,payCurrency,payMethod,transactionId,isInstallment,courseExpected,payDate,payNote]
            );
          }
          stats.newPayments++;
          payStatus = 'ok';
        }

        results.push({
          name, email, phone, clientCode,
          _status: 'ok',
          _isNew: isNew,
          _enrollStatus: enrollStatus,
          _payStatus: payStatus,
          _payAmount: payAmount,
          _payCurrency: payCurrency,
        });
      }
    } finally {
      conn.release();
    }

    res.json({ ok: true, dryRun: !!dryRun, stats, results });
  } catch (e) { logger.error('[import/daqqi]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/leads/bulk-assign — assign all unassigned NEW/INTERESTED leads to sales round-robin
router.post('/api/admin/leads/bulk-assign', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    if (req.staffRecord?.role === 'SALES') return res.status(403).json({ error: 'غير مصرح' });
    const { statusFilter } = req.body || {};
    // Get all active sales reps
    const [reps] = await pool.query(
      `SELECT id, name FROM staff WHERE role = 'SALES' AND is_active = 1 ORDER BY name ASC`
    );
    if (!reps.length) return res.status(400).json({ error: 'لا يوجد مندوبو مبيعات نشطون' });

    // Get unassigned leads (excluding converted/lost/hidden)
    const statusIn = statusFilter ? [statusFilter] : ['new', 'interested', 'NEW', 'INTERESTED'];
    const placeholders = statusIn.map(() => '?').join(',');
    const [unassigned] = await pool.query(
      `SELECT id FROM leads WHERE (assigned_sales_id IS NULL OR assigned_sales_id = '') AND status IN (${placeholders}) AND hidden = 0`,
      statusIn
    );

    if (!unassigned.length) return res.json({ assigned: 0, message: 'لا يوجد ليدز غير معيّنة' });

    // Round-robin assignment using current RR index
    const [rrRows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'crm_rr_index' LIMIT 1");
    let idx = parseInt(rrRows[0]?.value || '0', 10) || 0;

    const updates = unassigned.map((lead, i) => {
      const rep = reps[(idx + i) % reps.length];
      return { id: lead.id, salesId: rep.id, salesName: rep.name };
    });

    // Batch update via CASE WHEN for efficiency
    const BATCH = 500;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      if (!batch.length) continue;
      const caseId   = batch.map(u => `WHEN id = ? THEN ?`).join(' ');
      const caseName = batch.map(u => `WHEN id = ? THEN ?`).join(' ');
      const ids      = batch.map(u => u.id);
      const valId    = batch.flatMap(u => [u.id, u.salesId]);
      const valName  = batch.flatMap(u => [u.id, u.salesName]);
      await pool.query(
        `UPDATE leads SET assigned_sales_id = CASE ${caseId} END, assigned_sales_name = CASE ${caseName} END WHERE id IN (${ids.map(() => '?').join(',')})`,
        [...valId, ...valName, ...ids]
      );
    }

    // Update RR index
    await pool.query(
      "INSERT INTO site_config (`key`,`value`) VALUES ('crm_rr_index',?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [String(idx + unassigned.length)]
    );

    res.json({ assigned: unassigned.length, reps: reps.length, message: `تم توزيع ${unassigned.length} ليد على ${reps.length} مندوب` });
  } catch (e) { logger.error('[bulk-assign]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/leads/bulk-whatsapp — send WhatsApp message to multiple leads
// Body: { lead_ids: string[], message: string }
router.post('/api/admin/leads/bulk-whatsapp', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { lead_ids, message } = req.body || {};
    if (!Array.isArray(lead_ids) || lead_ids.length === 0) return res.status(400).json({ error: 'lead_ids required' });
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });
    if (lead_ids.length > 200) return res.status(400).json({ error: 'Maximum 200 leads per batch' });

    const placeholders = lead_ids.map(() => '?').join(',');
    const [leads] = await pool.query(
      `SELECT id, name, phone FROM leads WHERE id IN (${placeholders}) AND phone IS NOT NULL AND phone != '' AND hidden = 0`,
      lead_ids
    );

    let sent = 0, failed = 0;
    for (const lead of leads) {
      const personalised = message.replace(/\{\{name\}\}/g, lead.name || '').replace(/\{\{phone\}\}/g, lead.phone || '');
      const result = await sendWhatsApp(lead.phone, personalised).catch(() => ({ ok: false }));
      if (result.ok) {
        sent++;
        // Log as communication
        await pool.query(
          `INSERT IGNORE INTO communications (id, lead_id, type, date, notes, outcome)
           VALUES (UUID(), ?, 'whatsapp', CURDATE(), ?, 'sent')`,
          [lead.id, `[Bulk WA] ${personalised.slice(0, 200)}`]
        ).catch(() => {});
      } else { failed++; }
      // Small delay to avoid API rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    res.json({ ok: true, sent, failed, total: leads.length });
  } catch (e) { logger.error('[bulk-whatsapp]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/leads/dedup-cleanup — delete duplicate leads (leads matching subscriber phones + dup-phone leads)
router.post('/api/admin/leads/dedup-cleanup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const normPhone = (p) => (p || '').replace(/\D/g, '').replace(/^00/, '').replace(/^20/, '').replace(/^0/, '');

    // Load all subscribers' phones (normalized)
    const [subs] = await pool.query('SELECT phone FROM subscribers WHERE phone IS NOT NULL AND phone != ""');
    const subPhoneSet = new Set(subs.map(s => normPhone(s.phone)).filter(p => p.length >= 7));

    // Load all leads ordered oldest-first (so we keep the oldest when deduping)
    const [leads] = await pool.query(
      'SELECT id, phone FROM leads WHERE hidden = 0 ORDER BY created_at ASC'
    );

    const toDelete = new Set();

    // a) Leads whose phone matches a subscriber (converted but not cleaned)
    for (const lead of leads) {
      const lp = normPhone(lead.phone);
      if (lp.length >= 7 && subPhoneSet.has(lp)) toDelete.add(lead.id);
    }

    // b) Duplicate-phone leads (keep oldest = first seen per phone, delete the rest)
    const seenPhones = new Map();
    for (const lead of leads) {
      if (toDelete.has(lead.id)) continue;
      const lp = normPhone(lead.phone);
      if (lp.length >= 7) {
        if (seenPhones.has(lp)) toDelete.add(lead.id);
        else seenPhones.set(lp, lead.id);
      }
    }

    const ids = [...toDelete];
    if (ids.length > 0) {
      // Delete in batches of 500
      for (let i = 0; i < ids.length; i += 500) {
        const batch = ids.slice(i, i + 500);
        await pool.query(`DELETE FROM leads WHERE id IN (${batch.map(() => '?').join(',')})`, batch);
      }
    }

    res.json({ ok: true, deleted: ids.length });
  } catch (e) { logger.error('[dedup-cleanup]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/leads/:id/timeline
router.get('/api/admin/leads/:id/timeline', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    // SALES staff can only see timeline for their own leads
    if (req.staffRecord?.role === 'SALES') {
      const [[lead]] = await pool.query('SELECT assigned_sales_id FROM leads WHERE id = ? LIMIT 1', [req.params.id]);
      if (!lead || lead.assigned_sales_id !== req.staffRecord.id) {
        return res.status(403).json({ error: 'غير مصرح' });
      }
    }
    const [rows] = await pool.query(
      'SELECT id, lead_id, event_type, description, meta_json, at FROM lead_timeline WHERE lead_id = ? ORDER BY at ASC LIMIT 200',
      [req.params.id]
    );
    res.json(rows.map(r => ({
      id: r.id,
      leadId: r.lead_id,
      eventType: r.event_type,
      description: r.description,
      meta: tryJson(r.meta_json, {}),
      at: r.at,
    })));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/leads/:id/convert — تحويل ليد إلى مشترك تلقائياً
// ══════════════════════════════════════════════════════════════════════════════
router.post('/api/admin/leads/:id/convert', requireAuth, requireAdminOrStaff, requirePermission('manage_leads'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const leadId = req.params.id;
    // 1. Fetch lead
    const [[lead]] = await conn.query(
      `SELECT id, client_code, name, email, phone, source, status, lead_type, branch,
       interest_level, interested_course_ids_json, enrolled_course_id, deal_value,
       assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name,
       notes, last_follow_up, next_follow_up_date, crm_json, hidden, score, created_at
       FROM leads WHERE id=? AND hidden=0 LIMIT 1`, [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // 2. Check already converted — return existing subscriber if matched
    const [[existingSub]] = await conn.query(
      `SELECT id FROM subscribers WHERE lead_id=? OR LOWER(TRIM(email))=LOWER(?) LIMIT 1`,
      [leadId, lead.email || '']
    );
    if (existingSub) {
      // Mark lead as CONVERTED if not already
      await conn.query("UPDATE leads SET status='converted' WHERE id=? AND LOWER(status) NOT IN ('converted','lost')", [leadId]);
      return res.json({ ok: true, subscriber_id: existingSub.id, already_existed: true });
    }

    // 3. Validate required fields
    if (!lead.email || !lead.name) {
      return res.status(400).json({ error: 'يجب أن يكون للليد بريد إلكتروني واسم قبل التحويل' });
    }

    await conn.beginTransaction();

    // 4. Generate subscriber ID + ensure client_code
    const subId = uuidv4();
    let clientCode = lead.client_code || null;
    if (!clientCode) {
      try { clientCode = await getNextClientCode(conn); } catch (_) {}
    }

    // 4b. Create user account so the subscriber can log in
    const normEmail = lead.email.toLowerCase().trim();
    let tempPass = null;
    let isNewUser = false;
    const [[existingUser]] = await conn.query('SELECT id FROM users WHERE LOWER(TRIM(email))=? LIMIT 1', [normEmail]);
    if (!existingUser) {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      tempPass = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const hash = await bcrypt.hash(tempPass, 12);
      await conn.query(
        'INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?,?,?,?,?,1)',
        [uuidv4(), normEmail, hash, sanitize(lead.name, 300), 'user']
      );
      isNewUser = true;
    }

    // 5. Resolve collection staff
    let csId = lead.assigned_cs_id || null;
    let csName = lead.assigned_cs_name || null;
    if (!csId) {
      const rep = await autoAssignStaff('COLLECTION');
      if (rep) { csId = rep.id; csName = rep.name; }
    }

    // 6. Map lead → subscriber fields

    const branch = (lead.branch && VALID_BRANCHES.has(lead.branch)) ? lead.branch : null;

    // Build crm_json from lead fields
    const crmJson = {
      source: lead.source || null,
      leadType: lead.lead_type || null,
      interestLevel: lead.interest_level || null,
      assignedSalesId:   lead.assigned_sales_id   || null,
      assignedSalesName: lead.assigned_sales_name || null,
      assignedCollectionId:   csId,
      assignedCollectionName: csName,
      notes: lead.notes || null,
      interestedCourseIds: (() => {
        try { return JSON.parse(lead.interested_course_ids_json || '[]'); } catch { return []; }
      })(),
      enrolledCourseIds: lead.enrolled_course_id ? [lead.enrolled_course_id] : [],
      paymentHistory: [],
      convertedFromLeadId: leadId,
      convertedAt: new Date().toISOString(),
    };

    // 7. Insert subscriber
    await conn.query(
      `INSERT INTO subscribers
         (id, client_code, lead_id, name, email, phone, is_active,
          branch, assigned_sales_id, assigned_sales_name,
          assigned_cs_id, assigned_cs_name, notes, crm_json,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,NOW(),NOW())`,
      [
        subId, clientCode, leadId,
        sanitize(lead.name, 300),
        normEmail,
        ((lead.phone || '').replace(/[^\d+\-\s()]/g, '').trim().substring(0, 30)) || null,
        branch,
        lead.assigned_sales_id || null, lead.assigned_sales_name || null,
        csId, csName,
        sanitize(lead.notes, 2000) || null,
        JSON.stringify(crmJson),
      ]
    );

    // 8. Auto-enroll in enrolled_course_id if present
    if (lead.enrolled_course_id) {
      await conn.query(
        `INSERT IGNORE INTO enrollments (id, subscriber_id, course_id, enrolled_at, access_type)
         VALUES (UUID(),?,?,NOW(),'full')`,
        [subId, lead.enrolled_course_id]
      ).catch(() => {});
    }

    // 9. Mark lead as CONVERTED and link to subscriber
    await conn.query(
      "UPDATE leads SET status='converted', updated_at=NOW() WHERE id=?",
      [leadId]
    );

    // 10. Log timeline event
    await logLeadEvent(leadId, 'converted',
      `تم تحويله إلى مشترك — كود: ${clientCode || subId}`,
      { subscriber_id: subId, converted_by: req.user?.email || 'admin' }
    ).catch(() => {});

    // 11. Log activity
    await conn.query(
      'INSERT INTO activity_logs (id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?)',
      [uuidv4(), 'lead_converted', 'leads', leadId,
       `تحويل ليد → مشترك: ${lead.name}`, req.user?.email || 'admin']
    ).catch(() => {});

    await conn.commit();
    conn.release();

    // 12. Post-commit: send WhatsApp welcome + enqueue registration sequence
    if (lead.phone) {
      sendWhatsApp(lead.phone.replace(/\D/g, ''),
        `أهلاً ${lead.name} 🎉\nتم تفعيل اشتراكك في معهد مهاد للدراسات النفسية.\nيسعدنا انضمامك لأسرتنا. 💚`
      ).catch(() => {});
    }
    if (lead.email) {
      enqueueEmailSequence('enrollment', lead.email.toLowerCase(), lead.name, Date.now()).catch(() => {});
    }
    // Send login credentials email if new user account was created
    if (isNewUser && tempPass) {
      mailer.sendMail({
        from: `"معهد الدراسات النفسية" <${process.env.SMTP_USER || 'info@mahadnafsy.com'}>`,
        to: normEmail,
        subject: 'تم تفعيل حسابك — معهد الدراسات النفسية',
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#7c3aed;text-align:center;">معهد الدراسات النفسية</h2>
          <p>مرحباً <strong>${lead.name}</strong>،</p>
          <p>يسعدنا إبلاغك بأنه تم تحويلك إلى مشترك فعّال في منصتنا. إليك بيانات الدخول:</p>
          <div style="background:#f5f3ff;border:2px solid #7c3aed;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
            <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">البريد الإلكتروني</p>
            <strong style="color:#1f2937;">${normEmail}</strong>
            <p style="margin:12px 0 6px;color:#6b7280;font-size:13px;">كلمة المرور المؤقتة</p>
            <span style="font-family:monospace;font-size:26px;font-weight:bold;color:#7c3aed;letter-spacing:4px;">${tempPass}</span>
          </div>
          <p>يرجى تغيير كلمة المرور بعد أول تسجيل دخول.</p>
          <a href="https://mahadnafsy.com/login" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:bold;">الدخول للمنصة ←</a>
          <p style="color:#9ca3af;font-size:12px;margin-top:24px;">معهد الدراسات النفسية — mahadnafsy.com</p>
        </div>`,
      }).catch(e => logger.warn('[lead-convert] credentials email failed:', e.message));
    }
    createNotification('subscriber', '🎉 تحويل ليد → مشترك',
      `${lead.name} تم تحويله من ليد إلى مشترك`,
      { subscriberId: subId, leadId }
    ).catch(() => {});

    res.json({ ok: true, subscriber_id: subId, client_code: clientCode, already_existed: false });
  } catch (e) {
    await conn.rollback().catch(() => {});
    conn.release();
    logger.error('[lead-convert]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/migrate-branches — one-time migration to normalize old branch values

// GET /api/admin/leads?limit=500&offset=0
router.get('/api/admin/leads', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 500, 5000);
    const offset = parseOffset(req.query.offset);
    // Role-based visibility:
    //   SALES     → only their assigned leads (assigned_sales_id)
    //   COLLECTION → only leads where their subscriber is linked (assigned_cs_id on leads, via subscriber join)
    //   Others (MANAGER, ADMIN, DAQQI_MANAGER, ACCOUNTANT) → all leads
    let sql = `SELECT l.id, l.client_code, l.name, l.email, l.phone, l.source, l.status, l.lead_type, l.branch,
      l.interest_level, l.interested_course_ids_json, l.enrolled_course_id, l.deal_value,
      l.assigned_sales_id, COALESCE(ss.name, l.assigned_sales_name) AS assigned_sales_name,
      l.assigned_cs_id, COALESCE(cs.name, l.assigned_cs_name) AS assigned_cs_name,
      l.notes, l.last_follow_up, l.next_follow_up_date, l.crm_json, l.hidden, l.score, l.created_at, l.updated_at
      FROM leads l
      LEFT JOIN staff ss ON ss.id = l.assigned_sales_id
      LEFT JOIN staff cs ON cs.id = l.assigned_cs_id
      WHERE l.hidden = 0`;
    const params = [];
    const role = (req.staffRecord?.role || '').toUpperCase();
    if (req.staffRecord && !req.isSuperAdmin) {
      if (role === 'SALES') {
        sql += ' AND l.assigned_sales_id = ?';
        params.push(req.staffRecord.id);
      } else if (role === 'COLLECTION' || role === 'CS') {
        // COLLECTION staff see leads whose linked subscriber is assigned to them
        sql += ' AND l.id IN (SELECT lead_id FROM subscribers WHERE assigned_cs_id = ? AND lead_id IS NOT NULL)';
        params.push(req.staffRecord.id);
      }
      // MANAGER / ACCOUNTANT / DAQQI_MANAGER see all — no additional filter
    }
    // Cursor (keyset) pagination — opt-in via ?cursor=, falls back to offset.
    let nextCursorFn = null;
    if (req.query.cursor) {
      const ks = keyset(req.query, { col: 'l.created_at', idCol: 'l.id', limit, maxLimit: 5000 });
      sql += ` AND ${ks.where} ORDER BY l.created_at DESC, l.id DESC LIMIT ?`;
      params.push(...ks.params, ks.limit);
      nextCursorFn = ks.nextCursor;
    } else {
      sql += ' ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    const [rows] = await pool.query(sql, params);
    if (nextCursorFn) { const nc = nextCursorFn(rows); if (nc) res.set('X-Next-Cursor', nc); }
    res.json(rows.map(r => {
      const crm = parseCrm(r.crm_json);
      // client_code column is authoritative; crm_json clientCode is a fallback
      const clientCode = r.client_code || crm.clientCode || null;
      // Normalize status to lowercase (schema stores ENUM as uppercase: 'NEW','CONVERTED', etc.)
      const status = (r.status || 'new').toLowerCase();
      // DB columns take precedence over crm_json values for branch and interestedCourseIds
      const rawBranch = r.branch || crm.branch || null;

      const normB = rawBranch ? rawBranch.toUpperCase().replace(/[-\s]/g,'_') : null;
      const branch = (normB && VALID_BRANCHES.has(normB)) ? normB : rawBranch;
      const interestedCourseIds = tryJson(r.interested_course_ids_json, crm.interestedCourseIds || []);
      const dealValue = r.deal_value != null ? Number(r.deal_value) : (crm.dealValue || null);
      // crm_json spread goes FIRST so explicit DB columns always win
      return { ...crm,
        id: r.id, name: r.name, email: r.email, phone: r.phone,
        source: r.source, status, notes: r.notes, createdAt: r.created_at,
        branch, interestedCourseIds, clientCode, dealValue,
        assignedSalesId: r.assigned_sales_id || crm.assignedSalesId || null,
        assignedSalesName: r.assigned_sales_name || crm.assignedSalesName || null,
        assignedCsId: r.assigned_cs_id || crm.assignedCsId || null,
        assignedCsName: r.assigned_cs_name || crm.assignedCsName || null,
        interestLevel: r.interest_level || crm.interestLevel || null,
        nextFollowUpDate: r.next_follow_up_date || crm.nextFollowUpDate || null,
        lastFollowUp: r.last_follow_up || crm.lastFollowUp || null,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/payments?startDate=&endDate=&channel=&paymentType=

// GET /api/admin/expenses



// 404 for unknown /api routes

module.exports = router;
