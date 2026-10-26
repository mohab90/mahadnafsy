'use strict';

// «شهادات المعهد» (8 Oct 2026): the certificate every client who paid 90% of a
// course has (lib/instituteCertificates.js), and its printed copy's way to them.
// The desk that works the certificates: manage_certificates.

const express = require('express');
const { REQUEST_NAME_EN_SQL, effectiveCertificate, isEnglish, missingForCertificate } = require('../lib/certificateEnglish');
const { completeCourse } = require('../lib/courseCompletion');
const { formLayout } = require('../lib/certificateHtml');
const { getTenantSetting, setTenantSetting } = require('../lib/tenantSettings');
const router = express.Router();
const logger = require('../lib/logger');
const { pool } = require('../lib/db');
const { requireAuth, requireAdminOrStaff, requireAnyPermission, requirePermission } = require('../middleware/auth');
const { signerName } = require('../lib/staffNames');
const { logClientEvent } = require('../lib/clientHistory');
const { DELIVERY_STAGES, sweepInstituteCertificates } = require('../lib/instituteCertificates');

const desk = [requireAuth, requireAdminOrStaff, requirePermission('manage_certificates')];
// Whoever prints a certificate from the client's page records the print: the certificates desk, collection, customer service.
const printers = [requireAuth, requireAdminOrStaff, requireAnyPermission('manage_certificates', 'manage_financial', 'manage_subscribers')];
const STAGE_AR = {
  READY: 'جاهزة', PRINTED: 'اتطبعت', AT_BRANCH: 'في الفرع', SHIPPED: 'اتشحنت', DELIVERED: 'العميل استلم', RETURNED: 'مرتجع',
};

router.get('/api/admin/institute-certificates', ...desk, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cc.id, cc.certificate_code, cc.completed_at, cc.delivery_status, cc.delivery_updated_at, cc.delivery_updated_by,
              cc.downloaded_at, cc.download_count, cc.printed_at, cc.printed_by, cc.print_count,
              cc.cert_name_en, ${REQUEST_NAME_EN_SQL} AS request_name_en, cc.cert_course_en, cc.cert_duration, cc.cert_trainer,
              s.id AS subscriber_id, s.name AS subscriber_name, s.name_en, s.phone, s.client_code, s.branch,
              s.national_id, s.personal_photo_url, s.id_photo_url,
              COALESCE(NULLIF(c.title_ar, ''), c.title, b.title) AS course_title, COALESCE(c.title, b.title) AS course_title_main,
              COALESCE(c.title_en, b.title_en) AS course_title_en, COALESCE(c.hours, b.hours) AS hours_count, u.name AS instructor_name,
              (b.id IS NOT NULL AND c.id IS NULL) AS is_track
         FROM course_completions cc
         JOIN subscribers s ON s.id = cc.subscriber_id AND s.tenant_id = cc.tenant_id AND s.deleted_at IS NULL
         LEFT JOIN courses c ON c.id = cc.course_id AND c.tenant_id = cc.tenant_id
         LEFT JOIN bundles b ON b.id = cc.course_id AND b.tenant_id = cc.tenant_id
         LEFT JOIN users u ON u.id = c.instructor_id AND u.tenant_id = cc.tenant_id
        WHERE cc.tenant_id = ? AND cc.status = 'active' AND cc.deleted_at IS NULL
        ORDER BY cc.completed_at DESC LIMIT 5000`, [req.tenantId]);
    res.json(rows.map(row => {
      // What the certificate prints: the desk's change on it, else the client's file and the course.
      const printed = effectiveCertificate({
        cert_name_en: row.cert_name_en, name_en: row.name_en, request_name_en: row.request_name_en,
        cert_course_en: row.cert_course_en, course_title_en: row.course_title_en, course_title: row.course_title_main,
        cert_duration: row.cert_duration, hours: row.hours_count,
        cert_trainer: row.cert_trainer, instructor_name: row.instructor_name,
      });
      return {
      id: row.id, code: row.certificate_code, issuedAt: row.completed_at,
      status: row.delivery_status || 'READY', statusAt: row.delivery_updated_at, statusBy: row.delivery_updated_by,
      downloadedAt: row.downloaded_at, downloads: Number(row.download_count) || 0,
      printedAt: row.printed_at, printedBy: row.printed_by || null, printCount: Number(row.print_count) || 0, isTrack: Boolean(Number(row.is_track)),
      subscriberId: row.subscriber_id, subscriberName: row.subscriber_name || '', nameEn: row.name_en || null,
      phone: row.phone || '', clientCode: row.client_code || null, branch: row.branch || null, courseTitle: row.course_title || '',
      // The certificate prints in English only: what is missing before it can be printed.
      courseTitleEn: printed.course,
      missing: missingForCertificate({ nameEn: row.cert_name_en || row.name_en || row.request_name_en, courseTitleEn: row.cert_course_en || row.course_title_en, courseTitle: row.course_title_main }),
      nationalId: row.national_id || null, personalPhotoUrl: row.personal_photo_url || null, idPhotoUrl: row.id_photo_url || null,
      // What is printed on it, and what the desk changed on this certificate (null = as the sources say).
      printed,
      edits: { nameEn: row.cert_name_en || null, courseEn: row.cert_course_en || null, duration: row.cert_duration || null, trainer: row.cert_trainer || null },
      };
    }));
  } catch (e) { logger.error('[institute-certificates/list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// «أي شهادة اتطبعت في المعهد لازم يظهر عليها علامة إنها اتطبعت»: the desk calls this when it prints (the full design or the form), so the
// mark is the desk's own and the client's downloads (downloaded_at) stay a separate mark. A certificate still «جاهزة» becomes «اتطبعت».
router.post('/api/admin/institute-certificates/:id/printed', ...printers, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      `SELECT cc.id, cc.subscriber_id, cc.delivery_status, COALESCE(NULLIF(c.title_ar, ''), c.title, b.title) AS course_title
         FROM course_completions cc
         LEFT JOIN courses c ON c.id = cc.course_id AND c.tenant_id = cc.tenant_id
         LEFT JOIN bundles b ON b.id = cc.course_id AND b.tenant_id = cc.tenant_id
        WHERE cc.id = ? AND cc.tenant_id = ? AND cc.status = 'active' AND cc.deleted_at IS NULL LIMIT 1 FOR UPDATE`, [req.params.id, req.tenantId]);
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'الشهادة مش موجودة' }); }
    const by = signerName(req);
    await conn.query(
      `UPDATE course_completions
          SET printed_at = NOW(), printed_by = ?, print_count = print_count + 1,
              delivery_updated_at = IF(delivery_status = 'READY', NOW(), delivery_updated_at),
              delivery_updated_by = IF(delivery_status = 'READY', ?, delivery_updated_by),
              delivery_status = IF(delivery_status = 'READY', 'PRINTED', delivery_status)
        WHERE id = ? AND tenant_id = ?`, [by, by, row.id, req.tenantId]);
    await logClientEvent(conn, {
      tenantId: req.tenantId, subscriberId: row.subscriber_id, action: 'institute_certificate', actor: by,
      label: `اتطبعت شهادة «${row.course_title || 'الكورس'}» (${String(req.body?.mode) === 'form' ? 'على النموذج الجاهز' : 'بالتصميم الكامل'})`,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[institute-certificates/printed]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// «مكان الطباعة على النموذج الجاهز … تثبيت بمقاسات معينة»: the measurements (cm from the top of the sheet) are the institute's, saved once
// for every computer — the name, the course, the training hours under it and the code — and every print on the form uses them.
router.get('/api/admin/institute-certificates/layout', ...printers, async (req, res) => {
  try {
    const saved = await getTenantSetting('certificate_form_layout', { tenantId: req.tenantId, fallback: {} });
    res.json({ layout: formLayout(saved || {}), defaults: formLayout({}), saved: Boolean(saved && Object.keys(saved).length) });
  } catch (e) { logger.error('[institute-certificates/layout]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/institute-certificates/layout', ...desk, async (req, res) => {
  try {
    const body = req.body || {};
    for (const key of ['nameTop', 'courseTop', 'hoursTop', 'codeTop']) {
      const cm = Number(body[key]);
      if (!Number.isFinite(cm) || cm < 3 || cm > 28) return res.status(400).json({ error: 'كل مقاس لازم يكون بين 3 و28 سم من أعلى الورقة', code: 'LAYOUT_RANGE' });
    }
    const layout = formLayout(body);
    await setTenantSetting('certificate_form_layout', layout, { tenantId: req.tenantId });
    res.json({ ok: true, layout });
  } catch (e) { logger.error('[institute-certificates/layout:put]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// «زر اسمه إضافة شهادة بيقدر يختار عميل من الموجودة بالبحث ويظهر كورساته ويطبعله شهادة»: what a client holds — the courses (enrolled, seated in a
// Dokki round or paid for) and the tracks — and whether each already has its certificate.
router.get('/api/admin/institute-certificates/client/:subscriberId/items', ...desk, async (req, res) => {
  try {
    const [[client]] = await pool.query(
      'SELECT id, name, name_en, client_code FROM subscribers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1', [req.params.subscriberId, req.tenantId]);
    if (!client) return res.status(404).json({ error: 'العميل مش موجود' });
    const [courses] = await pool.query(
      `SELECT c.id, COALESCE(NULLIF(c.title_ar, ''), c.title) AS title FROM courses c
         WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND (
           c.id IN (SELECT e.course_id FROM enrollments e WHERE e.tenant_id = c.tenant_id AND e.subscriber_id = ? AND e.status = 'active' AND e.course_id IS NOT NULL)
           OR c.id IN (SELECT r.course_id FROM daqqi_attendees da JOIN daqqi_rounds r ON r.id = da.round_id AND r.tenant_id = da.tenant_id
                        WHERE da.tenant_id = c.tenant_id AND da.subscriber_id = ?)
           OR c.id IN (SELECT p.course_id FROM payments p WHERE p.tenant_id = c.tenant_id AND p.subscriber_id = ? AND p.status = 'paid'
                        AND p.deleted_at IS NULL AND p.course_id IS NOT NULL AND p.bundle_id IS NULL))
         ORDER BY title`, [req.tenantId, client.id, client.id, client.id]);
    const [tracks] = await pool.query(
      `SELECT b.id, b.title FROM bundles b
         WHERE b.tenant_id = ? AND b.deleted_at IS NULL AND (
           b.id IN (SELECT e.bundle_id FROM enrollments e WHERE e.tenant_id = b.tenant_id AND e.subscriber_id = ? AND e.status = 'active' AND e.bundle_id IS NOT NULL)
           OR b.id IN (SELECT p.bundle_id FROM payments p WHERE p.tenant_id = b.tenant_id AND p.subscriber_id = ? AND p.status = 'paid'
                        AND p.deleted_at IS NULL AND p.bundle_id IS NOT NULL))
         ORDER BY b.title`, [req.tenantId, client.id, client.id]);
    const [held] = await pool.query(
      'SELECT id, course_id, certificate_code, status FROM course_completions WHERE tenant_id = ? AND subscriber_id = ? AND deleted_at IS NULL', [req.tenantId, client.id]);
    const heldBy = new Map(held.map(row => [row.course_id, { id: row.id, code: row.certificate_code, status: row.status }]));
    res.json({
      client: { id: client.id, name: client.name || '', nameEn: client.name_en || '', clientCode: client.client_code || null },
      items: [
        ...tracks.map(row => ({ kind: 'track', id: row.id, title: row.title, certificate: heldBy.get(row.id) || null })),
        ...courses.map(row => ({ kind: 'course', id: row.id, title: row.title, certificate: heldBy.get(row.id) || null })),
      ],
    });
  } catch (e) { logger.error('[institute-certificates/items]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Issued by hand: the same function as the hourly sweep, minus its payment rule when the desk says so (force) — the desk answers for it.
router.post('/api/admin/institute-certificates', ...desk, async (req, res) => {
  try {
    const subscriberId = String(req.body?.subscriberId || '').trim();
    const courseId = String(req.body?.courseId || '').trim();
    const bundleId = String(req.body?.bundleId || '').trim();
    if (!subscriberId || (!courseId && !bundleId)) return res.status(400).json({ error: 'اختار العميل والكورس أو المسار', code: 'CERT_ITEM_REQUIRED' });
    const force = req.body?.force === true;
    let result;
    try {
      result = await completeCourse({
        tenantId: req.tenantId, subscriberId, courseId: courseId || bundleId, bundleId: bundleId || null, actor: signerName(req),
        requireFullProgress: false, requireEnrollment: false, sendEmail: false, requirePayment: !force,
        reason: `أضافتها الإدارة يدوياً${force ? ' بدون شرط الدفع' : ''}`,
      });
    } catch (error) {
      if (error.statusCode === 409 && /Paid tenant enrollment is required/.test(error.message)) {
        return res.status(409).json({ error: 'العميل لسه مدفعش 90% من سعرها — تصدرها برضه؟', code: 'PAYMENT_SHORT' });
      }
      throw error;
    }
    const id = result.id;
    if (id) await pool.query('UPDATE course_completions SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND tenant_id = ?', [id, req.tenantId]);
    await logClientEvent(pool, {
      tenantId: req.tenantId, subscriberId, action: 'institute_certificate', actor: signerName(req),
      label: result.alreadyCompleted ? 'اتفتحت شهادة المعهد الموجودة' : `اتضافت شهادة معهد يدوياً${force ? ' بدون شرط الدفع' : ''}`,
    }).catch(() => {});
    res.json({ ok: true, id, code: result.certificate_code, alreadyHad: Boolean(result.alreadyCompleted) });
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    logger.error('[institute-certificates/add]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// «تحديث القائمة»: the hourly sweep, now.
router.post('/api/admin/institute-certificates/sync', ...desk, async (req, res) => {
  try {
    res.json({ ok: true, issued: await sweepInstituteCertificates(req.tenantId) });
  } catch (e) { logger.error('[institute-certificates/sync]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// «زر تعديل للاسم او المدة او اي حاجه تخص الشهادة»: a change to THIS certificate only —
// the client's file and the course are not touched. An empty field goes back to «as the
// sources say». The name and the course stay English only, the duration too.
router.put('/api/admin/institute-certificates/:id/edit', ...desk, async (req, res) => {
  const field = (key, max) => {
    const text = String(req.body?.[key] ?? '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, max) : null;
  };
  const edit = { cert_name_en: field('nameEn', 160), cert_course_en: field('courseEn', 255), cert_duration: field('duration', 80), cert_trainer: field('trainer', 160) };
  for (const [key, label] of [['cert_name_en', 'الاسم'], ['cert_course_en', 'اسم الكورس'], ['cert_duration', 'المدة']]) {
    if (edit[key] && (!isEnglish(edit[key]) && !(key === 'cert_duration' && !/[\u0600-\u06FF]/.test(edit[key])))) {
      return res.status(400).json({ error: `${label} على الشهادة لازم يتكتب بالإنجليزي فقط`, code: 'CERT_ENGLISH_ONLY' });
    }
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      'SELECT id, subscriber_id FROM course_completions WHERE id = ? AND tenant_id = ? AND status = \'active\' LIMIT 1 FOR UPDATE', [req.params.id, req.tenantId]);
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'الشهادة مش موجودة' }); }
    await conn.query(
      'UPDATE course_completions SET cert_name_en=?, cert_course_en=?, cert_duration=?, cert_trainer=? WHERE id=? AND tenant_id=?',
      [edit.cert_name_en, edit.cert_course_en, edit.cert_duration, edit.cert_trainer, row.id, req.tenantId]);
    await logClientEvent(conn, {
      tenantId: req.tenantId, subscriberId: row.subscriber_id, action: 'institute_certificate', actor: signerName(req),
      label: 'اتعدّلت بيانات شهادة المعهد قبل الطباعة',
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[institute-certificates/edit]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

router.patch('/api/admin/institute-certificates/:id/status', ...desk, async (req, res) => {
  const status = String(req.body?.status || '').toUpperCase();
  if (!DELIVERY_STAGES.includes(status)) return res.status(400).json({ error: 'حالة غير معروفة' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      `SELECT cc.id, cc.subscriber_id, cc.delivery_status, COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title
         FROM course_completions cc LEFT JOIN courses c ON c.id = cc.course_id AND c.tenant_id = cc.tenant_id
        WHERE cc.id = ? AND cc.tenant_id = ? AND cc.status = 'active' LIMIT 1 FOR UPDATE`, [req.params.id, req.tenantId]);
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'الشهادة مش موجودة' }); }
    await conn.query(
      'UPDATE course_completions SET delivery_status=?, delivery_updated_at=NOW(), delivery_updated_by=? WHERE id=? AND tenant_id=?',
      [status, signerName(req), row.id, req.tenantId]);
    await logClientEvent(conn, {
      tenantId: req.tenantId, subscriberId: row.subscriber_id, action: 'institute_certificate', actor: signerName(req),
      label: `شهادة المعهد «${row.course_title || 'الكورس'}»: ${STAGE_AR[status]}`,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[institute-certificates/status]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

module.exports = router;
