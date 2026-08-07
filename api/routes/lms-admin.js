'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool, cacheInvalidate } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const mediaUrlIsValid = value => {
  const url = String(value || '').trim();
  if (url.startsWith('/uploads/videos/')) return true;
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
};
const durationSeconds = (value, explicit) => {
  const direct = Number(explicit);
  if (Number.isInteger(direct) && direct >= 0 && direct <= 86400) return direct;
  const parts = String(value || '').split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 2) return Math.min(86400, parts[0] * 60 + parts[1]);
  if (parts.length === 3) return Math.min(86400, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  return 0;
};

router.post('/api/admin/lectures', requireAuth, requireAdmin, async (req, res) => {
  try {
    const l = req.body;
    const id = l.id || uuidv4();
    // Support both camelCase (frontend) and snake_case field names
    const courseId      = l.courseId      || l.course_id      || null;
    const chapterId     = l.chapterId     || l.chapter_id     || null;
    const title = String(l.title || '').trim();
    if (!courseId || !title || title.length > 500) {
      return res.status(400).json({ error: 'Valid courseId and title (1-500 characters) are required' });
    }
    const [[course]] = await pool.query(
      'SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
      [courseId, req.tenantId]
    );
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (chapterId) {
      const [[chapter]] = await pool.query(
        `SELECT ch.id FROM course_chapters ch JOIN courses c ON c.id=ch.course_id
          WHERE ch.id=? AND ch.course_id=? AND c.tenant_id=? LIMIT 1`,
        [chapterId, courseId, req.tenantId]
      );
      if (!chapter) return res.status(404).json({ error: 'Chapter not found in the selected course' });
    }
    if (l.id) {
      // The ON DUPLICATE KEY UPDATE below matches by id alone. If this id already
      // belongs to a lecture row, it must be owned by this tenant — otherwise a
      // client-supplied id colliding with another tenant's row would silently
      // overwrite it. A brand-new id (no existing row yet) is fine.
      const [[anyLecture]] = await pool.query(
        `SELECT cl.id, (c.tenant_id = ?) AS owned
           FROM course_lectures cl JOIN courses c ON c.id = cl.course_id
          WHERE cl.id=? LIMIT 1`,
        [req.tenantId, l.id]
      );
      if (anyLecture && !anyLecture.owned) return res.status(404).json({ error: 'Lecture not found' });
    }
    const videoUrl      = l.videoUrl      || l.video_url      || '';
    const sortOrder     = l.order         ?? l.sortOrder      ?? l.sort_order     ?? 0;
    const lectureType   = (l.lectureType  || l.lecture_type   || 'RECORDED').toUpperCase();
    const description   = String(l.description || '').slice(0, 10000);
    if (!['RECORDED', 'LIVE'].includes(lectureType)) return res.status(400).json({ error: 'Invalid lectureType' });
    if (lectureType === 'RECORDED' && !mediaUrlIsValid(videoUrl)) return res.status(400).json({ error: 'A valid HTTPS/HTTP or tenant upload videoUrl is required' });
    const normalizedSortOrder = Number(sortOrder);
    const normalizedDripDays = Number(l.dripUnlockDays ?? l.drip_unlock_days ?? 0);
    if (!Number.isInteger(normalizedSortOrder) || normalizedSortOrder < 0 || normalizedSortOrder > 100000
      || !Number.isInteger(normalizedDripDays) || normalizedDripDays < 0 || normalizedDripDays > 3650) {
      return res.status(400).json({ error: 'Invalid sort order or drip days' });
    }
    const isPreview     = l.isPreview     != null ? (l.isPreview     ? 1 : 0) : (l.is_preview     != null ? (l.is_preview     ? 1 : 0) : 0);
    const isPublished   = l.isPublished   != null ? (l.isPublished   ? 1 : 0) : (l.is_published   != null ? (l.is_published   ? 1 : 0) : 1);
    const duration = String(l.duration || '').slice(0, 50);
    const normalizedDurationSeconds = durationSeconds(duration, l.durationSeconds ?? l.duration_seconds);
    await pool.query(
      `INSERT INTO course_lectures
       (id,course_id,chapter_id,title,lecture_type,video_url,duration,duration_seconds,
        sort_order,description,is_preview,is_published,drip_unlock_days)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), video_url=VALUES(video_url),
         chapter_id=VALUES(chapter_id), course_id=VALUES(course_id),
         lecture_type=VALUES(lecture_type),duration=VALUES(duration),duration_seconds=VALUES(duration_seconds),
         sort_order=VALUES(sort_order), description=VALUES(description),
         is_preview=VALUES(is_preview), is_published=VALUES(is_published),
         drip_unlock_days=VALUES(drip_unlock_days)`,
      [id, courseId, chapterId, title, lectureType, videoUrl, duration, normalizedDurationSeconds,
        normalizedSortOrder, description, isPreview, isPublished, normalizedDripDays]
    );
    // 'courses' alone left GET /api/lectures and GET /api/chapters serving their
    // own 5-minute caches, so a lecture that was added, renamed, reordered,
    // published or unpublished stayed invisible to customers for up to five
    // minutes after the panel had already said "تم الحفظ".
    cacheInvalidate('courses', 'lectures', 'chapters');
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/lectures/:id
// (removed dead duplicate DELETE /api/admin/lectures/:id — live in an earlier-mounted router)

// POST /api/admin/chapters
router.post('/api/admin/chapters', requireAuth, requireAdmin, async (req, res) => {
  try {
    const c = req.body;
    const id = c.id || uuidv4();
    // Support both camelCase (frontend) and snake_case field names
    const courseId  = c.courseId  || c.course_id  || null;
    const sortOrder = c.order     ?? c.sortOrder  ?? c.sort_order ?? 0;
    const title = String(c.title || '').trim();
    if (!courseId || !title || title.length > 500 || !Number.isInteger(Number(sortOrder))
      || Number(sortOrder) < 0 || Number(sortOrder) > 100000) {
      return res.status(400).json({ error: 'Valid courseId, title and sort order are required' });
    }
    const [[course]] = await pool.query('SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [courseId, req.tenantId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (c.id) {
      const [[anyChapter]] = await pool.query(
        `SELECT ch.id, (co.tenant_id = ?) AS owned
           FROM course_chapters ch JOIN courses co ON co.id = ch.course_id
          WHERE ch.id=? LIMIT 1`,
        [req.tenantId, c.id]
      );
      if (anyChapter && !anyChapter.owned) return res.status(404).json({ error: 'Chapter not found' });
    }
    await pool.query(
      `INSERT INTO course_chapters (id, course_id, title, sort_order)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), sort_order=VALUES(sort_order)`,
      [id, courseId, title, Number(sortOrder)]
    );
    cacheInvalidate('courses', 'lectures', 'chapters');
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/chapters/:id
// (removed dead duplicate DELETE /api/admin/chapters/:id — live in an earlier-mounted router)

// POST /api/admin/therapists
router.post('/api/admin/therapists', requireAuth, requireAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const t = req.body;
    const id = t.id || uuidv4();
    const cs = t.consultationSettings || {};
    // Support both nested (price.EGP) and flat (price_egp) body formats
    const priceEgp = cs.sessionPrice?.EGP ?? t.price?.EGP ?? t.price_egp ?? 0;
    const priceSar = cs.sessionPrice?.SAR ?? t.price?.SAR ?? t.price_sar ?? 0;
    const priceUsd = cs.sessionPrice?.USD ?? t.price?.USD ?? t.price_usd ?? 0;
    const isConsult = cs.enabled !== undefined ? (cs.enabled ? 1 : 0) : (t.is_consultation_enabled || 0);
    const sessionDur = cs.sessionDurationMinutes ?? t.session_duration_minutes ?? 60;
    const rawProvider = cs.meetingProvider ?? t.meeting_provider ?? 'GOOGLE_MEET';
    const meetingProvider = rawProvider.toUpperCase().replace('-', '_');
    const providerUrl = cs.providerBaseUrl ?? t.provider_base_url ?? null;
    const langJson = Array.isArray(t.languages) ? JSON.stringify(t.languages) : (t.languages_json || null);
    const focusJson = Array.isArray(t.focusAreas) ? JSON.stringify(t.focusAreas) : (t.focus_areas_json || null);
    const qualJson = Array.isArray(t.qualifications) ? JSON.stringify(t.qualifications) : (t.qualifications_json || null);
    const showHome = t.showOnHome !== undefined ? (t.showOnHome ? 1 : 0) : (t.show_on_home || 0);
    const showAbout = t.showOnAbout !== undefined ? (t.showOnAbout ? 1 : 0) : (t.show_on_about || 0);
    const staffId = t.staffId ?? t.staff_id ?? null;
    let oldName = null;
    if (t.id) {
      const [[anyRow]] = await conn.query('SELECT tenant_id, name FROM therapists WHERE id=? LIMIT 1', [t.id]);
      if (anyRow && anyRow.tenant_id !== req.tenantId) return res.status(404).json({ error: 'Therapist not found' });
      oldName = anyRow?.name || null;
    }
    if (staffId) {
      const [[staff]] = await conn.query(
        `SELECT id FROM staff WHERE tenant_id=? AND id=? AND is_active=1 AND deleted_at IS NULL
          AND LOWER(role) IN ('instructor','trainer') LIMIT 1`,
        [req.tenantId, staffId]
      );
      if (!staff) return res.status(400).json({ error: 'Linked staff instructor is not active in this tenant' });
    }
    const slots = cs.availableSlots;
    if (slots !== undefined && !Array.isArray(slots)) return res.status(400).json({ error: 'availableSlots must be an array' });
    if (Array.isArray(slots)) {
      for (const slot of slots) {
        if (!slot || !/^[a-z]{3,12}$/i.test(String(slot.day || ''))
          || !/^\d{2}:\d{2}$/.test(String(slot.startTime || ''))
          || !/^\d{2}:\d{2}$/.test(String(slot.endTime || ''))
          || String(slot.timezone || '').length > 100
          || String(slot.label || '').length > 255
          || String(slot.meetingLink || '').length > 2000) {
          return res.status(400).json({ error: 'Invalid therapist availability slot' });
        }
      }
    }
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO therapists
         (id, tenant_id, staff_id, name, specialty, image, experience, rating, title, bio,
          price_egp, price_sar, price_usd,
          is_consultation_enabled, session_duration_minutes,
          meeting_provider, provider_base_url,
          featured, sort_order, show_on_home, show_on_about, is_active,
          languages_json, focus_areas_json, qualifications_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         staff_id=VALUES(staff_id), name=VALUES(name), specialty=VALUES(specialty), image=VALUES(image),
         bio=VALUES(bio), title=VALUES(title),
         price_egp=VALUES(price_egp), price_sar=VALUES(price_sar), price_usd=VALUES(price_usd),
         is_consultation_enabled=VALUES(is_consultation_enabled),
         session_duration_minutes=VALUES(session_duration_minutes),
         meeting_provider=VALUES(meeting_provider), provider_base_url=VALUES(provider_base_url),
         featured=VALUES(featured), sort_order=VALUES(sort_order),
         show_on_home=VALUES(show_on_home), show_on_about=VALUES(show_on_about),
         is_active=VALUES(is_active),
         languages_json=VALUES(languages_json), focus_areas_json=VALUES(focus_areas_json),
         qualifications_json=VALUES(qualifications_json)`,
      [
        id, req.tenantId, staffId, t.name||'', t.specialty||'', t.image||'', t.experience||0, t.rating||5,
        t.title||null, t.bio||null,
        priceEgp, priceSar, priceUsd,
        isConsult, sessionDur,
        meetingProvider, providerUrl,
        t.featured ? 1 : 0, t.sortOrder ?? t.sort_order ?? 0,
        showHome, showAbout,
        t.isActive !== undefined ? (t.isActive ? 1 : 0) : (t.is_active !== undefined ? t.is_active : 1),
        langJson, focusJson, qualJson,
      ]
    );
    if (oldName && oldName !== (t.name || '')) {
      await conn.query(
        'UPDATE courses SET instructor=? WHERE tenant_id=? AND instructor=?',
        [t.name || '', req.tenantId, oldName]
      );
    }
    if (Array.isArray(slots)) {
      await conn.query('DELETE FROM therapist_slots WHERE therapist_id=?', [id]);
      for (const slot of slots) {
        await conn.query(
          `INSERT INTO therapist_slots
             (id, therapist_id, day, start_time, end_time, timezone, label, meeting_link, is_active)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            String(slot.id || uuidv4()).slice(0, 36), id, String(slot.day).toLowerCase(),
            slot.startTime, slot.endTime, slot.timezone || 'Africa/Cairo',
            slot.label || null, slot.meetingLink || null, slot.isActive === false ? 0 : 1,
          ]
        );
      }
    }
    await conn.commit();
    cacheInvalidate('therapists');
    res.json({ ok: true, id });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn?.release();
  }
});

// POST /api/admin/testimonials
router.post('/api/admin/testimonials', requireAuth, requireAdmin, async (req, res) => {
  try {
    const t = req.body;
    const id = t.id || uuidv4();
    const isActive = t.isActive !== undefined ? (t.isActive ? 1 : 0) : (t.is_active !== undefined ? (t.is_active ? 1 : 0) : 1);
    const sortOrder = t.sortOrder ?? t.sort_order ?? 0;
    if (t.id) {
      const [[anyRow]] = await pool.query('SELECT id, (tenant_id = ?) AS owned FROM testimonials WHERE id=? LIMIT 1', [req.tenantId, t.id]);
      if (anyRow && !anyRow.owned) return res.status(404).json({ error: 'Testimonial not found' });
    }
    await pool.query(
      `INSERT INTO testimonials (id, tenant_id, name, role, text, image, is_active, sort_order)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), text=VALUES(text),
         image=VALUES(image), is_active=VALUES(is_active), sort_order=VALUES(sort_order)`,
      [id, req.tenantId, t.name||'', t.role||'', t.text||'', t.image||'', isActive, sortOrder]
    );
    cacheInvalidate('testimonials');
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
