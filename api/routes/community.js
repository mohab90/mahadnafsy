'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Community Posts
router.get('/api/admin/community/posts', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, category, body, author, image_url, tags, featured, pinned, likes, created_at
       FROM community_posts ORDER BY created_at DESC LIMIT 500`
    );
    res.json(rows.map(r => ({ ...r, tags: tryJson(r.tags, []) })));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/community/posts', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, category, body, author, image_url, tags, featured, pinned, likes, created_at
       FROM community_posts ORDER BY created_at DESC LIMIT 200`
    );
    res.json(rows.map(r => ({ ...r, tags: tryJson(r.tags, []) })));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/community/posts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const p = req.body;
    const id = p.id || uuidv4();
    await pool.query(
      `INSERT INTO community_posts (id, title, category, body, author, image_url, tags, featured, pinned, likes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), category=VALUES(category),
         author=VALUES(author), image_url=VALUES(image_url), tags=VALUES(tags),
         featured=VALUES(featured), pinned=VALUES(pinned)`,
      [
        id, p.title || '', p.category || 'general', p.body || '', p.author || '', p.imageUrl || null,
        JSON.stringify(p.tags || []), p.featured ? 1 : 0, p.pinned ? 1 : 0, p.likes || 0,
        p.createdAt || new Date().toISOString(),
      ]
    );
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/community/posts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM community_posts WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Community Library
router.get('/api/community/library', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, category, description, file_url, thumbnail, file_type, tags, created_at
       FROM community_library ORDER BY created_at DESC LIMIT 200`
    );
    res.json(rows.map(r => ({ ...r, tags: tryJson(r.tags, []) })));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/community/library', requireAuth, requireAdmin, async (req, res) => {
  try {
    const l = req.body;
    const id = l.id || uuidv4();
    await pool.query(
      `INSERT INTO community_library (id, title, category, description, file_url, thumbnail, file_type, tags, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description), file_url=VALUES(file_url)`,
      [
        id, l.title || '', l.category || 'general', l.description || '', l.fileUrl || l.file_url || '',
        l.thumbnail || null, l.fileType || l.file_type || 'pdf', JSON.stringify(l.tags || []),
        l.createdAt || new Date().toISOString(),
      ]
    );
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/community/library/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM community_library WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Community Videos
router.get('/api/community/videos', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, category, description, video_url, thumbnail, duration, tags, created_at
       FROM community_videos ORDER BY created_at DESC LIMIT 200`
    );
    res.json(rows.map(r => ({ ...r, tags: tryJson(r.tags, []) })));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/community/videos', requireAuth, requireAdmin, async (req, res) => {
  try {
    const v = req.body;
    const id = v.id || uuidv4();
    await pool.query(
      `INSERT INTO community_videos (id, title, category, description, video_url, thumbnail, duration, tags, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description), video_url=VALUES(video_url)`,
      [
        id, v.title || '', v.category || 'general', v.description || '',
        v.videoUrl || v.video_url || '', v.thumbnail || null, v.duration || '', JSON.stringify(v.tags || []),
        v.createdAt || new Date().toISOString(),
      ]
    );
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/community/videos/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM community_videos WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Community Events
router.get('/api/community/events', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, category, description, image_url, event_date, date_label,
       location_name, registration_url, is_online, tags, created_at
       FROM community_events ORDER BY created_at DESC LIMIT 200`
    );
    res.json(rows.map(r => ({ ...r, tags: tryJson(r.tags, []) })));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/community/events', requireAuth, requireAdmin, async (req, res) => {
  try {
    const ev = req.body;
    const id = ev.id || uuidv4();
    await pool.query(
      `INSERT INTO community_events (id, title, category, description, image_url,
         event_date, date_label, location_name, registration_url, is_online, tags, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description),
         event_date=VALUES(event_date), date_label=VALUES(date_label)`,
      [
        id, ev.title || '', ev.category || 'general', ev.description || '',
        ev.imageUrl || ev.image_url || null, ev.eventDate || ev.event_date || null,
        ev.dateLabel || ev.date_label || null, ev.location || ev.location_name || null,
        ev.registrationUrl || ev.registration_url || null, ev.isOnline ? 1 : 0,
        JSON.stringify(ev.tags || []), ev.createdAt || new Date().toISOString(),
      ]
    );
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/community/events/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM community_events WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
