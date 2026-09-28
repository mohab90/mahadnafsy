'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { uuidv4 } = require('../lib/id');

const { pool, cached, cacheInvalidate } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { optionalAuth, requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { communityPostLimiter, eventRegistrationLimiter, publicLimiter } = require('../middleware/rateLimits');
const { createNotification } = require('../lib/notification');
const { toIdentity } = require('../lib/phoneNumber');

// The id this returns is the ownership key for editing and deleting posts, so
// resolving the wrong subscriber hands one member another member's posts.
//
// This used its own query until it was found to have both faults the shared
// resolver exists to prevent: it never excluded deleted customers, and its
// email arm compared `LOWER(TRIM(email))=LOWER(TRIM(''))` whenever the account
// carried no email — a wildcard matching every subscriber stored with a blank
// one. There were 24 such accounts and 24 such subscribers, so all 24 members
// resolved to whichever row came back first and shared ownership of each
// other's posts.
const findOwnSubscriber = (req) => resolveSubscriberRow(req, ['id', 'name']);

const cacheKey = (req, resource) => `community:${req.tenantId || 'tenant-default'}:${resource}:public`;
const invalidate = (req, resource) => cacheInvalidate(`community:${req.tenantId || 'tenant-default'}:${resource}`);

// Admin «إضافة» and «تعديل» send the same request, and a new item already
// carries the id the screen made for it (`ev-…`, `post-…`, `lib-…`, `vid-…`).
// So an id cannot mean "update": it did, and every add answered 404 — no
// event, admin post, library item or video could be created. An id that exists
// is updated; one that does not is created under it, so the screen's copy and
// the server's agree. The time is always the server's.
async function saveAdminRow(table, { tenantId, id, columns, values, onCreate = {} }) {
  const rowId = String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100) || uuidv4();
  const [[existing]] = await pool.query(`SELECT id FROM ${table} WHERE tenant_id=? AND id=? LIMIT 1`, [tenantId, rowId]);
  if (existing) {
    await pool.query(`UPDATE ${table} SET ${columns.map(column => `${column}=?`).join(', ')} WHERE tenant_id=? AND id=?`,
      [...values, tenantId, rowId]);
    return { id: rowId, created: false };
  }
  const extra = Object.keys(onCreate);
  const names = [...columns, ...extra, 'created_at'];
  await pool.query(
    `INSERT INTO ${table} (id, tenant_id, ${names.join(', ')}) VALUES (?, ?, ${names.map(() => '?').join(', ')})`,
    [rowId, tenantId, ...values, ...extra.map(key => onCreate[key]), new Date().toISOString()]);
  return { id: rowId, created: true };
}

// Community Posts
// Map a DB row to the client-facing shape (camelCase author* + status), keeping snake-case too.
const mapPost = (r) => ({
  ...r,
  tag: r.category || '',
  tags: tryJson(r.tags, []),
  authorName: r.author || '',
  authorRole: r.author_role || '',
  authorImage: r.image_url || '',
  createdAt: r.created_at || '',
  comments: Number(r.comments || 0),
  status: r.status || 'approved',
});

async function attachComments(rows, tenantId) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const [comments] = await pool.query(
    `SELECT id, post_id, author, body, created_at
     FROM community_post_comments
     WHERE tenant_id=? AND post_id IN (${placeholders})
     ORDER BY created_at ASC LIMIT 1000`,
    [tenantId, ...ids]
  );
  const grouped = new Map();
  for (const comment of comments) {
    const list = grouped.get(comment.post_id) || [];
    list.push({
      id: comment.id,
      author: comment.author,
      body: comment.body,
      at: comment.created_at,
    });
    grouped.set(comment.post_id, list);
  }
  return rows.map((row) => ({
    ...mapPost(row),
    commentsList: grouped.get(row.id) || [],
  }));
}

// Admin moderation list — returns ALL posts incl. pending/rejected so they can be reviewed.
router.get('/api/admin/community/posts', requireAuth, requireAdminOrStaff, requirePermission('view_community'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, category, body, author, author_role, subscriber_id, image_url, tags,
              featured, pinned, likes, status, created_at,
              (SELECT COUNT(*) FROM community_post_comments c
               WHERE c.tenant_id=community_posts.tenant_id AND c.post_id=community_posts.id) AS comments
       FROM community_posts WHERE tenant_id=? ORDER BY (status='pending') DESC, created_at DESC LIMIT 500`,
      [req.tenantId]
    );
    res.json(await attachComments(rows, req.tenantId));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public feed — only APPROVED posts are visible to everyone.
// optionalAuth, not requireAuth: the feed stays public, but a signed-in
// member has to be recognised. The server already refuses to edit or delete a
// post that is not yours — it just never told the page which ones were, so the
// author's own controls never rendered and a post still awaiting moderation
// disappeared from its own author's view the moment they reloaded.
router.get('/api/community/posts', publicLimiter, optionalAuth, async (req, res) => {
  try {
    const data = await cached(cacheKey(req, 'posts'), 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT id, title, category, body, author, author_role, image_url, tags, featured, pinned, likes, status, created_at,
                (SELECT COUNT(*) FROM community_post_comments c
                 WHERE c.tenant_id=p.tenant_id AND c.post_id=p.id) AS comments
         FROM community_posts p WHERE tenant_id=? AND status = 'approved' ORDER BY pinned DESC, created_at DESC LIMIT 200`,
        [req.tenantId]
      );
      return attachComments(rows, req.tenantId);
    });

    // Ownership is per viewer, so it is resolved after the shared cache and
    // never written into it — the cached rows are copied, not marked in place.
    const viewer = req.user ? await findOwnSubscriber(req).catch(() => null) : null;
    if (!viewer) {
      res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
      return res.json(data);
    }
    const [ownRows] = await pool.query(
      `SELECT id, title, category, body, author, author_role, image_url, tags, featured, pinned, likes, status, created_at,
                (SELECT COUNT(*) FROM community_post_comments c
                 WHERE c.tenant_id=p.tenant_id AND c.post_id=p.id) AS comments
         FROM community_posts p WHERE tenant_id=? AND subscriber_id=? ORDER BY created_at DESC LIMIT 100`,
      [req.tenantId, viewer.id]
    );
    const ownIds = new Set(ownRows.map(row => row.id));
    const pendingOwn = await attachComments(
      ownRows.filter(row => row.status !== 'approved'), req.tenantId);
    const feed = [
      ...pendingOwn.map(post => ({ ...post, isOwner: true })),
      ...data.map(post => (ownIds.has(post.id) ? { ...post, isOwner: true } : post)),
    ];
    // A personalised body must not sit in a shared cache.
    res.set('Cache-Control', 'private, no-store');
    res.json(feed);
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
    // Said in words the page can show: this came back as «Subscriber required»
    // and the page replaced it with «تأكد من تسجيل الدخول» — to someone signed in.
    if (!subscriber) {
      return res.status(403).json({
        error: 'النشر في المجتمع لمشتركي المعهد — الحساب ده لسه مش مربوط باشتراك. لو انت مشترك تواصل مع الدعم.',
        code: 'SUBSCRIBER_REQUIRED',
      });
    }
    const title = p.title.trim().slice(0, 200);
    const author = String(subscriber.name || 'عضو').slice(0, 120);
    // The time is the server's: the page sent «الآن» and it was stored as the
    // date, which then sorted and displayed as text.
    await pool.query(
      `INSERT INTO community_posts (id, tenant_id, title, category, body, author, author_role, subscriber_id, image_url, tags, featured, pinned, likes, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
      [
        id, req.tenantId, title, p.tag || p.category || 'general', p.body.trim().slice(0, 5000),
        author, 'عضو',
        subscriber.id, p.authorImage || p.imageUrl || null, JSON.stringify(p.tags || []),
        0, 0, 0, new Date().toISOString(),
      ]
    );
    invalidate(req, 'posts');
    // The desk hears of it: a pending post used to wait for someone to happen
    // to reload the community screen.
    createNotification('community', '💬 منشور جديد في المجتمع مستني المراجعة', `${author}: ${title}`,
      { postId: id }, req.tenantId).catch(() => {});
    res.json({ ok: true, id, status: 'pending' });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Customer edit of THEIR OWN post. Editing content resends it to moderation.
router.patch('/api/community/posts/:id', requireAuth, async (req, res) => {
  try {
    const subscriber = await findOwnSubscriber(req);
    if (!subscriber) return res.status(403).json({ error: 'Subscriber required' });
    const [[existing]] = await pool.query(
      'SELECT title, category, body, subscriber_id FROM community_posts WHERE tenant_id=? AND id=?',
      [req.tenantId, req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    if (existing.subscriber_id !== subscriber.id) return res.status(403).json({ error: 'Not your post' });

    const p = req.body || {};
    const nextTitle = p.title != null ? String(p.title).trim().slice(0, 200) : existing.title;
    const nextCategory = p.tag || p.category || existing.category;
    const nextBody = p.body != null ? String(p.body).trim().slice(0, 5000) : existing.body;
    const contentChanged = nextTitle !== existing.title || nextCategory !== existing.category || nextBody !== existing.body;

    if (contentChanged) {
      await pool.query(
        'UPDATE community_posts SET title=?, category=?, body=?, status=\'pending\' WHERE tenant_id=? AND id=?',
        [nextTitle, nextCategory, nextBody, req.tenantId, req.params.id]
      );
    }
    invalidate(req, 'posts');
    res.json({ ok: true, status: contentChanged ? 'pending' : undefined });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/community/posts/:id/like', requireAuth, communityPostLimiter, async (req, res) => {
  let connection;
  try {
    const subscriber = await findOwnSubscriber(req);
    if (!subscriber) return res.status(403).json({ error: 'Subscriber required' });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[post]] = await connection.query(
      "SELECT id FROM community_posts WHERE tenant_id=? AND id=? AND status='approved' FOR UPDATE",
      [req.tenantId, req.params.id]
    );
    if (!post) {
      await connection.rollback();
      return res.status(404).json({ error: 'Post not found' });
    }
    const [[existingLike]] = await connection.query(
      'SELECT post_id FROM community_post_likes WHERE tenant_id=? AND post_id=? AND subscriber_id=? FOR UPDATE',
      [req.tenantId, req.params.id, subscriber.id]
    );
    const liked = !existingLike;
    if (liked) {
      await connection.query(
        'INSERT INTO community_post_likes (tenant_id, post_id, subscriber_id) VALUES (?,?,?)',
        [req.tenantId, req.params.id, subscriber.id]
      );
      await connection.query(
        'UPDATE community_posts SET likes=likes+1 WHERE tenant_id=? AND id=?',
        [req.tenantId, req.params.id]
      );
    } else {
      await connection.query(
        'DELETE FROM community_post_likes WHERE tenant_id=? AND post_id=? AND subscriber_id=?',
        [req.tenantId, req.params.id, subscriber.id]
      );
      await connection.query(
        'UPDATE community_posts SET likes=GREATEST(likes-1,0) WHERE tenant_id=? AND id=?',
        [req.tenantId, req.params.id]
      );
    }
    const [[countRow]] = await connection.query(
      'SELECT likes FROM community_posts WHERE tenant_id=? AND id=?',
      [req.tenantId, req.params.id]
    );
    const likes = Number(countRow.likes || 0);
    await connection.commit();
    invalidate(req, 'posts');
    res.json({ ok: true, liked, likes });
  } catch (e) {
    if (connection) await connection.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    connection?.release();
  }
});

router.post('/api/community/posts/:id/comments', requireAuth, communityPostLimiter, async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'Comment body is required' });
    const subscriber = await findOwnSubscriber(req);
    if (!subscriber) return res.status(403).json({ error: 'Subscriber required' });
    const [[post]] = await pool.query(
      "SELECT id FROM community_posts WHERE tenant_id=? AND id=? AND status='approved'",
      [req.tenantId, req.params.id]
    );
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const id = uuidv4();
    const author = String(subscriber.name || 'عضو').slice(0, 200);
    await pool.query(
      `INSERT INTO community_post_comments
       (id, tenant_id, post_id, subscriber_id, author, body, created_at)
       VALUES (?,?,?,?,?,?,NOW())`,
      [id, req.tenantId, req.params.id, subscriber.id, author, body]
    );
    invalidate(req, 'posts');
    res.json({ ok: true, comment: { id, author, body, at: new Date().toISOString() } });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Customer delete of THEIR OWN post (MKT-16). Previously the client's delete button
// called the admin-only DELETE endpoint, which 403'd for regular subscribers while the
// UI still optimistically removed the post locally — it silently reappeared on reload.
router.delete('/api/community/posts/:id', requireAuth, async (req, res) => {
  let connection;
  try {
    const subscriber = await findOwnSubscriber(req);
    if (!subscriber) return res.status(403).json({ error: 'Subscriber required' });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.query(
      'DELETE FROM community_posts WHERE tenant_id=? AND id=? AND subscriber_id=?',
      [req.tenantId, req.params.id, subscriber.id]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ error: 'Post not found' });
    }
    await connection.query(
      'DELETE FROM community_post_likes WHERE tenant_id=? AND post_id=?',
      [req.tenantId, req.params.id]
    );
    await connection.query(
      'DELETE FROM community_post_comments WHERE tenant_id=? AND post_id=?',
      [req.tenantId, req.params.id]
    );
    await connection.commit();
    invalidate(req, 'posts');
    res.json({ ok: true });
  } catch (e) {
    if (connection) await connection.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    connection?.release();
  }
});

// Admin create/update — persists moderation status (admin posts default to approved).
router.post('/api/admin/community/posts', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const p = req.body || {};
    const { id } = await saveAdminRow('community_posts', {
      tenantId: req.tenantId, id: p.id,
      columns: ['title', 'category', 'body', 'author', 'author_role', 'image_url', 'tags', 'featured', 'pinned', 'status'],
      values: [
        p.title || '', p.tag || p.category || 'general', p.body || '', p.authorName || p.author || '',
        p.authorRole || '', p.authorImage || p.imageUrl || null, JSON.stringify(p.tags || []),
        p.featured ? 1 : 0, p.pinned ? 1 : 0, p.status || 'approved',
      ],
      onCreate: { likes: 0 },
    });
    invalidate(req, 'posts');
    res.json({ ok: true, id });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/community/posts/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.query('DELETE FROM community_posts WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ error: 'Post not found' });
    }
    await connection.query('DELETE FROM community_post_likes WHERE tenant_id=? AND post_id=?', [req.tenantId, req.params.id]);
    await connection.query('DELETE FROM community_post_comments WHERE tenant_id=? AND post_id=?', [req.tenantId, req.params.id]);
    await connection.commit();
    invalidate(req, 'posts');
    res.json({ ok: true });
  } catch (e) {
    if (connection) await connection.rollback().catch(() => {});
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    connection?.release();
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
      // Mapped, unlike the posts beside it which have always gone through
      // mapPost. The page reads item.fileType and calls .toLowerCase() on it,
      // so a raw row threw — and the ErrorBoundary wraps the whole layout, so
      // opening «المكتبة الرقمية» took down the entire page, nav included, and
      // printed the raw English error underneath. item.downloadUrl was
      // undefined for the same reason, so nothing was downloadable either.
      return rows.map(r => ({
        id: r.id,
        title: r.title,
        category: r.category,
        description: r.description,
        downloadUrl: r.file_url,
        thumbnail: r.thumbnail,
        fileType: r.file_type || '',
        fileSize: r.file_size,
        tags: tryJson(r.tags, []),
        createdAt: r.created_at,
      }));
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
    const l = req.body || {};
    // Admin form (DashboardCommunityAdminPanel.tsx) sends downloadUrl and
    // fileSize — added as aliases (downloadUrl alongside the pre-existing
    // fileUrl/file_url; fileSize backed by the new file_size column) so
    // neither is lost to a silent field-name/missing-column mismatch (MKT-12).
    const { id } = await saveAdminRow('community_library', {
      tenantId: req.tenantId, id: l.id,
      columns: ['title', 'category', 'description', 'file_url', 'thumbnail', 'file_type', 'file_size', 'tags'],
      values: [l.title || '', l.category || 'general', l.description || '', l.downloadUrl || l.fileUrl || l.file_url || '',
        l.thumbnail || null, l.fileType || l.file_type || 'pdf', l.fileSize || l.file_size || null, JSON.stringify(l.tags || [])],
    });
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
      // video.videoUrl decides whether a video is playable at all: without it
      // every one carried a «قريباً» badge, the «مشاهدة» button never rendered
      // and clicking did nothing. The admin write route already accepted both
      // spellings; only this read was left raw.
      return rows.map(r => ({
        id: r.id,
        title: r.title,
        category: r.category,
        description: r.description,
        videoUrl: r.video_url,
        thumbnail: r.thumbnail,
        duration: r.duration,
        viewsLabel: r.views_label,
        tags: tryJson(r.tags, []),
        createdAt: r.created_at,
      }));
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
    const v = req.body || {};
    // views_label (MKT-14) had no matching DB column — added.
    const { id } = await saveAdminRow('community_videos', {
      tenantId: req.tenantId, id: v.id,
      columns: ['title', 'category', 'description', 'video_url', 'thumbnail', 'duration', 'views_label', 'tags'],
      values: [v.title || '', v.category || 'general', v.description || '', v.videoUrl || v.video_url || '', v.thumbnail || null,
        v.duration || '', v.viewsLabel || v.views_label || null, JSON.stringify(v.tags || [])],
    });
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
//
// Each event has a page of its own, /community/events/<slug>, with its
// picture, full text, lecturers (the site's instructors) and whether it is
// online or in person, and a place to register interest with a name and a
// number (migration 222).

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An address from the title, Arabic kept: «ورشة الصحة النفسية» → ورشة-الصحة-النفسية. */
function slugify(title) {
  return String(title || '').trim().toLowerCase()
    .replace(/[\p{M}ـ]/gu, '')          // tashkeel and tatweel
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'event';
}

async function uniqueEventSlug(tenantId, title) {
  const base = slugify(title);
  const [rows] = await pool.query(
    'SELECT slug FROM community_events WHERE tenant_id=? AND (slug=? OR slug LIKE ?)', [tenantId, base, `${base}-%`]);
  const taken = new Set(rows.map(row => row.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

const EVENT_COLS = `id, slug, title, category, description, content, image_url, event_date, event_time, date_label,
  location_name, registration_url, is_online, speaker, speaker_ids, event_type, platform, tags, created_at`;

// Lecturers by id, and how many have registered, for a set of events.
async function eventExtras(tenantId, rows) {
  const speakerIds = [...new Set(rows.flatMap(row => tryJson(row.speaker_ids, [])).map(String))];
  const speakers = new Map();
  if (speakerIds.length) {
    const [found] = await pool.query(
      `SELECT id, name, title, specialty, image FROM therapists
        WHERE tenant_id=? AND id IN (${speakerIds.map(() => '?').join(',')})`, [tenantId, ...speakerIds]);
    found.forEach(person => speakers.set(String(person.id), {
      id: person.id, name: person.name, title: person.title || person.specialty || '', image: person.image || '',
    }));
  }
  const counts = new Map();
  if (rows.length) {
    const [registered] = await pool.query(
      `SELECT event_id, COUNT(*) AS n FROM community_event_registrations
        WHERE tenant_id=? AND event_id IN (${rows.map(() => '?').join(',')}) GROUP BY event_id`,
      [tenantId, ...rows.map(row => row.id)]);
    registered.forEach(row => counts.set(row.event_id, Number(row.n) || 0));
  }
  return { speakers, counts };
}

// The picture is stored as the image itself (the admin compresses it in the
// browser). It is served from an address of its own rather than inside every
// list, and that address is what a shared link's preview can use; ?v changes
// with the picture so a new one is not hidden behind the old one's cache.
const IMAGE_PATH = /^\/api\/community\/events\/[^/]+\/image/;
function eventImageUrl(row) {
  const image = String(row.image_url || '');
  if (!image.startsWith('data:')) return image || null;
  const version = crypto.createHash('sha1').update(image).digest('hex').slice(0, 10);
  return `/api/community/events/${encodeURIComponent(row.id)}/image?v=${version}`;
}

function mapEvent(row, { speakers, counts }) {
  const ids = tryJson(row.speaker_ids, []).map(String);
  // eventDate drives the whole calendar: the grid matched on it, the month
  // filter fell through to "show everything" because it was always undefined.
  return {
    id: row.id,
    slug: row.slug || row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    content: row.content || '',
    imageUrl: eventImageUrl(row),
    eventDate: row.event_date,
    eventTime: row.event_time || '',
    dateLabel: row.date_label,
    locationName: row.location_name,
    registrationUrl: row.registration_url,
    isOnline: !!row.is_online,
    speaker: row.speaker,
    speakerIds: ids,
    speakers: ids.map(id => speakers.get(id)).filter(Boolean),
    eventType: row.event_type,
    platform: row.platform,
    tags: tryJson(row.tags, []),
    registrations: counts.get(row.id) || 0,
    createdAt: row.created_at,
  };
}

router.get('/api/community/events', publicLimiter, async (req, res) => {
  try {
    const data = await cached(cacheKey(req, 'events'), 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT ${EVENT_COLS} FROM community_events WHERE tenant_id=? ORDER BY event_date DESC, created_at DESC LIMIT 200`,
        [req.tenantId]
      );
      const extras = await eventExtras(req.tenantId, rows);
      return rows.map(row => mapEvent(row, extras));
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/community/events/:id/image', publicLimiter, async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT image_url FROM community_events WHERE tenant_id=? AND id=? LIMIT 1',
      [req.tenantId, req.params.id]);
    const image = String(row?.image_url || '');
    const data = image.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/);
    if (data) {
      res.set('Content-Type', data[1]);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(data[2], 'base64'));
    }
    if (/^https:\/\//.test(image)) return res.redirect(302, image);
    res.status(404).end();
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).end();
  }
});

// One event's page, by its address or its id.
router.get('/api/community/events/:slug', publicLimiter, async (req, res) => {
  try {
    const key = String(req.params.slug || '').slice(0, 160);
    const [[row]] = await pool.query(
      `SELECT ${EVENT_COLS} FROM community_events WHERE tenant_id=? AND (slug=? OR id=?) LIMIT 1`, [req.tenantId, key, key]);
    if (!row) return res.status(404).json({ error: 'الفعالية غير موجودة' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(mapEvent(row, await eventExtras(req.tenantId, [row])));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// «زر اهتمام وتسجيل اسم ورقم فقط». The same number twice is one registration.
router.post('/api/community/events/:id/register', eventRegistrationLimiter, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 200);
    const phone = String(req.body?.phone || '').trim().slice(0, 40);
    const identity = toIdentity(phone);
    if (name.length < 2) return res.status(400).json({ error: 'اكتب اسمك' });
    if (identity.length < 8) return res.status(400).json({ error: 'اكتب رقم موبايل صحيح' });
    const key = String(req.params.id || '').slice(0, 160);
    const [[event]] = await pool.query(
      'SELECT id, title FROM community_events WHERE tenant_id=? AND (id=? OR slug=?) LIMIT 1', [req.tenantId, key, key]);
    if (!event) return res.status(404).json({ error: 'الفعالية غير موجودة' });
    const [result] = await pool.query(
      `INSERT INTO community_event_registrations (id, tenant_id, event_id, name, phone, phone_identity)
       VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone)`,
      [uuidv4(), req.tenantId, event.id, name, phone, identity]);
    const alreadyRegistered = result.affectedRows !== 1;
    if (!alreadyRegistered) {
      createNotification('community', '📅 تسجيل جديد في فعالية', `${name} سجّل اهتمامه بـ «${event.title}»`,
        { eventId: event.id, phone }, req.tenantId).catch(() => {});
    }
    invalidate(req, 'events');
    res.json({ ok: true, alreadyRegistered });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/community/events/:id/registrations', requireAuth, requireAdminOrStaff, requirePermission('view_community'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, phone, created_at FROM community_event_registrations
        WHERE tenant_id=? AND event_id=? ORDER BY created_at DESC LIMIT 2000`, [req.tenantId, req.params.id]);
    res.json(rows.map(row => ({ id: row.id, name: row.name, phone: row.phone, createdAt: row.created_at })));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/community/events', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const ev = req.body || {};
    const title = String(ev.title || '').trim().slice(0, 500);
    if (!title) return res.status(400).json({ error: 'عنوان الفعالية مطلوب' });
    const eventDate = DATE.test(String(ev.eventDate || '')) ? ev.eventDate : null;
    const eventTime = TIME.test(String(ev.eventTime || '')) ? ev.eventTime : null;
    const speakerIds = (Array.isArray(ev.speakerIds) ? ev.speakerIds : []).map(String).filter(Boolean).slice(0, 20);
    // The address is set once: a link already shared keeps working when the
    // title is edited later.
    const rowId = String(ev.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
    const [[current]] = rowId
      ? await pool.query('SELECT slug, image_url FROM community_events WHERE tenant_id=? AND id=?', [req.tenantId, rowId])
      : [[null]];
    const slug = current?.slug || await uniqueEventSlug(req.tenantId, title);
    // The form shows the picture by its address; sent back unchanged, that
    // address means "keep the picture", not a new one.
    const imageUrl = IMAGE_PATH.test(String(ev.imageUrl || '')) ? (current?.image_url || null) : (ev.imageUrl || null);
    const { id } = await saveAdminRow('community_events', {
      tenantId: req.tenantId, id: rowId,
      columns: ['title', 'category', 'description', 'content', 'image_url', 'event_date', 'event_time', 'date_label',
        'location_name', 'registration_url', 'is_online', 'speaker', 'speaker_ids', 'event_type', 'platform', 'tags', 'slug'],
      values: [
        title, ev.category || 'general', String(ev.description || '').slice(0, 1000), String(ev.content || '').slice(0, 60000),
        imageUrl, eventDate, eventTime, ev.dateLabel || null,
        ev.locationName || null, ev.registrationUrl || null, ev.isOnline === false ? 0 : 1,
        String(ev.speaker || '').slice(0, 200) || null, JSON.stringify(speakerIds), ev.eventType || null,
        ev.isOnline === false ? null : (ev.platform || null), JSON.stringify(ev.tags || []), slug,
      ],
    });
    invalidate(req, 'events');
    res.json({ ok: true, id, slug });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/community/events/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_community'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM community_events WHERE tenant_id=? AND id=?', [req.tenantId, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Event not found' });
    await pool.query('DELETE FROM community_event_registrations WHERE tenant_id=? AND event_id=?', [req.tenantId, req.params.id]);
    invalidate(req, 'events');
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
