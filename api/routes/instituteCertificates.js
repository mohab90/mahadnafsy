'use strict';

// «شهادات المعهد» (8 Oct 2026): the certificate every client who paid 90% of a
// course has (lib/instituteCertificates.js), and its printed copy's way to them.
// The desk that works the certificates: manage_certificates.

const express = require('express');
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
              s.id AS subscriber_id, s.name AS subscriber_name, s.name_en, s.phone, s.client_code, s.branch,
              COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title
         FROM course_completions cc
         JOIN subscribers s ON s.id = cc.subscriber_id AND s.tenant_id = cc.tenant_id AND s.deleted_at IS NULL
         LEFT JOIN courses c ON c.id = cc.course_id AND c.tenant_id = cc.tenant_id
        WHERE cc.tenant_id = ? AND cc.status = 'active'
        ORDER BY cc.completed_at DESC LIMIT 5000`, [req.tenantId]);
    res.json(rows.map(row => ({
      id: row.id, code: row.certificate_code, issuedAt: row.completed_at,
      status: row.delivery_status || 'READY', statusAt: row.delivery_updated_at, statusBy: row.delivery_updated_by,
      downloadedAt: row.downloaded_at, downloads: Number(row.download_count) || 0,
      subscriberId: row.subscriber_id, subscriberName: row.subscriber_name || '', nameEn: row.name_en || null,
      phone: row.phone || '', clientCode: row.client_code || null, branch: row.branch || null, courseTitle: row.course_title || '',
    })));
  } catch (e) { logger.error('[institute-certificates/list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// «تحديث القائمة»: the hourly sweep, now.
router.post('/api/admin/institute-certificates/sync', ...desk, async (req, res) => {
  try {
    res.json({ ok: true, issued: await sweepInstituteCertificates(req.tenantId) });
  } catch (e) { logger.error('[institute-certificates/sync]', e.message); res.status(500).json({ error: 'Internal server error' }); }
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
