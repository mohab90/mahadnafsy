'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool, cached, cacheInvalidate } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { communityPostLimiter, publicLimiter } = require('../middleware/rateLimits');

const findOwnSubscriber = (req) => pool.query(
  `SELECT id, name FROM subscribers
   WHERE tenant_id=? AND (firebase_uid=? OR LOWER(TRIM(email))=LOWER(TRIM(?))) LIMIT 1`,
  [req.tenantId, req.user?.uid || '', req.user?.email || '']
).then(([[row]]) => row);

const cacheKey = (req, resource) => `community:${req.tenantId || 'tenant-default'}:${resource}:public`;
const invalidate = (req, resource) => cacheInvalidate(`community:${req.tenantId || 'tenant-default'}:${resource}`);

// Community Posts
// Map a DB row to the client-facing shape (camelCase author* + status), keeping snake-case too.
const mapPost = (r) => ({
  ...r,
  tag: r.category || '',
  tags: tryJson(r.tags, []),
  authorName: r.author || '',
  authorRole: r.author_role || '',
  authorImage: r.image_url || '',
  status: r.status || 'approved',
});

// Admin moderation list — returns ALL posts incl. pending/rejected so they can be reviewed.
router.get('/api/admin/community/posts', requireAuth, requireAdminOrStaff, requirePermission('view_community'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, category, body, author, author_role, subscriber_id, image_url, tags,
              featured, pinned, likes, status, created_at
       FROM community_posts WHERE tenant_id=? ORDER BY (status='pending') DESC, created_at DESC LIMIT 500`,
      [req.tenantId]
    );
    res.json(rows.map(mapPost));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public feed — only APPROVED posts are visible to everyone.
router.get('/api/community/posts', publicLimiter, async (req, res) => {
  try {
    const data = await cached(cacheKey(req, 'posts'), 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT id, title, category, body, author, author_role, image_url, tags, featured, pinned, likes, status, created_at
         FROM community_posts WHERE tenant_id=? AND status = 'approved' ORDER BY pinned DESC, created_at DESC LIMIT 200`,
        [req.tenantId]
      );
      return rows.map(mapPost);
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Customer-created post → saved as PENDING for admin review. Any authenticated subscriber may post.
router.post('/api/community/posts', requireAuth, communityPostLimiter, async (req, res) => {
  try {
    const p = req.body || {};
    if (!p.title?.trim() || !p.body?.trim()) return res.status(400).json({ error: 'title and body are required' });
    const id = uuidv4();
    const subscriber = await findOwnSubscriber(req);
    if (!subscriber) return res.status(403).json({ error: 'Subscriber required' });
    await pool.query(
      `INSERT INTO community_posts (id, tenant_id, title, category, body, author, author_role, subscriber_id, image_url, tags, featured, pinned, likes, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
      [
        id, req.tenantId, p.title.trim().slice(0, 200), p.tag || p.category || 'general', p.body.trim().slice(0, 5000),
        String(subscriber.name || 'عضو').slice(0, 120), 'عضو',
        subscriber.id, p.authorImage || p.imageUrl || null, JSON.stringify(p.tags || []),
        0, 0, 0, p.createdAt || new Date().toISOString(),
      ]
    );
    invalidate(req, 'posts');
    res.json({ ok: true, id, status: 'pending' });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Customer edit of THEIR OWN post (MKT-16). Editing title/body/category resends the
// post to moderation (status → pending); an engagement-only update (likes) leaves the
// current status untouched so liking an approved post doesn't hide it from the feed.
// Note: comments/commentsList are NOT persisted — community_posts has no such column,
// so the client's comment feature is currently session-local only.
router.patch('/api/community/posts/:id', requireAuth, async (req, res) => {
  try {
    const subscriber = await findOwnSubscriber(req);
    if (!subscriber) return res.status(403).json({ error: 'Subscriber required' });
    const [[existing]] = await pool.query(
      'SELECT title, category, body, subscriber_id, likes FROM community_posts WHERE tenant_id=? AND id=?',
      [req.tenantId, req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    if (existing.subscriber_id !== subscriber.id) return res.status(403).json({ error: 'Not your post' });

    const p = req.body || {};
    const nextTitle = p.title != null ? String(p.title).trim().slice(0, 200) : existing.title;
    const nextCategory = p.tag || p.category || existing.category;
    const nextBody = p.body != null ? String(p.body).trim().slice(0, 5000) : existing.body;
    const nextLikes = Number.isFinite(p.likes) ? Math.max(0, Math.trunc(p.likes)) : existing.likes;
    const contentChanged = nextTitle !== existing.title || nextCategory !== existing.category || nextBody !== existing.body;

    if (contentChanged) {
      await pool.query(
        'UPDATE community_posts SET title=?, category=?, body=?, likes=?, status=\'pending\' WHERE tenant_id=? AND id=?',
        [nextTitle, nextCategory, nextBody, nextLikes, req.tenantId, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE community_posts SET title=?, category=?, body=?, likes=? WHERE tenant_id=? AND id=?',
        [nextTitle, nextCategory, nextBody, nextLikes, req.tenantId, req.params.id]
      );
    }
    invalidate(req, 'posts');
    res.json({ ok: true, status: contentChanged ? 'pending' : undefined });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Customer delete of THEIR OWN post (MKT-16). Previously the client's delete button
// called the admin-only DELETE endpoint, which 403'd for regular subscribers while the
// UI still optimistically removed the post locally — it silently reappeared on reload.
router.delete('/api/community/posts/:id', requireAuth, async (req, res) => {
  try {
    const subscriber = await findOwnSubscriber(req);
    if (!subscriber) return res.status(403).json({ error: 'Subscriber required' });
    const [result] = await pool.query(
      'DELETE FROM community_posts WHERE tenant_id=? AND id=? AND subscriber_id=?',
      [req.tenantId, req.params.id, subscriber.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Post not found' });
    invalidate(req, 'posts');
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin create/update — persists moderation status (admin posts default to approved).
router.post('/api/admin/community/posts', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const p = req.body;
    const id = p.id || uuidv4();
    const status = p.status || 'approved';
    const values = [
      p.title || '', p.tag || p.category || 'general', p.body || '', p.authorName || p.author || '',
      p.authorRole || '', p.authorImage || p.imageUrl || null, JSON.stringify(p.tags || []),
      p.featured ? 1 : 0, p.pinned ? 1 : 0, status,
    ];
    const [updated] = p.id ? await pool.query(
      `UPDATE community_posts SET title=?, category=?, body=?, author=?, author_role=?, image_url=?, tags=?, featured=?, pinned=?, status=?
       WHERE tenant_id=? AND id=?`,
      [...values, req.tenantId, id]
    ) : [{ affectedRows: 0 }];
    if (p.id && !updated.affectedRows) return res.status(404).json({ error: 'Post not found' });
    if (!p.id) await pool.query(
      `INSERT INTO community_posts (id, tenant_id, title, category, body, author, author_role, image_url, tags, featured, pinned, likes, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, ...values.slice(0, 9), p.likes || 0, status, p.createdAt || new Date().toISOString()]
    );
    invalidate(req, 'posts');
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/community/posts/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM community_posts WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Post not found' });
    invalidate(req, 'posts');
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Community Library
router.get('/api/community/library', publicLimiter, async (req, res) => {
  try {
    const data = await cached(cacheKey(req, 'library'), 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT id, title, category, description, file_url, thumbnail, file_type, file_size, tags, created_at
         FROM community_library WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`,
        [req.tenantId]
      );
      return rows.map(r => ({ ...r, tags: tryJson(r.tags, []) }));
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/community/library', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const l = req.body;
    const id = l.id || uuidv4();
    // Admin form (DashboardCommunityAdminPanel.tsx) sends downloadUrl and
    // fileSize — added as aliases (downloadUrl alongside the pre-existing
    // fileUrl/file_url; fileSize backed by the new file_size column) so
    // neither is lost to a silent field-name/missing-column mismatch (MKT-12).
    const values = [l.title || '', l.category || 'general', l.description || '', l.downloadUrl || l.fileUrl || l.file_url || '', l.thumbnail || null, l.fileType || l.file_type || 'pdf', l.fileSize || l.file_size || null, JSON.stringify(l.tags || [])];
    const [updated] = l.id ? await pool.query(
      'UPDATE community_library SET title=?, category=?, description=?, file_url=?, thumbnail=?, file_type=?, file_size=?, tags=? WHERE tenant_id=? AND id=?',
      [...values, req.tenantId, id]
    ) : [{ affectedRows: 0 }];
    if (l.id && !updated.affectedRows) return res.status(404).json({ error: 'Library item not found' });
    if (!l.id) await pool.query(
      `INSERT INTO community_library (id, tenant_id, title, category, description, file_url, thumbnail, file_type, file_size, tags, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, ...values, l.createdAt || new Date().toISOString()]
    );
    invalidate(req, 'library');
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/community/library/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM community_library WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Library item not found' });
    invalidate(req, 'library');
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Community Videos
router.get('/api/community/videos', publicLimiter, async (req, res) => {
  try {
    const data = await cached(cacheKey(req, 'videos'), 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT id, title, category, description, video_url, thumbnail, duration, views_label, tags, created_at
         FROM community_videos WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`,
        [req.tenantId]
      );
      return rows.map(r => ({ ...r, tags: tryJson(r.tags, []) }));
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/community/videos', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const v = req.body;
    const id = v.id || uuidv4();
    // views_label (MKT-14) had no matching DB column — added.
    const values = [v.title || '', v.category || 'general', v.description || '', v.videoUrl || v.video_url || '', v.thumbnail || null, v.duration || '', v.viewsLabel || v.views_label || null, JSON.stringify(v.tags || [])];
    const [updated] = v.id ? await pool.query(
      'UPDATE community_videos SET title=?, category=?, description=?, video_url=?, thumbnail=?, duration=?, views_label=?, tags=? WHERE tenant_id=? AND id=?',
      [...values, req.tenantId, id]
    ) : [{ affectedRows: 0 }];
    if (v.id && !updated.affectedRows) return res.status(404).json({ error: 'Video not found' });
    if (!v.id) await pool.query(
      `INSERT INTO community_videos (id, tenant_id, title, category, description, video_url, thumbnail, duration, views_label, tags, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, ...values, v.createdAt || new Date().toISOString()]
    );
    invalidate(req, 'videos');
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/community/videos/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM community_videos WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Video not found' });
    invalidate(req, 'videos');
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Community Events
router.get('/api/community/events', publicLimiter, async (req, res) => {
  try {
    const data = await cached(cacheKey(req, 'events'), 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT id, title, category, description, image_url, event_date, date_label,
         location_name, registration_url, is_online, speaker, event_type, platform, tags, created_at
         FROM community_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`,
        [req.tenantId]
      );
      return rows.map(r => ({ ...r, tags: tryJson(r.tags, []) }));
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/community/events', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const ev = req.body;
    const id = ev.id || uuidv4();
    // speaker/eventType/platform (MKT-13) had no matching DB columns — added.
    const values = [
      ev.title || '', ev.category || 'general', ev.description || '', ev.imageUrl || ev.image_url || null,
      ev.eventDate || ev.event_date || null, ev.dateLabel || ev.date_label || null,
      ev.location || ev.location_name || null, ev.registrationUrl || ev.registration_url || null,
      ev.isOnline ? 1 : 0, ev.speaker || null, ev.eventType || ev.event_type || null, ev.platform || null,
      JSON.stringify(ev.tags || []),
    ];
    const [updated] = ev.id ? await pool.query(
      `UPDATE community_events SET title=?, category=?, description=?, image_url=?, event_date=?, date_label=?,
       location_name=?, registration_url=?, is_online=?, speaker=?, event_type=?, platform=?, tags=? WHERE tenant_id=? AND id=?`,
      [...values, req.tenantId, id]
    ) : [{ affectedRows: 0 }];
    if (ev.id && !updated.affectedRows) return res.status(404).json({ error: 'Event not found' });
    if (!ev.id) await pool.query(
      `INSERT INTO community_events (id, tenant_id, title, category, description, image_url,
         event_date, date_label, location_name, registration_url, is_online, speaker, event_type, platform, tags, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, ...values, ev.createdAt || new Date().toISOString()]
    );
    invalidate(req, 'events');
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/community/events/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM community_events WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Event not found' });
    invalidate(req, 'events');
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
