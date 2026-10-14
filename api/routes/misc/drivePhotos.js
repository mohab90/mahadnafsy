'use strict';

// The pictures asked for with a certificate or a carnet go to Google Drive; the
// system keeps their LINKS on the client (subscribers.personal_photo_url /
// id_photo_url), saved with the payment that asked for them.
//
//   GET  /api/admin/drive/status                 is Drive set up?
//   POST /api/admin/drive/photo                  one picture → Drive → its link
//   GET  /api/admin/subscribers/:id/photos       the links already on a client's file
//
// «لما نرفع صورة اتوماتيك تروح لجوجل درايف ويبقى على السيستم لينك الصورة فقط».

const express = require('express');
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { inspectProofImageDataUrl } = require('../../lib/uploadSafety');
const { isConfigured, uploadImage } = require('../../lib/googleDrive');
const { cairoToday } = require('../../lib/dates');
const { financialRecordMatches, resolveFinancialScope } = require('../../lib/financialScope');

const router = express.Router();
const KINDS = { personal: 'صورة-شخصية', id: 'صورة-الهوية' };
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const GUARD = [requireAuth, requireAdminOrStaff, requirePermission('manage_payments')];

router.get('/api/admin/drive/status', ...GUARD, (req, res) => {
  res.json({ configured: isConfigured() });
});

router.post('/api/admin/drive/photo', ...GUARD, async (req, res) => {
  try {
    const kind = String(req.body?.kind || '');
    if (!KINDS[kind]) return res.status(400).json({ error: 'نوع الصورة غير معروف — صورة شخصية أو صورة هوية.', code: 'PHOTO_KIND_INVALID' });
    if (!isConfigured()) {
      return res.status(503).json({
        error: 'رفع الصور على جوجل درايف غير مُفعّل بعد — اطلب من المسئول إضافة GOOGLE_SERVICE_ACCOUNT_EMAIL و GOOGLE_PRIVATE_KEY و GOOGLE_DRIVE_FOLDER_ID في إعدادات السيرفر.',
        code: 'DRIVE_NOT_CONFIGURED',
      });
    }
    let checked;
    try { checked = inspectProofImageDataUrl(req.body?.dataUrl, 8 * 1024 * 1024); } catch (error) {
      const message = /large/i.test(error.message) ? 'الصورة كبيرة جداً — صوّرها بجودة أقل (حتى 8 ميجا).' : 'الملف لازم يكون صورة (JPEG أو PNG أو WebP).';
      return res.status(400).json({ error: message, code: 'PHOTO_INVALID' });
    }
    const base64 = String(req.body.dataUrl).split(',')[1] || '';
    const who = String(req.body?.clientCode || req.body?.clientName || '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40);
    const stamp = cairoToday();
    const file = await uploadImage({
      name: `${KINDS[kind]}-${who || 'عميل'}-${stamp}.${EXTENSION[checked.declaredMime]}`,
      mimeType: checked.declaredMime,
      buffer: Buffer.from(base64.replace(/\s/g, ''), 'base64'),
    });
    res.json({ ok: true, url: file.url, fileId: file.id });
  } catch (error) {
    logger.error('[drive-photo]', error.code || '', error.message);
    const reasons = {
      DRIVE_AUTH_FAILED: 'جوجل رفض حساب الخدمة — راجع GOOGLE_SERVICE_ACCOUNT_EMAIL والمفتاح الخاص.',
      DRIVE_UPLOAD_FAILED: error.status === 404 || error.status === 403
        ? 'جوجل درايف رفض الرفع — تأكد إن فولدر الصور متشارك مع حساب الخدمة بصلاحية «محرر».'
        : 'تعذّر رفع الصورة على جوجل درايف — حاول مرة أخرى.',
    };
    res.status(502).json({ error: reasons[error.code] || 'تعذّر رفع الصورة على جوجل درايف — حاول مرة أخرى.', code: error.code || 'DRIVE_FAILED' });
  }
});

router.get('/api/admin/subscribers/:id/photos', ...GUARD, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT id, branch_id, assigned_cs_id, assigned_sales_id, personal_photo_url, id_photo_url
         FROM subscribers WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1`,
      [req.tenantId, req.params.id]);
    if (!row) return res.json({ personal: null, id: null });
    let scope = null;
    try { scope = resolveFinancialScope(req, { allowAssigned: true }); } catch { scope = null; }
    if (!scope || !financialRecordMatches(scope, row)) return res.json({ personal: null, id: null });
    res.json({ personal: row.personal_photo_url || null, id: row.id_photo_url || null });
  } catch (error) {
    logger.error('[drive-photo/links]', error.message);
    res.status(500).json({ error: 'تعذّر قراءة صور العميل' });
  }
});

module.exports = router;
