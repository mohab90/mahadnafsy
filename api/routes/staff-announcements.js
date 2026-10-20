'use strict';
/**
 * A message from the administration to the employees, shown as a special pop-up (20 Oct 2026).
 *
 * «في قسم الإدارة أبعت رسالة فيديو أو صور أو كلام بشكل مميز يظهر بوب أب للموظفين». The administration writes it (a title, text,
 * up to four pictures, a video, a look, who it is for, until when); each employee gets it as a pop-up the next time the system
 * is open and again until they close it. Closing is remembered per employee, so a colleague's closing does not hide it.
 */
const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'staff-announcements' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const announcements = require('../lib/staffAnnouncements');

// The signed-in employee, by their login's email — like the rest of the employee's own routes (/api/staff/me/…).
const myStaffRow = async req => {
  const email = String(req.user?.email || '').toLowerCase().trim();
  if (!email) return null;
  const [[row]] = await pool.query(
    'SELECT id, role FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? AND is_active=1 AND deleted_at IS NULL LIMIT 1',
    [req.tenantId, email]);
  return row || null;
};

const fail = (res, error, where) => {
  logger.error(where, error);
  return res.status(500).json({ error: 'Internal server error' });
};

// ── The administration ─────────────────────────────────────────────────────
router.get('/api/admin/staff-announcements', requireAuth, requireAdminOrStaff, requirePermission('manage_staff'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, (SELECT COUNT(*) FROM staff_announcement_seen s WHERE s.tenant_id=a.tenant_id AND s.announcement_id=a.id) AS seen_count
         FROM staff_announcements a WHERE a.tenant_id=? ORDER BY a.created_at DESC LIMIT 60`,
      [req.tenantId]);
    const [[people]] = await pool.query(
      "SELECT COUNT(*) AS n FROM staff WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL", [req.tenantId]);
    res.json({
      activeStaff: Number(people?.n) || 0,
      items: rows.map(row => ({
        ...announcements.shape(row),
        active: Boolean(row.is_active) && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()),
        stopped: !row.is_active,
        seenCount: Number(row.seen_count) || 0,
      })),
    });
  } catch (error) { fail(res, error, '[staff-announcements list]'); }
});

router.post('/api/admin/staff-announcements', requireAuth, requireAdminOrStaff, requirePermission('manage_staff'), async (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title || '').trim().slice(0, 200);
    const text = String(body.body || '').trim().slice(0, 4000);
    const videoRaw = String(body.videoUrl || '').trim();
    const videoUrl = announcements.safeVideoUrl(videoRaw);
    const images = announcements.cleanImages(body.images);
    if (videoRaw && !videoUrl) return res.status(400).json({ error: 'رابط الفيديو لازم يكون يوتيوب أو فيميو أو ملف mp4 / webm على https' });
    if (!title) return res.status(400).json({ error: 'اكتب عنوان للرسالة' });
    if (!text && !videoUrl && images.length === 0) return res.status(400).json({ error: 'اكتب نص أو ضيف صورة أو فيديو' });
    const style = announcements.STYLES.includes(body.style) ? body.style : 'info';
    const roles = announcements.cleanRoles(body.roles);
    let expiresAt = null;
    if (body.expiresAt) {
      const when = new Date(body.expiresAt);
      if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'تاريخ الانتهاء مش مفهوم' });
      if (when.getTime() <= Date.now()) return res.status(400).json({ error: 'تاريخ الانتهاء عدّى' });
      expiresAt = when;
    }
    const id = uuidv4();
    await pool.query(
      `INSERT INTO staff_announcements
         (id, tenant_id, title, body, image_urls, video_url, style, audience_roles, expires_at, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, title, text || null, JSON.stringify(images), videoUrl || null, style, roles.join(',') || null, expiresAt,
        String(req.staffRecord?.id || req.user?.uid || '') || null, String(req.staffRecord?.name || req.user?.name || 'الإدارة').slice(0, 255)]);
    res.json({ ok: true, id });
  } catch (error) { fail(res, error, '[staff-announcements create]'); }
});

// Stopped, not erased: who closed it stays on record.
router.delete('/api/admin/staff-announcements/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_staff'), async (req, res) => {
  try {
    await pool.query('UPDATE staff_announcements SET is_active=0 WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    res.json({ ok: true });
  } catch (error) { fail(res, error, '[staff-announcements stop]'); }
});

// ── The employee ───────────────────────────────────────────────────────────
router.get('/api/staff/announcements/pending', requireAuth, async (req, res) => {
  try {
    const me = await myStaffRow(req);
    if (!me) return res.json({ items: [] });
    res.json({ items: await announcements.pendingFor(pool, { tenantId: req.tenantId, staffId: me.id, role: me.role }) });
  } catch (error) { fail(res, error, '[staff-announcements pending]'); }
});

router.post('/api/staff/announcements/:id/seen', requireAuth, async (req, res) => {
  try {
    const me = await myStaffRow(req);
    if (!me) return res.json({ ok: true });
    await pool.query(
      `INSERT IGNORE INTO staff_announcement_seen (tenant_id, announcement_id, staff_id)
       SELECT a.tenant_id, a.id, ? FROM staff_announcements a WHERE a.id=? AND a.tenant_id=?`,
      [String(me.id), req.params.id, req.tenantId]);
    res.json({ ok: true });
  } catch (error) { fail(res, error, '[staff-announcements seen]'); }
});

module.exports = router;
