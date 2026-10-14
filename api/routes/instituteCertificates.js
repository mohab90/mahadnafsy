'use strict';

// «شهادات المعهد» (8 Oct 2026): the certificate every client who paid 90% of a
// course has (lib/instituteCertificates.js), and its printed copy's way to them.
// The desk that works the certificates: manage_certificates.

const express = require('express');
const { effectiveCertificate, isEnglish, missingForCertificate } = require('../lib/certificateEnglish');
const router = express.Router();
const logger = require('../lib/logger');
const { pool } = require('../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { signerName } = require('../lib/staffNames');
const { logClientEvent } = require('../lib/clientHistory');
const { DELIVERY_STAGES, sweepInstituteCertificates } = require('../lib/instituteCertificates');

const desk = [requireAuth, requireAdminOrStaff, requirePermission('manage_certificates')];
const STAGE_AR = {
  READY: 'جاهزة', PRINTED: 'اتطبعت', AT_BRANCH: 'في الفرع', SHIPPED: 'اتشحنت', DELIVERED: 'العميل استلم', RETURNED: 'مرتجع',
};

router.get('/api/admin/institute-certificates', ...desk, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cc.id, cc.certificate_code, cc.completed_at, cc.delivery_status, cc.delivery_updated_at, cc.delivery_updated_by,
              cc.downloaded_at, cc.download_count,
              cc.cert_name_en, cc.cert_course_en, cc.cert_duration, cc.cert_trainer,
              s.id AS subscriber_id, s.name AS subscriber_name, s.name_en, s.phone, s.client_code, s.branch,
              s.national_id, s.personal_photo_url, s.id_photo_url,
              COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title, c.title AS course_title_main, c.title_en AS course_title_en,
              c.hours AS hours_count, u.name AS instructor_name
         FROM course_completions cc
         JOIN subscribers s ON s.id = cc.subscriber_id AND s.tenant_id = cc.tenant_id AND s.deleted_at IS NULL
         LEFT JOIN courses c ON c.id = cc.course_id AND c.tenant_id = cc.tenant_id
         LEFT JOIN users u ON u.id = c.instructor_id AND u.tenant_id = cc.tenant_id
        WHERE cc.tenant_id = ? AND cc.status = 'active'
        ORDER BY cc.completed_at DESC LIMIT 5000`, [req.tenantId]);
    res.json(rows.map(row => {
      // What the certificate prints: the desk's change on it, else the client's file and the course.
      const printed = effectiveCertificate({
        cert_name_en: row.cert_name_en, name_en: row.name_en,
        cert_course_en: row.cert_course_en, course_title_en: row.course_title_en, course_title: row.course_title_main,
        cert_duration: row.cert_duration, hours: row.hours_count,
        cert_trainer: row.cert_trainer, instructor_name: row.instructor_name,
      });
      return {
      id: row.id, code: row.certificate_code, issuedAt: row.completed_at,
      status: row.delivery_status || 'READY', statusAt: row.delivery_updated_at, statusBy: row.delivery_updated_by,
      downloadedAt: row.downloaded_at, downloads: Number(row.download_count) || 0,
      subscriberId: row.subscriber_id, subscriberName: row.subscriber_name || '', nameEn: row.name_en || null,
      phone: row.phone || '', clientCode: row.client_code || null, branch: row.branch || null, courseTitle: row.course_title || '',
      // The certificate prints in English only: what is missing before it can be printed.
      courseTitleEn: printed.course,
      missing: missingForCertificate({ nameEn: row.cert_name_en || row.name_en, courseTitleEn: row.cert_course_en || row.course_title_en, courseTitle: row.course_title_main }),
      nationalId: row.national_id || null, personalPhotoUrl: row.personal_photo_url || null, idPhotoUrl: row.id_photo_url || null,
      // What is printed on it, and what the desk changed on this certificate (null = as the sources say).
      printed,
      edits: { nameEn: row.cert_name_en || null, courseEn: row.cert_course_en || null, duration: row.cert_duration || null, trainer: row.cert_trainer || null },
      };
    }));
  } catch (e) { logger.error('[institute-certificates/list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
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
