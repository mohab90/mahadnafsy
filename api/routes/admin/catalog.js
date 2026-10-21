'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');

const { pool, cacheInvalidate } = require('../../lib/db');
const { syncOnlineTiersFromColumns } = require('../../lib/priceTiers');
const { mailer } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, parseCrm, calcLeadScoreServer } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, getNextClientCode, loadCourseMaterials, saveCourseMaterials } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logLeadEvent } = require('../../lib/crm');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { DATA_SCOPE, VALID_BRANCHES, VALID_PAY_TYPES, VALID_SOURCES } = require('../../constants/permissions');
const { listOnlineUsers } = require('../../lib/onlineUsers');
const { safeIsoString, safeDateOnly } = require('../../lib/dates');
const { keyset } = require('../../lib/pagination');
const { requireTenantQuota } = require('../../middleware/tenantQuota');
const { textValue, numberValue, sendFieldError } = require('../../lib/inputFields');


// GET /api/admin/online-users — العملاء المتصلون الآن (آخر دقيقتين)
router.get('/api/admin/online-users', requireAuth, requireAdminOrStaff, requirePermission('view_dashboard'), async (req, res) => {
  try {
    const users = await listOnlineUsers(req.tenantId);
    res.json(users.map(user => ({
      uid: user.uid,
      name: user.name,
      email: user.email,
      lastActiveAt: new Date(user.lastSeen).toISOString(),
    })));
  } catch (error) {
    logger.error('[online-users]', error.message);
    res.status(503).json({ error: 'Online presence unavailable' });
  }
});

// GET /api/admin/courses?limit=500&offset=0  (كل الكورسات بما فيها غير المنشورة)
router.get('/api/admin/courses', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 500, 1000);
    const offset = parseOffset(req.query.offset);
    const scopedInstructor = ['instructor', 'trainer'].includes(String(req.staffRecord?.role || '').toLowerCase())
      ? req.staffRecord.id : null;
    const [rows] = await pool.query(
      `SELECT ${COURSE_COLS} FROM courses
        WHERE tenant_id = ?${scopedInstructor ? ' AND instructor_id=?' : ''}
        ORDER BY sort_order ASC, created_at DESC LIMIT ? OFFSET ?`,
      scopedInstructor ? [req.tenantId, scopedInstructor, limit, offset] : [req.tenantId, limit, offset]
    );
    const materialsByCourse = await loadCourseMaterials(pool, rows.map(row => row.id));
    res.json(rows.map(row => mapCourse(row, materialsByCourse.get(row.id) || [])));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/courses
router.post('/api/admin/courses', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), requireTenantQuota('courses'), async (req, res) => {
  try {
    const c = req.body || {};
    const id = textValue(c.id, { field: 'id', label: 'المعرف', max: 36 }) || uuidv4();
    // Support both camelCase (admin UI) and snake_case payloads
    const courseCode      = c.course_code      ?? c.courseCode      ?? null;
    const slug            = textValue(c.slug, { field: 'slug', label: 'رابط الكورس (slug)', max: 255 }) || id;
    const title           = textValue(c.title, { field: 'title', label: 'عنوان الكورس', max: 500, required: true });
    const titleEn         = c.title_en         ?? c.titleEn         ?? null;
    const titleAr         = c.title_ar         ?? c.titleAr         ?? null;
    const shortDesc       = c.short_description ?? c.shortDescription ?? '';
    const instructorId    = c.instructor_id    ?? c.instructorId    ?? null;
    // A price, rating or student count the site shows: no negatives, no text,
    // and a rating out of five. These used to reach MySQL as typed — -500 was
    // saved and shown, and «abc» came back as a 500.
    const money = (value, field, label) => numberValue(value, { field, label, min: 0, max: 1e9, fallback: 0 });
    const priceEGP        = money(c.price_egp      ?? c.price?.EGP,         'price_egp', 'السعر بالجنيه');
    const priceSAR        = money(c.price_sar      ?? c.price?.SAR,         'price_sar', 'السعر بالريال');
    const priceUSD        = money(c.price_usd      ?? c.price?.USD,         'price_usd', 'السعر بالدولار');
    const origEGP         = money(c.orig_price_egp ?? c.originalPrice?.EGP, 'orig_price_egp', 'السعر قبل الخصم بالجنيه');
    const origSAR         = money(c.orig_price_sar ?? c.originalPrice?.SAR, 'orig_price_sar', 'السعر قبل الخصم بالريال');
    const origUSD         = money(c.orig_price_usd ?? c.originalPrice?.USD, 'orig_price_usd', 'السعر قبل الخصم بالدولار');
    const rating          = numberValue(c.rating, { field: 'rating', label: 'التقييم', min: 0, max: 5, fallback: 0 });
    const students        = numberValue(c.students, { field: 'students', label: 'عدد الطلاب', min: 0, max: 1e7, integer: true, fallback: 0 });
    const hours           = numberValue(c.hours, { field: 'hours', label: 'عدد الساعات', min: 0, max: 100000, fallback: null }) || null;
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
    const sortOrder       = numberValue(c.sort_order ?? c.sortOrder, { field: 'sort_order', label: 'الترتيب', min: -1e6, max: 1e6, integer: true, fallback: 0 });
    const modulesJson     = c.modules_json     ?? (c.modules        != null ? JSON.stringify(c.modules)        : null);
    const galleryJson     = c.gallery_images_json ?? (c.galleryImages != null ? JSON.stringify(c.galleryImages) : null);
    const detailsJson     = c.details_content_json ?? (c.detailsContent != null ? JSON.stringify(c.detailsContent) : null);
    const courseModJson   = c.course_modules_json  ?? (c.courseModules  != null ? JSON.stringify(c.courseModules)  : null);

    if (c.id) {
      const [[anyRow]] = await pool.query('SELECT id, (tenant_id = ?) AS owned FROM courses WHERE id=? LIMIT 1', [req.tenantId, c.id]);
      if (anyRow && !anyRow.owned) return res.status(404).json({ error: 'Course not found' });
    }
    // The slug is unique per tenant, and the upsert below matches on it too: a
    // new course with another course's slug «saved» by overwriting that
    // course's name and price, and created nothing.
    const [[slugOwner]] = await pool.query('SELECT id FROM courses WHERE tenant_id=? AND slug=? AND id<>? LIMIT 1', [req.tenantId, slug, id]);
    if (slugOwner) return res.status(409).json({ error: 'رابط الكورس (slug) مستخدم لكورس تاني — اختار رابط مختلف.', code: 'SLUG_TAKEN', field: 'slug' });
    if (instructorId) {
      // Tenant + active check only, deliberately NOT a role check. This used to
      // also require LOWER(role) IN ('instructor','trainer'), which blocked
      // course creation outright: the admin UI's lecturer dropdown is fed from
      // `therapists` (the public instructor directory) and sends
      // therapist.staff_id, but a linked staff account is a normal employee row
      // whose role is whatever they actually are — this tenant has no
      // instructor/trainer staff at all (its roles are sales/collection/
      // manager/admin/reception_daqqi/other/online_manager), so every linked
      // lecturer was rejected with "not an active tenant instructor".
      // What instructor_id is really for still holds with any role: revenue
      // share (instructor_rates.staff_id join in lib/paymentCompensation.js),
      // offboarding reassignment, and the instructor-scoped course filters —
      // and those filters only ever *narrow* access for a requester who is
      // themselves instructor/trainer, so naming e.g. a manager here grants
      // nobody anything extra. The tenant/active/not-deleted guard is the part
      // that carries the security weight (no cross-tenant or dangling refs).
      const [[instructor]] = await pool.query(
        `SELECT id FROM staff WHERE tenant_id=? AND id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1`,
        [req.tenantId, instructorId]
      );
      if (!instructor) {
        return res.status(400).json({
          error: 'المحاضر المختار غير مرتبط بحساب موظف نشط. اربط المحاضر بموظف من صفحة المحاضرين، أو اختر محاضرًا آخر.',
          code: 'INSTRUCTOR_STAFF_LINK_INVALID',
        });
      }
    }

    await pool.query(
      `INSERT INTO courses
         (id, tenant_id, course_code, slug, title, title_en, title_ar,
          description, short_description, instructor, instructor_id, thumbnail,
          category, type,
          price_egp, price_sar, price_usd,
          orig_price_egp, orig_price_sar, orig_price_usd,
          rating, students, duration, level, hours, access_months,
          promo_video_url, live_session_url,
          certificate_template_url, certificate_template_name,
          is_published, sort_order,
          modules_json, gallery_images_json, details_content_json, course_modules_json,
          seo_title, seo_description, seo_keywords)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), title_en=VALUES(title_en), title_ar=VALUES(title_ar),
         description=VALUES(description), short_description=VALUES(short_description),
         instructor=VALUES(instructor), instructor_id=VALUES(instructor_id), thumbnail=VALUES(thumbnail),
         category=VALUES(category), type=VALUES(type),
         course_code=VALUES(course_code), slug=VALUES(slug),
         price_egp=VALUES(price_egp), price_sar=VALUES(price_sar), price_usd=VALUES(price_usd),
         orig_price_egp=VALUES(orig_price_egp), orig_price_sar=VALUES(orig_price_sar), orig_price_usd=VALUES(orig_price_usd),
         rating=VALUES(rating), students=VALUES(students), duration=VALUES(duration),
         level=VALUES(level), hours=VALUES(hours), access_months=VALUES(access_months),
         is_published=VALUES(is_published), sort_order=VALUES(sort_order),
         promo_video_url=VALUES(promo_video_url), live_session_url=VALUES(live_session_url),
         certificate_template_url=VALUES(certificate_template_url),
         certificate_template_name=VALUES(certificate_template_name),
         modules_json=VALUES(modules_json), gallery_images_json=VALUES(gallery_images_json),
         details_content_json=VALUES(details_content_json), course_modules_json=VALUES(course_modules_json),
         seo_title=VALUES(seo_title), seo_description=VALUES(seo_description), seo_keywords=VALUES(seo_keywords),
         updated_at=CURRENT_TIMESTAMP`,
      [
        id, req.tenantId, courseCode, slug, title, titleEn, titleAr,
        c.description||'', shortDesc, c.instructor||'', instructorId, c.thumbnail||'',
        category, courseType,
        priceEGP, priceSAR, priceUSD,
        origEGP, origSAR, origUSD,
        // How many months a new enrolment keeps the course. 0 / blank means
        // unlimited, which is every course until someone sets a number.
        rating, students, c.duration||'', c.level||'', hours, Number(c.accessMonths ?? c.access_months) > 0 ? Number(c.accessMonths ?? c.access_months) : null,
        promoUrl, liveUrl, certUrl, certName,
        isPublished?1:0, sortOrder,
        modulesJson, galleryJson, detailsJson, courseModJson,
        seoTitle, seoDesc, seoKeywords,
      ]
    );
    // The course row was just written under this tenant, so the id is proven
    // to belong to it — course_materials is scoped through the course FK and
    // carries no tenant column of its own.
    if (c.materials !== undefined) await saveCourseMaterials(pool, id, c.materials);
    await syncOnlineTiersFromColumns(pool, { tenantId: req.tenantId, type: 'course', itemId: id });
    cacheInvalidate('courses', 'bundles');
    res.json({ ok: true, id });
  } catch (e) {
    if (sendFieldError(res, e)) return;
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/courses/:id
router.delete('/api/admin/courses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM courses WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Course not found' });
    cacheInvalidate('courses', 'bundles');
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/subscribers?limit=500&offset=0
// Allow collection staff (and admins) to fetch all subscribers
module.exports = router;
