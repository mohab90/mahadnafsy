'use strict';
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool, cacheInvalidate } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.post('/api/admin/lectures', requireAuth, requireAdmin, async (req, res) => {
  try {
    const l = req.body;
    const id = l.id || uuidv4();
    // Support both camelCase (frontend) and snake_case field names
    const courseId      = l.courseId      || l.course_id      || null;
    const chapterId     = l.chapterId     || l.chapter_id     || null;
    const videoUrl      = l.videoUrl      || l.video_url      || '';
    const sortOrder     = l.order         ?? l.sortOrder      ?? l.sort_order     ?? 0;
    const lectureType   = (l.lectureType  || l.lecture_type   || 'RECORDED').toUpperCase();
    const description   = l.description   || '';
    const isPreview     = l.isPreview     != null ? (l.isPreview     ? 1 : 0) : (l.is_preview     != null ? (l.is_preview     ? 1 : 0) : 0);
    const isPublished   = l.isPublished   != null ? (l.isPublished   ? 1 : 0) : (l.is_published   != null ? (l.is_published   ? 1 : 0) : 1);
    const dripUnlockDays = l.dripUnlockDays ?? l.drip_unlock_days ?? 0;
    await pool.query(
      `INSERT INTO course_lectures (id, course_id, chapter_id, title, lecture_type, video_url, duration, sort_order, description, is_preview, is_published, drip_unlock_days)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), video_url=VALUES(video_url),
         chapter_id=VALUES(chapter_id), course_id=VALUES(course_id),
         lecture_type=VALUES(lecture_type), duration=VALUES(duration),
         sort_order=VALUES(sort_order), description=VALUES(description),
         is_preview=VALUES(is_preview), is_published=VALUES(is_published),
         drip_unlock_days=VALUES(drip_unlock_days)`,
      [id, courseId, chapterId, l.title||'Untitled', lectureType, videoUrl, l.duration||'', sortOrder, description, isPreview, isPublished, dripUnlockDays]
    );
    cacheInvalidate('courses');
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/lectures/:id
router.delete('/api/admin/lectures/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM course_lectures WHERE id = ?', [req.params.id]);
    cacheInvalidate('courses');
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/chapters
router.post('/api/admin/chapters', requireAuth, requireAdmin, async (req, res) => {
  try {
    const c = req.body;
    const id = c.id || uuidv4();
    // Support both camelCase (frontend) and snake_case field names
    const courseId  = c.courseId  || c.course_id  || null;
    const sortOrder = c.order     ?? c.sortOrder  ?? c.sort_order ?? 0;
    await pool.query(
      `INSERT INTO course_chapters (id, course_id, title, sort_order)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), sort_order=VALUES(sort_order)`,
      [id, courseId, c.title||'', sortOrder]
    );
    cacheInvalidate('courses');
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/admin/chapters/:id
router.delete('/api/admin/chapters/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM course_chapters WHERE id = ?', [req.params.id]);
    cacheInvalidate('courses');
    res.json({ ok: true });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/therapists
router.post('/api/admin/therapists', requireAuth, requireAdmin, async (req, res) => {
  try {
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
    await pool.query(
      `INSERT INTO therapists
         (id, name, specialty, image, experience, rating, title, bio,
          price_egp, price_sar, price_usd,
          is_consultation_enabled, session_duration_minutes,
          meeting_provider, provider_base_url,
          featured, sort_order, show_on_home, show_on_about, is_active,
          languages_json, focus_areas_json, qualifications_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         name=VALUES(name), specialty=VALUES(specialty), image=VALUES(image),
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
        id, t.name||'', t.specialty||'', t.image||'', t.experience||0, t.rating||5,
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
    cacheInvalidate('therapists');
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/testimonials
router.post('/api/admin/testimonials', requireAuth, requireAdmin, async (req, res) => {
  try {
    const t = req.body;
    const id = t.id || uuidv4();
    const isActive = t.isActive !== undefined ? (t.isActive ? 1 : 0) : (t.is_active !== undefined ? (t.is_active ? 1 : 0) : 1);
    const sortOrder = t.sortOrder ?? t.sort_order ?? 0;
    await pool.query(
      `INSERT INTO testimonials (id, name, role, text, image, is_active, sort_order)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), text=VALUES(text),
         image=VALUES(image), is_active=VALUES(is_active), sort_order=VALUES(sort_order)`,
      [id, t.name||'', t.role||'', t.text||'', t.image||'', isActive, sortOrder]
    );
    cacheInvalidate('testimonials');
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
