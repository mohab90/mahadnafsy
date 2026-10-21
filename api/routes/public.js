'use strict';
const logger = require('../lib/logger');
const { listCustomerTimeline } = require('../lib/customerTimeline');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { Router } = require('express');
const QRCode = require('qrcode');
const path = require('node:path');
const router = Router();

const { uuidv4 } = require('../lib/id');

const { pool, cached, cacheInvalidate } = require('../lib/db');
const { parseLimit, parseOffset, sanitize, tryJson, validate } = require('../lib/helpers');
const { getBrandSettings } = require('../lib/brandSettings');
const { escapeHtml } = require('../lib/html');
const { certificateHtml, certificateFormHtml } = require('../lib/certificateHtml');
const { getTenantSetting } = require('../lib/tenantSettings');
const { COURSE_COLS, COURSE_LIST_COLS, mapCourse, mapBundle, mapTherapist, mapLecture, mapChapter, mapSubscriber, mapQuiz, loadCourseMaterials, LIVE_STREAM_COLS, mapLiveStream } = require('../lib/mappers');
const { recordQuizAttempt } = require('../lib/quizAttempts');
const { sendEmail, htmlEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { optionalAuth, requireAuth, requireAdmin, requireAdminOrStaff, requireAnyPermission, requirePermission } = require('../middleware/auth');
const { setOnlineUser } = require('../lib/onlineUsers');
const { publicLimiter, contactLimiter } = require('../middleware/rateLimits');
const { resolveClientContext, getClientIp, hashClientIp } = require('../lib/clientContext');
const { itemBalances } = require('../lib/agreedPrice');
const { capturePublicLead } = require('../lib/publicLead');
const metaCapi = require('../lib/metaCapi');
const joinApplication = require('../lib/joinApplication');
const { effectiveCertificate, missingForCertificate } = require('../lib/certificateEnglish');
const { verifyCertificate } = require('../lib/certificateVerification');
const { SYSTEM_SEARCH_PERMISSIONS, searchSystem } = require('../lib/systemSearch');
const { scalarFields } = require('../lib/inputFields');

// The contact form's subjects that are sales' to answer (client/pages/Contact.tsx).
const SALES_SUBJECTS = new Map([['courses', 'استفسار عن الدبلومات والبرامج'], ['payment', 'استفسار عن الدفع والأسعار']]);

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/search?q=... — tenant-safe public catalogue search.
// Community content is deliberately excluded until the legacy community tables
// have explicit tenant ownership; returning it here would bypass SaaS isolation.
router.get('/api/public/client-context', publicLimiter, optionalAuth, async (req, res) => {
  const clientContext = await resolveClientContext(req);
  res.set('Cache-Control', 'private, no-store');
  res.set('Vary', 'CF-IPCountry, X-Vercel-IP-Country, CloudFront-Viewer-Country');
  if (!clientContext.locationResolved) {
    return res.status(503).json({
      error: 'Customer location could not be verified',
      code: 'LOCATION_UNAVAILABLE',
    });
  }
  if (req.user?.uid) {
    pool.query(
      `UPDATE users SET last_country_code=?, preferred_currency=?, last_geo_at=NOW()
        WHERE id=? AND tenant_id=? AND active_session_id=?`,
      [clientContext.countryCode, clientContext.currency, req.user.uid, req.tenantId, req.user.session_id]
    ).catch(error => logger.warn('[client-context] user context update failed', error.message));
  }
  res.json(clientContext);
});

// GET /api/search?scope=system&q=… — the same box for the institute's own staff:
// clients, leads, payments by transaction number, certificates and tickets, each
// for an account that may open it and inside its scope (lib/systemSearch.js).
// Signed in, staff, and holding one of the kinds' permissions — or refused, as
// any admin route refuses; without scope=system the public catalogue answers.
const SYSTEM_SEARCH_GUARD = [requireAuth, requireAdminOrStaff, requireAnyPermission(...SYSTEM_SEARCH_PERMISSIONS)];
const runGuards = (guards, req, res, done) => guards.reduceRight((next, guard) => () => guard(req, res, next), done)();
async function answerSystemSearch(req, res) {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await searchSystem(req, req.query.q));
  } catch (e) {
    logger.error('[system-search]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

router.get('/api/search', publicLimiter, async (req, res) => {
  if (req.query.scope === 'system') return runGuards(SYSTEM_SEARCH_GUARD, req, res, () => answerSystemSearch(req, res));
  try {
    const query = sanitize(String(req.query.q || '').trim(), 80);
    if (query.length < 2) return res.json({ courses: [], bundles: [], articles: [] });

    const escaped = query.replace(/=/g, '==').replace(/%/g, '=%').replace(/_/g, '=_');
    const like = `%${escaped}%`;
    const [courses, bundles] = await Promise.all([
      pool.query(
        `SELECT id, slug, title, short_description, thumbnail, category
           FROM courses
          WHERE tenant_id=? AND is_published=1
            AND (title LIKE ? ESCAPE '=' OR short_description LIKE ? ESCAPE '=' OR category LIKE ? ESCAPE '=')
          ORDER BY sort_order ASC, created_at DESC LIMIT 8`,
        [req.tenantId, like, like, like]
      ).then(([rows]) => rows),
      // No `thumbnail` column on bundles — selecting it made MySQL reject the
      // whole statement, and because both queries run in one Promise.all the
      // route answered 500 for *every* search term, courses included. The
      // search UI treats the image as optional, so there is nothing to replace
      // it with; it simply must not be asked for.
      pool.query(
        `SELECT id, slug, title, short_description
           FROM bundles
          WHERE tenant_id=? AND is_published=1
            AND (title LIKE ? ESCAPE '=' OR short_description LIKE ? ESCAPE '=')
          ORDER BY sort_order ASC, created_at DESC LIMIT 6`,
        [req.tenantId, like, like]
      ).then(([rows]) => rows),
    ]);

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    res.json({
      courses: courses.map(row => ({
        id: row.id, slug: row.slug, title: row.title,
        shortDescription: row.short_description, thumbnail: row.thumbnail, category: row.category,
      })),
      bundles: bundles.map(row => ({
        id: row.id, slug: row.slug, title: row.title,
        shortDescription: row.short_description,
      })),
      articles: [],
    });
  } catch (e) {
    logger.error('[public/search]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Local QR generation keeps certificates and payment links independent from
// third-party image services and avoids leaking certificate payloads externally.
router.get('/api/qr', publicLimiter, async (req, res) => {
  try {
    const data = String(req.query.data || '').slice(0, 1000);
    if (!data) return res.status(400).json({ error: 'data required' });
    const size = Math.min(300, Math.max(64, Number.parseInt(req.query.size, 10) || 90));
    const svg = await QRCode.toString(data, {
      type: 'svg', width: size, margin: 1,
      color: { dark: '#8B0000', light: '#FFFFFF' },
    });
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.send(svg);
  } catch (e) {
    logger.error('[public/qr]', e.message);
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// GET /api/courses?limit=100&offset=0
router.get('/api/courses', publicLimiter, async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 100, 500);
    const offset = parseOffset(req.query.offset);
    const data = await cached(`courses:${req.tenantId}:${limit}:${offset}`, 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT ${COURSE_LIST_COLS},
                -- Archived customers were still counted as students here, while
                -- the admin screens exclude them — which is the whole of the
                -- "151 on the site, 150 in the panel" discrepancy. A removed
                -- customer is not a student, so the public number was the wrong
                -- one of the two.
                (SELECT COUNT(DISTINCT e.subscriber_id) FROM enrollments e
                   JOIN subscribers s ON s.id = e.subscriber_id AND s.tenant_id = e.tenant_id
                  WHERE e.course_id = courses.id AND e.tenant_id = courses.tenant_id
                    AND s.deleted_at IS NULL) AS enrolled_count
           FROM courses WHERE tenant_id=? AND is_published = 1
         ORDER BY sort_order ASC, created_at DESC LIMIT ? OFFSET ?`,
        [req.tenantId, limit, offset]
      );
      // One argument on purpose: map would otherwise pass the index as
      // mapCourse's `materials`, and every course after the first shipped
      // `materials: <index>` — a number — to screens that iterate it.
      return rows.map(row => mapCourse(row));
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/branches — active branches (dynamic, cached). Falls back to constants.
router.get('/api/branches', publicLimiter, async (req, res) => {
  try {
    const { listBranches } = require('../lib/branchesRepo');
    res.set('Cache-Control', 'public, max-age=300');
    res.json(await listBranches(req.tenantId));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Branch management ────────────────────────────────────────────────────────
//
// /api/branches has always been read-only, and the `branches` table is empty,
// so every branch list in the system has been falling back to the six hardcoded
// constants — which is why the branches offered when a customer registers
// interest are not the institute's real ones, and why there was no way to add
// one. A name is the only thing genuinely required; a key is derived from it
// and everything else has a sensible default, because demanding a timezone and
// a currency to write down "فرع المعادي" is what made this feel impossible.
const BRANCH_TYPES = new Set(['online', 'physical', 'hybrid', 'other']);

const branchKeyFrom = (value) => String(value || '')
  .trim().toUpperCase()
  .replace(/[\s-]+/g, '_')
  .replace(/[^A-Z0-9_؀-ۿ]/g, '')
  .slice(0, 120);

router.get('/api/admin/branches', requireAuth, requireAdminOrStaff, requirePermission('view_settings'), async (req, res) => {
  try {
    // Includes inactive ones: this is the management view, not the picker.
    const [rows] = await pool.query(
      `SELECT id, branch_key, slug, label, branch_type, timezone, currency, is_active, internal_only
         FROM branches WHERE tenant_id=? ORDER BY is_active DESC, label`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/branches', requireAuth, requireAdmin, async (req, res) => {
  try {
    const label = String(req.body?.label || '').trim().slice(0, 255);
    if (!label) return res.status(400).json({ error: 'اسم الفرع مطلوب' });

    const key = branchKeyFrom(req.body?.branch_key || label) || `BRANCH_${Date.now()}`;
    const type = BRANCH_TYPES.has(req.body?.branch_type) ? req.body.branch_type : 'physical';
    const [[existing]] = await pool.query(
      'SELECT id FROM branches WHERE tenant_id=? AND branch_key=? LIMIT 1', [req.tenantId, key]);
    if (existing) return res.status(409).json({ error: 'يوجد فرع بنفس الاسم/المفتاح بالفعل' });

    await pool.query(
      `INSERT INTO branches (id, tenant_id, branch_key, slug, label, branch_type, timezone, currency, is_active, internal_only)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [uuidv4(), req.tenantId, key, key.toLowerCase(), label, type,
        String(req.body?.timezone || 'Africa/Cairo').slice(0, 80),
        String(req.body?.currency || 'EGP').slice(0, 10),
        req.body?.is_active === false ? 0 : 1,
        req.body?.internal_only === true ? 1 : 0]
    );
    cacheInvalidate(`branches:${req.tenantId}`);
    res.json({ ok: true, branch_key: key, label, message: `تمت إضافة ${label}` });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/branches/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sets = []; const vals = [];
    if (req.body?.label !== undefined) { sets.push('label=?'); vals.push(String(req.body.label).trim().slice(0, 255)); }
    if (req.body?.branch_type !== undefined && BRANCH_TYPES.has(req.body.branch_type)) { sets.push('branch_type=?'); vals.push(req.body.branch_type); }
    if (req.body?.timezone !== undefined) { sets.push('timezone=?'); vals.push(String(req.body.timezone).slice(0, 80)); }
    if (req.body?.currency !== undefined) { sets.push('currency=?'); vals.push(String(req.body.currency).slice(0, 10)); }
    if (req.body?.is_active !== undefined) { sets.push('is_active=?'); vals.push(req.body.is_active ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: 'لا يوجد ما يتم تعديله' });
    vals.push(req.params.id, req.tenantId);
    const [result] = await pool.query(`UPDATE branches SET ${sets.join(',')} WHERE id=? AND tenant_id=?`, vals);
    if (!result.affectedRows) return res.status(404).json({ error: 'الفرع غير موجود' });
    cacheInvalidate(`branches:${req.tenantId}`);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// How many lectures per course are watchable for free (positional preview) — matches the
// client's courseDetails.previewLectureLimit. Cached with the rest of site content.
async function getPreviewLimit(tenantId) {
  try {
    const content = await cached(`site_content:${tenantId}`, 5 * 60 * 1000, () =>
      getTenantSetting('content', { tenantId, fallback: {} }));
    const n = Number(content['courseDetails.previewLectureLimit']);
    // One free lecture per course by default (was 2). Overridable per tenant
    // through courseDetails.previewLectureLimit in site content.
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  } catch { return 1; }
}
// Public-safe lecture: expose the real video URL only for free-previewable lectures
// (explicit is_preview, or within the first `previewLimit` of the course by position).
// Everything else is withheld — enrolled users fetch it from the auth-gated access endpoint.
const publicLecture = (r, positionInCourse, previewLimit) => {
  const m = mapLecture(r);
  if (!m.isPreview && positionInCourse >= previewLimit) m.videoUrl = '';
  return m;
};

// GET /api/courses/:id  (accepts id OR slug)
router.get('/api/courses/:id', publicLimiter, async (req, res) => {
  try {
    const lookup = req.params.id;
    const [[row]] = await pool.query(
      `SELECT ${COURSE_COLS},
              -- Same exclusion as the list above: an archived customer is not a
              -- student, and counting them here made the course page disagree
              -- with the admin panel.
              (SELECT COUNT(DISTINCT e.subscriber_id) FROM enrollments e
                 JOIN subscribers s ON s.id = e.subscriber_id AND s.tenant_id = e.tenant_id
                WHERE e.course_id = courses.id AND e.tenant_id = courses.tenant_id
                  AND s.deleted_at IS NULL) AS enrolled_count
         FROM courses WHERE tenant_id=? AND (id=? OR slug=?) AND is_published=1 LIMIT 1`,
      [req.tenantId, lookup, lookup]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    // course_lectures / course_chapters carry no tenant_id of their own — they
    // inherit tenancy from the parent course, and the rest of the codebase
    // scopes them by joining `courses` (see routes/core/catalog.js). This route
    // filtered on a column that does not exist, so *every* public course detail
    // page returned 500: "Unknown column 'tenant_id' in 'WHERE'".
    const [lectures] = await pool.query(
      // ROW_NUMBER, not COUNT(sort_order < …): sort_order is NOT NULL DEFAULT 0
      // with no unique key, so any lectures created without an explicit order
      // tie on 0 — and counting "how many sort before me" then hands every one
      // of them position 0, i.e. a free video URL for the whole course. The
      // window function breaks ties on id, so positions are always distinct.
      // is_published is filtered here too; unpublished drafts were being served
      // publicly *and* shifting published lectures into the free window.
      `SELECT l.id, l.course_id, l.chapter_id, l.title, l.description, l.video_url, l.duration,
              l.is_preview, l.sort_order, l.is_published, l.lecture_type, l.drip_unlock_days,
              -- The course's own order — chapter, then lecture, then id — the
              -- one the student site lists and lib/learningAccess.js counts.
              -- Ranked by lecture order alone, the free lecture here was one
              -- from a later chapter while the page unlocked the first one.
              ROW_NUMBER() OVER (PARTITION BY l.course_id
                                 ORDER BY COALESCE(ch.sort_order, 999999), l.sort_order, l.id) - 1 AS position_in_course
         FROM course_lectures l
         JOIN courses c ON c.id = l.course_id AND c.tenant_id = ?
         LEFT JOIN course_chapters ch ON ch.id = l.chapter_id AND ch.course_id = l.course_id
        WHERE l.course_id = ? AND l.is_published = 1
        ORDER BY COALESCE(ch.sort_order, 999999), l.sort_order, l.id`, [req.tenantId, row.id]);
    const [chapters] = await pool.query(
      `SELECT ch.id, ch.course_id, ch.title, ch.sort_order
         FROM course_chapters ch
         JOIN courses c ON c.id = ch.course_id AND c.tenant_id = ?
        WHERE ch.course_id = ? ORDER BY ch.sort_order ASC`, [req.tenantId, row.id]);
    const previewLimit = await getPreviewLimit(req.tenantId);
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json({ ...mapCourse(row), lectures: lectures.map(r => publicLecture(r, r.position_in_course, previewLimit)), chapters: chapters.map(mapChapter) });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/courses/:id/rate  (requires auth, subscriber must be enrolled)
router.post('/api/courses/:id/rate', requireAuth, async (req, res) => {
  try {
    const courseId = req.params.id;
    const { rating, comment } = req.body;
    const ratingNum = parseInt(rating, 10);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: 'rating must be 1–5' });
    if (comment != null && typeof comment !== 'string') return res.status(400).json({ error: 'التعليق لازم يكون نص.' });
    const [[course]] = await pool.query('SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [courseId, req.tenantId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.status(403).json({ error: 'يجب أن تكون مشتركاً للتقييم' });
    const [[enroll]] = await pool.query("SELECT id FROM enrollments WHERE subscriber_id=? AND course_id=? AND tenant_id=? AND status='active' LIMIT 1", [sub.id, courseId, req.tenantId]);
    if (!enroll) return res.status(403).json({ error: 'يجب أن تكون مسجلاً في الدورة' });
    await pool.query(
      `INSERT INTO course_ratings (id, course_id, subscriber_id, rating, comment, tenant_id, created_at)
       VALUES (UUID(),?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE rating=VALUES(rating), comment=VALUES(comment), created_at=NOW()`,
      [courseId, sub.id, ratingNum, comment ? comment.slice(0, 2000) : null, req.tenantId]
    );
    const [[agg]] = await pool.query('SELECT AVG(rating) AS avg, COUNT(*) AS cnt FROM course_ratings WHERE course_id=? AND tenant_id=?', [courseId, req.tenantId]);
    res.json({ ok: true, avg: parseFloat((+agg.avg || 0).toFixed(1)), count: agg.cnt });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/courses/:id/ratings
router.get('/api/courses/:id/ratings', publicLimiter, optionalAuth, async (req, res) => {
  try {
    const courseId = req.params.id;
    // A course that is not this institute's has no ratings to show — a 404,
    // not «0 from 0».
    const [[course]] = await pool.query('SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [courseId, req.tenantId]);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const [[agg]] = await pool.query('SELECT AVG(rating) AS avg, COUNT(*) AS cnt FROM course_ratings WHERE course_id=? AND tenant_id=?', [courseId, req.tenantId]);
    let myRating = null;
    if (req.user?.uid) {
      const sub = await resolveSubscriberRow(req, ['id']);
      if (sub) {
        const [[mine]] = await pool.query('SELECT rating, comment FROM course_ratings WHERE course_id=? AND subscriber_id=? AND tenant_id=? LIMIT 1', [courseId, sub.id, req.tenantId]);
        if (mine) myRating = mine;
      }
    }
    res.json({ avg: parseFloat((+agg.avg || 0).toFixed(1)), count: agg.cnt, myRating });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Content Analytics: POST /api/lectures/:id/view ──────────────────────────
router.post('/api/lectures/:id/view', publicLimiter, optionalAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE course_lectures cl JOIN courses c ON c.id=cl.course_id
       SET cl.view_count = cl.view_count + 1 WHERE cl.id = ? AND c.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Admin: GET /api/admin/lesson-analytics/:courseId ─────────────────────────
router.get('/api/admin/lesson-analytics/:courseId', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
  try {
    const [[course]] = await pool.query(
      'SELECT id,instructor_id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
      [req.params.courseId, req.tenantId]
    );
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const role = String(req.staffRecord?.role || '').toLowerCase();
    if (['instructor', 'trainer'].includes(role) && String(course.instructor_id || '') !== String(req.staffRecord.id)) {
      return res.status(403).json({ error: 'Instructor analytics are limited to assigned courses' });
    }
    const [rows] = await pool.query(
      `SELECT cl.id, cl.title, cl.sort_order, cl.view_count
       FROM course_lectures cl JOIN courses c ON c.id=cl.course_id
       WHERE cl.course_id=? AND c.tenant_id=? ORDER BY cl.sort_order ASC`,
      [req.params.courseId, req.tenantId]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Course Completions ───────────────────────────────────────────────────────
// GET /api/me/completions — list digital certificates earned by the subscriber
router.get('/api/me/completions', requireAuth, async (req, res) => {
  try {
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.json([]);
    const [rows] = await pool.query(
      `SELECT cc.*, c.title AS course_title, c.thumbnail AS course_thumbnail
       FROM course_completions cc
       LEFT JOIN courses c ON c.id = cc.course_id AND c.tenant_id=cc.tenant_id
       WHERE cc.subscriber_id = ? AND cc.tenant_id=? AND cc.status='active'
       ORDER BY cc.completed_at DESC`,
      [sub.id, req.tenantId]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// The client printed or saved their certificate from their own page on the site.
router.post('/api/me/completions/:code/downloaded', requireAuth, async (req, res) => {
  try {
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    await pool.query(
      'UPDATE course_completions SET downloaded_at=COALESCE(downloaded_at, NOW()), download_count=download_count+1 WHERE certificate_code=? AND subscriber_id=? AND tenant_id=?',
      [req.params.code, sub.id, req.tenantId]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/completions/verify/:code — public certificate verification (JSON)
// RATE-02: rate-limited (certificate codes are guessable-ish strings, so this
// is a realistic enumeration target). NOT tenant-scoped deliberately —
// course_completions.certificate_code has a global (not per-tenant) UNIQUE
// constraint by design, because the verify link (see verifyUrl below) is one
// shared client URL for every tenant, not a per-tenant subdomain — a visitor
// hitting it from any tenant's page would resolve req.tenantId to whatever
// that page's tenant is, not the certificate's actual tenant. Scoping by
// req.tenantId here would 404 every certificate that isn't on the default
// tenant. The join columns still carry tenant_id=tenant_id so a result can
// never straddle two tenants' subscriber/course rows even without the filter.
router.get('/api/me/timeline', requireAuth, async (req, res) => {
  try {
    const subscriber = await resolveSubscriberRow(req, ['id']);
    res.json(subscriber ? await listCustomerTimeline(req.tenantId, subscriber.id) : []);
  } catch (error) {
    logger.error('[customer-timeline]', error.message);
    res.status(500).json({ error: 'Unable to load customer timeline' });
  }
});

router.get('/api/completions/verify/:code', publicLimiter, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT cc.certificate_code,cc.completed_at,cc.status,cc.version,
              s.name AS subscriber_name,c.title AS course_title
       FROM course_completions cc
       JOIN subscribers s ON s.id = cc.subscriber_id AND s.tenant_id = cc.tenant_id
       JOIN courses c ON c.id = cc.course_id AND c.tenant_id = cc.tenant_id
       WHERE cc.certificate_code = ?`,
      [req.params.code]
    );
    if (!row) return res.status(404).json({ error: 'الشهادة غير موجودة' });
    if (row.status !== 'active') return res.status(410).json({ valid: false, status: row.status, error: 'Certificate revoked' });
    res.json(row);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/certificates/verify/:code — the public check of ANY certificate the system issues: the
// institute's own and the ones arranged with other bodies (lib/certificateVerification.js). Not
// tenant-scoped, for the reason given above: the verify page is one shared URL.
router.get('/api/certificates/verify/:code', publicLimiter, async (req, res) => {
  try {
    const found = await verifyCertificate(pool, req.params.code);
    if (!found) return res.status(404).json({ state: 'not_found', error: 'الشهادة غير موجودة' });
    res.setHeader('Cache-Control', 'no-store');
    res.status(found.state === 'revoked' ? 410 : 200).json(found);
  } catch (e) { logger.error('[certificates/verify]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/completions/:code/certificate — printable HTML certificate (A4 portrait)
// RATE-03: rate-limited — 3 JOINs + brand/content lookups per request, an easy
// resource-exhaustion target with no auth gate.
router.get('/api/completions/:code/certificate', publicLimiter, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT cc.certificate_code,cc.completed_at,cc.tenant_id,
              cc.cert_name_en, cc.cert_course_en, cc.cert_duration, cc.cert_trainer,
              s.name_en AS subscriber_name_en, s.client_code,
              c.title AS course_title, c.title_en AS course_title_en, c.hours AS hours_count,
              u.name AS instructor_name
       FROM course_completions cc
       JOIN subscribers s ON s.id = cc.subscriber_id AND s.tenant_id=cc.tenant_id
       JOIN courses c ON c.id = cc.course_id AND c.tenant_id=cc.tenant_id
       LEFT JOIN users u ON u.id = c.instructor_id AND u.tenant_id=cc.tenant_id
       WHERE cc.certificate_code = ? AND cc.status='active'`,
      [req.params.code]
    );
    if (!row) return res.status(404).send('<h3>الشهادة غير موجودة</h3>');
    // «لو طباعة للعميل اعرضها بالتصميم الكامل انما لو من السيستم … نطبع اسم العميل واسم الكورس فقط»:
    // ?mode=form is the desk's copy for the pre-printed paper; it is never a client download.
    const formMode = String(req.query.mode || '') === 'form';
    // «لو العميل عمل تحميل للشهاده pdf من الموقع يظهر انه العميل عملها تحميل»:
    // the desk's own print and preview carry ?staff=1.
    if (!formMode && String(req.query.staff || '') !== '1') {
      pool.query(
        'UPDATE course_completions SET downloaded_at=COALESCE(downloaded_at, NOW()), download_count=download_count+1 WHERE certificate_code=? AND tenant_id=?',
        [row.certificate_code, row.tenant_id]).catch(() => {});
    }

    const certCode    = row.certificate_code || req.params.code;
    // English only («اسم العميل واسم الكورس بالانجليزي فقط»): never the Arabic name or title,
    // whether it comes from the client's file or from the desk's change on this certificate.
    const certificate = effectiveCertificate({
      cert_name_en: row.cert_name_en, name_en: row.subscriber_name_en,
      cert_course_en: row.cert_course_en, course_title_en: row.course_title_en, course_title: row.course_title,
      cert_duration: row.cert_duration, hours: row.hours_count,
      cert_trainer: row.cert_trainer, instructor_name: row.instructor_name,
    });
    const studentName = certificate.name;
    const courseName  = certificate.course;
    if (!studentName || !courseName) {
      const missing = missingForCertificate({ nameEn: row.cert_name_en || row.subscriber_name_en, courseTitleEn: row.cert_course_en || row.course_title_en, courseTitle: row.course_title });
      return res.status(409).type('html').send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>الشهادة غير جاهزة</title></head>
<body style="font-family:Tahoma,Arial,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;text-align:center;color:#333">
<h2 style="color:#B45309">الشهادة غير جاهزة للطباعة</h2>
<p style="line-height:1.9">شهادة المعهد بتتطبع بالإنجليزي فقط، وناقص: <b>${escapeHtml(missing.join(' و'))}</b>.</p>
<p style="line-height:1.9;color:#666">التحصيل أو خدمة العملاء يضيفوه من ملف العميل ← «بيانات الشهادة»، وبعدها الشهادة تتفتح.</p></body></html>`);
    }
    const issuedAt    = row.completed_at
      ? new Date(row.completed_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric', timeZone: 'Africa/Cairo' })
      : new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric', timeZone: 'Africa/Cairo' });
    // «completed 60 training hours in 2026»: the year the course was completed, on Cairo's clock.
    const issuedYear = new Date(row.completed_at || Date.now()).toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Africa/Cairo' });
    // Identity from the central brand (Settings → الهوية): the button's colour.
    const brand = await getBrandSettings(row.tenant_id);
    const serialNo = row.client_code || certCode.slice(-8).toUpperCase();

    const primaryColor = brand.primaryColor;
    const qrData   = encodeURIComponent(`CERT:${certCode}|${studentName}|${courseName}`);
    const qrUrl    = `/api/qr?size=90&data=${qrData}`;
    // Must match completeCourse()'s own completion email link (lib/courseCompletion.js)
    // and the actual client route (client/App.tsx) — these had drifted (this route used
    // to hardcode mahadnafsy.com/verify/:code, a path/domain nothing ever served, so the
    // certificate's own QR code 404'd for every tenant that wasn't the default one).
    const clientBase = String(process.env.CLIENT_URL || 'https://mahadnafsy.com').replace(/\/$/, '');
    const verifyUrl = `${clientBase}/certificate/${encodeURIComponent(certCode)}`;

    // The institute's own picture with the lines written on it (lib/certificateHtml.js);
    // this page adds the toolbar and the print rules around it.
    const cert = formMode
      ? certificateFormHtml({ studentName, courseName, duration: certificate.duration, nameTop: req.query.nameTop, courseTop: req.query.courseTop, certCode, year: issuedYear })
      : certificateHtml({ studentName, courseName, duration: certificate.duration, trainer: certificate.trainer, serialNo, issuedAt, qrUrl, verifyUrl, certCode, year: issuedYear });
    // This page prints itself, so it carries the one script it needs, by nonce. The API's own policy
    // allows no script at all, which is why «Print» did nothing on the live site.
    const nonce = require('crypto').randomBytes(16).toString('base64');
    res.setHeader('Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Certificate – ${escapeHtml(studentName)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
  body { background: #f0f0f0; display: flex; flex-direction: column; align-items: center; font-family: Georgia, 'Times New Roman', serif; }
  .toolbar { width: 600px; max-width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 12px 0; }
  .cert { width: 600px; height: 849px; background: #fff; position: relative; overflow: hidden; flex: none; box-shadow: 0 2px 14px rgba(0,0,0,.18); }
  .form-sheet { width: 21cm; height: 29.7cm; background: #fff; position: relative; overflow: hidden; flex: none; box-shadow: 0 2px 14px rgba(0,0,0,.18); }
  @media print {
    body { background: #fff; padding: 0; display: block; }
    .toolbar, .verify-note, .guide { display: none !important; }
    .cert { zoom: 1.32; box-shadow: none; }
    .form-sheet { box-shadow: none; }
  }
  @media screen {
    body { padding: 20px; min-height: 100vh; }
  }
</style>
</head>
<body>

<div class="toolbar no-print">
  <div style="font-size:13px;color:#555">${formMode ? 'Print on the institute\'s form — name and course only' : 'Certificate of Achievement'}</div>
  <button id="printBtn" type="button"
    style="background:${primaryColor};color:#fff;border:none;padding:9px 24px;border-radius:6px;font-size:14px;cursor:pointer;font-weight:bold;font-family:Arial">
    🖨️ Print / Save PDF
  </button>
</div>

${cert}

<div class="verify-note" style="text-align:center;padding:12px;font-size:12px;color:#999">
  Verify at: <a href="${escapeHtml(verifyUrl)}" style="color:${primaryColor}">${escapeHtml(verifyUrl)}</a>
</div>

<script nonce="${nonce}">
  // Print once the picture and the code are really on the page: a print started before the
  // certificate's image arrived came out blank.
  function whenLoaded(done) {
    var images = Array.prototype.slice.call(document.images).filter(function (img) { return !img.complete; });
    if (!images.length) { done(); return; }
    var left = images.length;
    var step = function () { left -= 1; if (left <= 0) done(); };
    images.forEach(function (img) { img.addEventListener('load', step); img.addEventListener('error', step); });
    setTimeout(done, 4000);
  }
  var printNow = function () { whenLoaded(function () { window.print(); }); };
  document.getElementById('printBtn').addEventListener('click', printNow);
  if (new URLSearchParams(location.search).get('print') === '1') printNow();
</script>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // A page the desk may have just edited is never served from a cache.
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (e) { logger.error('[certificate]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// The institute's own certificate design (the picture the printable page is written on).
router.get('/api/certificate-template.jpg', publicLimiter, (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.type('image/jpeg').sendFile(path.join(__dirname, '../assets/certificate-template.jpg'), err => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// ── Referral System ──────────────────────────────────────────────────────────
// GET /api/referral/my-code — get (or create) referral code for the logged-in subscriber
router.get('/api/referral/my-code', requireAuth, async (req, res) => {
  try {
    const sub = await resolveSubscriberRow(req, ['id', 'name']);
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    const _refCols = 'id, subscriber_id, code, uses, earnings, created_at';
    let [[ref]] = await pool.query(`SELECT ${_refCols} FROM referral_codes WHERE subscriber_id=? AND tenant_id=? LIMIT 1`, [sub.id, req.tenantId]);
    if (!ref) {
      // Generate a unique short code: first 4 chars of name (Arabic safe) + 6 random hex
      const prefix = (sub.name || 'REF').replace(/\s+/g,'').slice(0,3).toUpperCase().replace(/[^A-Z0-9]/g,'') || 'REF';
      const code = prefix + Math.random().toString(36).slice(2,8).toUpperCase();
      await pool.query(
        'INSERT INTO referral_codes (id, subscriber_id, code, tenant_id) VALUES (UUID(),?,?,?)',
        [sub.id, code, req.tenantId]
      );
      [[ref]] = await pool.query(`SELECT ${_refCols} FROM referral_codes WHERE subscriber_id=? AND tenant_id=? LIMIT 1`, [sub.id, req.tenantId]);
    }
    res.json({ code: ref.code, uses: ref.uses, earnings: ref.earnings });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/referrals — admin view of all referral codes + stats
router.get('/api/admin/referrals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT rc.*, s.name AS subscriber_name, s.email AS subscriber_email, s.phone AS subscriber_phone
       FROM referral_codes rc
       JOIN subscribers s ON s.id = rc.subscriber_id AND s.tenant_id=rc.tenant_id
       WHERE rc.tenant_id=?
       ORDER BY rc.uses DESC, rc.created_at DESC
       LIMIT 500`
      , [req.tenantId]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/bundles?limit=50
router.get('/api/bundles', publicLimiter, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 50, 200);
    const data = await cached(`bundles:${req.tenantId}:${limit}`, 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT b.*, GROUP_CONCAT(bc.course_id ORDER BY bc.sort_order) AS course_ids_csv
         FROM bundles b
         LEFT JOIN bundle_courses bc ON bc.bundle_id = b.id AND bc.tenant_id=b.tenant_id
         WHERE b.is_published = 1 AND b.tenant_id=?
         GROUP BY b.id
         ORDER BY b.sort_order ASC, b.created_at DESC LIMIT ?`, [req.tenantId, limit]
      );
      const [courses] = await pool.query(`SELECT ${COURSE_LIST_COLS} FROM courses WHERE is_published = 1 AND tenant_id=?`, [req.tenantId]);
      return rows.map(r => mapBundle(r, courses.map(row => mapCourse(row))));
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/lectures?limit=500&offset=0
router.get('/api/lectures', publicLimiter, async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 500, 5000);
    const offset = parseOffset(req.query.offset);
    const data = await cached(`lectures:${req.tenantId}:${limit}:${offset}`, 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        // Same tie problem as /api/courses/:id — see the note there. The window
        // runs over the whole filtered set before LIMIT/OFFSET, so a lecture's
        // position stays the position it holds in its course, not in the page.
        `SELECT cl.id, cl.course_id, cl.chapter_id, cl.title, cl.description, cl.video_url, cl.duration,
                cl.is_preview, cl.sort_order, cl.is_published, cl.lecture_type, cl.drip_unlock_days,
                ROW_NUMBER() OVER (PARTITION BY cl.course_id
                                   ORDER BY COALESCE(ch.sort_order, 999999), cl.sort_order, cl.id) - 1 AS position_in_course
         FROM course_lectures cl JOIN courses c ON c.id=cl.course_id
         LEFT JOIN course_chapters ch ON ch.id = cl.chapter_id AND ch.course_id = cl.course_id
         WHERE cl.is_published=1 AND c.tenant_id=?
         ORDER BY cl.course_id, COALESCE(ch.sort_order, 999999), cl.sort_order, cl.id LIMIT ? OFFSET ?`,
        [req.tenantId, limit, offset]
      );
      const previewLimit = await getPreviewLimit(req.tenantId);
      return rows.map(r => publicLecture(r, r.position_in_course, previewLimit));
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/chapters?limit=500
router.get('/api/chapters', publicLimiter, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 1000);
    const data = await cached(`chapters:${req.tenantId}:${limit}`, 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT ch.id, ch.course_id, ch.title, ch.sort_order
         FROM course_chapters ch JOIN courses c ON c.id=ch.course_id
         WHERE c.tenant_id=? ORDER BY ch.course_id, ch.sort_order ASC LIMIT ?`, [req.tenantId, limit]);
      return rows.map(mapChapter);
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/therapists?limit=50
router.get('/api/therapists', publicLimiter, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 50, 200);
    const data = await cached(`therapists:${req.tenantId}:${limit}`, 10 * 60 * 1000, async () => {
      const [therapists] = await pool.query(
        `SELECT id, name, specialty, image, experience, rating, title, bio,
         price_egp, price_sar, price_usd, is_consultation_enabled, session_duration_minutes,
         meeting_provider, provider_base_url, featured, sort_order, show_on_home, show_on_about,
         is_active, languages_json, focus_areas_json, qualifications_json, created_at
          FROM therapists WHERE is_active = 1 AND tenant_id=? ORDER BY sort_order ASC LIMIT ?`, [req.tenantId, limit]);
      if (therapists.length > 0) {
        const ids = therapists.map(t => t.id);
        // No meeting_link: this route is public, unauthenticated and cached
        // with `Cache-Control: public`, and the booking picker needs only the
        // day, the time and the id. It is not selected at all rather than
        // dropped later, so it cannot reach the cache entry either.
        const [slots] = await pool.query(
          `SELECT id, therapist_id, day, start_time, end_time, timezone, label, is_active
           FROM therapist_slots WHERE therapist_id IN (${ids.map(() => '?').join(',')}) AND is_active = 1`, ids);
        const slotMap = {};
        slots.forEach(s => { (slotMap[s.therapist_id] = slotMap[s.therapist_id] || []).push(s); });
        therapists.forEach(t => { t.slots = slotMap[t.id] || []; });
      }
      // Called with one argument on purpose. `map` passes (element, index,
      // array), so passing mapTherapist directly handed the index to
      // includeMeetingLinks — falsy for the first therapist and truthy for
      // every one after it, which put the join links back on this public
      // response for all but one of them.
      return therapists.map(row => mapTherapist(row));
    });
    res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/testimonials
router.get('/api/testimonials', publicLimiter, async (req, res) => {
  try {
    const data = await cached(`testimonials:${req.tenantId}`, 10 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        'SELECT id, name, role, text, image, sort_order, is_active FROM testimonials WHERE is_active = 1 AND tenant_id=? ORDER BY sort_order ASC LIMIT 100', [req.tenantId]);
      return rows;
    });
    res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/content  (public site content key-value store)
router.get('/api/content', publicLimiter, async (req, res) => {
  try {
    const data = await cached(`site_content:${req.tenantId}`, 5 * 60 * 1000, async () => {
      const [content, sysGeneral] = await Promise.all([
        getTenantSetting('content', { tenantId: req.tenantId, fallback: {} }),
        getTenantSetting('sys_general', { tenantId: req.tenantId, fallback: {} }),
      ]);
      // The SaaS setup wizard's logo/favicon uploader (routes/branding-assets.js)
      // saves into the 'sys_general' settings section — a different section than
      // this one — so a tenant who only went through the wizard never saw their
      // branding anywhere public (ARC-07). Overlay it onto the older
      // institute.logo/institute.favicon keys every reader already expects.
      const merged = { ...content };
      if (sysGeneral?.brand_logo_url) merged['institute.logo'] = sysGeneral.brand_logo_url;
      if (sysGeneral?.brand_favicon_url) merged['institute.favicon'] = sysGeneral.brand_favicon_url;
      return merged;
    });
    // Short browser cache so admin content edits reflect on the site within ~30s
    // (the server-side 'site_content' cache is invalidated on save, so this is cheap).
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/quizzes — public listing so students can see a quiz exists and take it.
// correctIndex/explanation are stripped (LMS-05): this endpoint has no auth, so
// anyone could otherwise read the answer key straight out of the network tab.
// Grading happens server-side in POST /api/me/quiz-attempts, against the full
// (unstripped) row read directly from the DB.
router.get('/api/quizzes', publicLimiter, requireAuth, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200, 500);
    const subscriber = await resolveSubscriberRow(req, ['id']);
    if (!subscriber) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id, course_id, title, questions_json, passing_score, required_for_completion,
              generated_by_ai, source_material, created_at, updated_at
         FROM course_quizzes q
        WHERE q.tenant_id=? AND EXISTS (
          SELECT 1 FROM enrollments e
           WHERE e.tenant_id=q.tenant_id AND e.subscriber_id=? AND e.course_id=q.course_id
             AND e.status='active'
        )
        ORDER BY q.created_at DESC LIMIT ?`,
      [req.tenantId, subscriber.id, limit]
    );
    res.json(rows.map(r => mapQuiz(r, { includeAnswers: false })));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/live-streams — every visibility value (ALL_SUBSCRIBERS,
// COURSE_SUBSCRIBERS, COMMUNITY_ALL, COMMUNITY_AND_SUBSCRIBERS) implies some
// form of gating; none of them mean "public". This previously had no auth at
// all and returned stream_url (the actual join link) to anyone, ignoring the
// visibility column entirely (LMS-10). Now requires a logged-in subscriber,
// then additionally filters COURSE_SUBSCRIBERS rows to ones the caller is
// actually enrolled in.
router.get('/api/live-streams', requireAuth, async (req, res) => {
  try {
    const sub = await resolveSubscriberRow(req, ['id']);
    // An account that has not bought yet has no client record. The site asks for
    // the streams on every sign-in and ignores a refusal, so the 403 this sent
    // was only noise in the log (39 in two days): no streams is the answer.
    if (!sub) return res.json([]);
    const [rows] = await pool.query(
      `SELECT ${LIVE_STREAM_COLS}
       FROM live_streams WHERE tenant_id=? ORDER BY scheduled_at DESC LIMIT 200`, [req.tenantId]);
    const [enrollRows] = await pool.query(
      "SELECT course_id FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND status='active' AND course_id IS NOT NULL",
      [req.tenantId, sub.id]
    );
    const enrolledCourseIds = new Set(enrollRows.map(r => r.course_id));
    const visible = rows.filter(row => {
      if (row.visibility !== 'COURSE_SUBSCRIBERS') return true;
      const targetIds = tryJson(row.target_course_ids_json, []);
      return Array.isArray(targetIds) && targetIds.some(id => enrolledCourseIds.has(id));
    });
    res.json(visible.map(mapLiveStream));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/contact  (نموذج التواصل)
router.post('/api/contact', contactLimiter, scalarFields('name', 'email', 'phone', 'subject', 'message'), async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;
    const verr = validate(req.body, { name: 'required|120', phone: 'required|40', message: 'required|2000', email: 'optional|160', subject: 'optional|200' });
    if (verr) return res.status(400).json({ error: verr });
    const id = uuidv4();
    await pool.query(
      'INSERT INTO contact_messages (id, tenant_id, branch_id, name, email, phone, subject, message) VALUES (?,?,?,?,?,?,?,?)',
      [id, req.tenantId, req.tenantBranchId || null, name, email || null, phone, subject || null, message]
    );
    // Lifecycle: instant acknowledgment to the sender.
    require('../lib/lifecycle').trigger('contact_received', { name, email, phone, tenantId: req.tenantId });
    // A question about a course or its price is sales' — it reached only the
    // customer-service inbox, which is for problems with the site.
    if (SALES_SUBJECTS.has(subject)) {
      await capturePublicLead({
        tenantId: req.tenantId, name, phone, source: 'contact_form',
        notes: `صفحة التواصل — ${SALES_SUBJECTS.get(subject)}: ${String(message).slice(0, 400)}`,
      }).catch(error => logger.warn('[contact] lead not filed', { error: error.message }));
    }
    // A message on the contact page is a Lead to the ads, whatever its subject.
    void metaCapi.trackLead(req, { name, email, phone, leadId: id, contentName: subject || 'contact' });
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/join-us  (طلب انضمام)
router.post('/api/join-us', contactLimiter, scalarFields('name', 'email', 'phone', 'specialty', 'experience', 'type', 'linkedin', 'message', 'jobId', 'branch', 'education', 'experienceYears', 'programsOther'), async (req, res) => {
  try {
    const { name, email, phone, specialty, experience, type, linkedin, message, jobId,
      branch, education, experiencePlaces, experienceYears, form } = req.body;
    const verr = validate(req.body, { name: 'required|120', email: 'email|160', phone: 'required|40', specialty: 'required|160', type: 'optional|40', experience: 'optional|2000', linkedin: 'optional|300', message: 'optional|2000', programsOther: 'optional|1000', branch: 'optional|60' });
    if (verr) return res.status(400).json({ error: verr });
    const id = uuidv4();
    // Which list the application belongs on comes from the page it was sent from,
    // not from a type that silently fell back to INSTRUCTOR — «لازم تفرق بيينهم
    // بشكل كبير» (12 Oct 2026). See lib/joinApplication.js.
    const kind = joinApplication.resolveApplicationKind({ form, type, jobId });
    const safeType = kind.type;
    // The lecturer form's two required questions — «هل اشتغلت محاضر قبل كده؟» and
    // «هل اشتغلت في جلسات نفسية مع عملاء قبل كده؟» (12 Oct 2026). Required from the
    // teaching page; a page cached from before them sends no `form` and is let
    // through without, rather than losing the applicant.
    const lecturedBefore = joinApplication.parseYesNo(req.body.lecturedBefore);
    const sessionsBefore = joinApplication.parseYesNo(req.body.sessionsBefore);
    if (String(form || '').toLowerCase() === 'teaching' && (lecturedBefore === null || sessionsBefore === null)) {
      return res.status(400).json({ error: 'جاوب على سؤالي الخبرة: اشتغلت محاضر قبل كده؟ واشتغلت في جلسات نفسية مع عملاء؟' });
    }
    // The programmes ticked, read back from the tenant's own published courses —
    // a title from the browser is not stored as something the institute offers.
    let programs = [];
    const programIds = kind.sourceForm === 'teaching' ? joinApplication.programIdsFrom(req.body.programs) : [];
    if (programIds.length) {
      const [rows] = await pool.query(
        `SELECT id, title FROM courses WHERE tenant_id=? AND is_published=1 AND id IN (${programIds.map(() => '?').join(',')})`,
        [req.tenantId, ...programIds]);
      const byId = new Map(rows.map(row => [String(row.id), row.title]));
      programs = programIds.filter(pid => byId.has(pid)).map(pid => ({ id: pid, title: byId.get(pid) }));
    }
    const programsOther = kind.sourceForm === 'teaching' ? String(req.body.programsOther || '').trim() || null : null;
    // Applying from a specific job listing's "قدّم الآن" list must land the
    // applicant on THAT posting, not the generic talent pool it silently fell
    // into before (jobId was collected on the form but never sent). Re-checked
    // against the tenant's own open postings rather than trusted as-is — a
    // client-supplied id could otherwise attach an application to another
    // tenant's job or a closed/deleted one.
    let targetJobId = null;
    if (jobId) {
      const [[job]] = await pool.query(
        // NOT LIKE 'talent-%', matching how talentPoolJobId() in hr/talent.js
        // actually builds the id. The literal 'job-talent-pool' this used never
        // matched anything, so the exclusion did nothing — the same stale
        // spelling GET /api/jobs was already corrected for, left behind here.
        `SELECT id FROM job_postings WHERE id=? AND tenant_id=? AND status='open' AND id NOT LIKE 'talent-%' LIMIT 1`,
        [jobId, req.tenantId]
      ).catch(() => [[null]]);
      if (job) targetJobId = job.id;
    }
    const { applicantId } = await require('./hr/talent').createJoinApplication({
      id, tenant_id: req.tenantId, branch_id: req.tenantBranchId || null,
      name, email, phone, specialty, experience, type: safeType, linkedin, message,
      branch, education, experiencePlaces, experienceYears,
      job_id: targetJobId,
      source_form: kind.sourceForm,
      lectured_before: kind.sourceForm === 'teaching' ? lecturedBefore : null,
      sessions_before: kind.sourceForm === 'teaching' ? sessionsBefore : null,
      programs, programs_other: programsOther,
    });
    const roleLabel = { INSTRUCTOR: 'محاضر', CONSULTANT: 'مستشار', EMPLOYEE: 'وظيفة إدارية' }[safeType] || '';
    await Promise.all([
      require('../lib/lifecycle').trigger('join_us_received', { name, email, phone, roleLabel, tenantId: req.tenantId }),
      require('../lib/notification').createNotification(
        'hr', 'متقدم جديد من الموقع', `${name} — ${roleLabel || safeType}`,
        { joinUsId: id, applicantId }, req.tenantId
      ),
    ]);
    res.json({ ok: true, id, applicantId });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/jobs — public list of open job postings (careers / employee join page).
router.get('/api/jobs', publicLimiter, async (req, res) => {
  try {
    const [rows] = await pool.query(
      // The internal "talent pool" placeholder job (auto-created per tenant
      // to hold un-targeted applications — see talentPoolJobId() in
      // hr/talent.js, id shape "talent-<tenantId>") was excluded here by a
      // stale literal 'job-talent-pool' that never matched the real id
      // shape, so it has been listed on the public careers page as an actual
      // open position. Excluded by prefix instead, matching how it's
      // actually generated.
      `SELECT j.id, j.title, j.branch, j.employment_type, j.description, j.requirements,
              j.salary_min, j.salary_max, j.created_at, d.name AS department
         FROM job_postings j LEFT JOIN hr_departments d ON d.id = j.department_id
        WHERE j.status='open' AND j.id NOT LIKE 'talent-%' AND j.tenant_id=?
        ORDER BY j.created_at DESC LIMIT 50`, [req.tenantId]).catch(() => [[]]);
    res.json(rows);
  } catch (e) { logger.error('[jobs]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-REQUIRED ROUTES (logged-in users)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/me/subscriber  — بيانات المشترك لنفسه
router.get('/api/me/subscriber', requireAuth, async (req, res) => {
  try {
    // This is the whole client dashboard. It used to hard-reject any token with
    // no email — which, since WhatsApp sign-in, is every client whose subscriber
    // record has no email address: they signed in successfully and then could
    // not load their account at all.
    const sub = await resolveSubscriberRow(req, [
      'id', 'firebase_uid', 'client_code', 'lead_id', 'name', 'email', 'phone', 'branch',
      'is_active', 'notes', 'assigned_sales_id', 'assigned_sales_name',
      'assigned_cs_id', 'assigned_cs_name', 'crm_json', 'created_at', 'updated_at', 'name_en',
    ]);
    if (!sub) return res.json(null);

    const [enrollments] = await pool.query(
      `SELECT e.*, c.id AS c_id, c.title AS c_title, c.slug AS c_slug,
              c.thumbnail AS c_thumb, c.instructor AS c_instructor
       FROM enrollments e
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.subscriber_id = ? AND e.tenant_id=? AND e.status='active'`, [sub.id, req.tenantId]);
    const [payments] = await pool.query(
      `SELECT p.id, p.subscriber_id, p.course_id, p.bundle_id, p.amount, p.currency, p.payment_type,
       p.payment_method, p.transaction_id, p.is_installment, p.\`date\`, p.note, p.status,
       p.staff_id, p.staff_name, p.from_account, p.source, p.item_title, p.cert_type,
       p.certificate_request_id, p.course_expected, p.branch, p.created_at,
       fd.document_number
       FROM payments p
       LEFT JOIN financial_documents fd ON fd.tenant_id=p.tenant_id
         AND fd.document_type='invoice' AND fd.source_type='payment' AND fd.source_id=p.id
       WHERE p.subscriber_id = ? AND p.tenant_id=? AND p.deleted_at IS NULL
       ORDER BY p.date DESC LIMIT 200`, [sub.id, req.tenantId]);
    const [certRequests] = await pool.query(
      `SELECT cr.*, c.id AS c_id, c.title AS c_title
       FROM certificate_requests cr
       LEFT JOIN courses c ON c.id = cr.course_id
       WHERE cr.subscriber_id = ? AND cr.tenant_id=? ORDER BY cr.requested_at DESC`, [sub.id, req.tenantId]);
    // Lecture progress is tracked in the lecture_completions table (POST /api/me/progress),
    // but mapSubscriber historically read it from crm_json (never populated) → progress always 0.
    // Pull the real per-lecture progress here and merge it in so client progress actually computes.
    let lectureProgressMap = {};
    try {
      const [completions] = await pool.query(
        'SELECT lecture_id, progress_pct FROM lecture_completions WHERE subscriber_id = ? AND tenant_id=?', [sub.id, req.tenantId]);
      for (const c of completions) lectureProgressMap[c.lecture_id] = Number(c.progress_pct) || 0;
    } catch (_) { /* table may not exist on older schema — fall back to crm_json */ }

    const [installmentPlans] = await pool.query(
      `SELECT ip.id, ip.course_id, ip.title, ip.total_amount, ip.currency, ip.installments_count,
              ip.installment_amounts, ip.due_dates, ip.paid_dates, ip.paid_amounts, ip.notes,
              ip.created_at, c.title AS course_title
         FROM installment_plans ip
         LEFT JOIN courses c ON c.id = ip.course_id AND c.tenant_id = ip.tenant_id
        WHERE ip.subscriber_id = ? AND ip.tenant_id = ? ORDER BY ip.created_at DESC`,
      [sub.id, req.tenantId]
    );
    let mapped = mapSubscriber({ ...sub, enrollments, payments, certRequests, installmentPlans });
    // Merge DB completions over any crm_json values (DB table is the source of truth).
    mapped = { ...mapped, lectureProgress: { ...(mapped.lectureProgress || {}), ...lectureProgressMap } };
    // Fetch full course objects for all enrolled courses (incl. unpublished) so
    // the client can display them even when GET /api/courses filters by is_published
    const allEnrolledIds = mapped.enrolledCourseIds || [];
    let enrolledCoursesData = [];
    if (allEnrolledIds.length > 0) {
      const placeholders = allEnrolledIds.map(() => '?').join(',');
      const [courseRows] = await pool.query(
        `SELECT ${COURSE_COLS} FROM courses WHERE tenant_id=? AND id IN (${placeholders})`, [req.tenantId, ...allEnrolledIds]);
      const materialsByCourse = await loadCourseMaterials(pool, courseRows.map(row => row.id));
      enrolledCoursesData = courseRows.map(row => mapCourse(row, materialsByCourse.get(row.id) || []));
    }
    // What the client owes, item by item, by the one rule the desk and the
    // receipts use (lib/agreedPrice.js): the price agreed, what was paid here
    // and before the system, in the item's own currency, a track as a track.
    // The page summed only pound payments — pending and refunded ones too —
    // against a price found on the first cash payment, so a riyal client had
    // paid nothing and a track had no row at all.
    const balanceMap = await itemBalances(pool, { tenantId: req.tenantId, subscriberId: sub.id });
    const courseIds = [...balanceMap.values()].map(entry => entry.courseId).filter(Boolean);
    const bundleIds = [...balanceMap.values()].map(entry => entry.bundleId).filter(Boolean);
    const titles = new Map();
    if (courseIds.length) {
      const [rows] = await pool.query(`SELECT id, title FROM courses WHERE tenant_id=? AND id IN (${courseIds.map(() => '?').join(',')})`,
        [req.tenantId, ...courseIds]);
      rows.forEach(row => titles.set(String(row.id), row.title));
    }
    if (bundleIds.length) {
      const [rows] = await pool.query(`SELECT id, title FROM bundles WHERE tenant_id=? AND id IN (${bundleIds.map(() => '?').join(',')})`,
        [req.tenantId, ...bundleIds]);
      rows.forEach(row => titles.set(`bundle:${row.id}`, row.title));
    }
    const balances = [...balanceMap.values()].map(entry => ({
      item: entry.item, courseId: entry.courseId, bundleId: entry.bundleId,
      title: titles.get(entry.item) || titles.get(String(entry.courseId)) || '', currency: entry.currency,
      expected: entry.expected, paid: entry.paid, priorPaid: entry.priorPaid, remaining: entry.remaining,
    }));
    res.json({ ...mapped, enrolledCoursesData, balances });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/me/consultations
router.get('/api/me/consultations', requireAuth, async (req, res) => {
  try {
    // consultations predates subscriber_id and is still booked by email, so both
    // are valid ownership proofs. Matching on email alone returned nothing for a
    // WhatsApp-only client — and the 400 above meant they never got that far.
    const subscriber = await resolveSubscriberRow(req, ['id', 'email']);
    const email = String(subscriber?.email || req.user.email || '').toLowerCase().trim();
    if (!subscriber && !email) return res.json([]);
    const clauses = [];
    const params = [];
    if (subscriber?.id) { clauses.push('c.subscriber_id = ?'); params.push(subscriber.id); }
    if (email) { clauses.push('c.client_email = ?'); params.push(email); }
    const [rows] = await pool.query(
      `SELECT c.*, t.name AS t_name, t.specialty AS t_specialty, t.image AS t_image
       FROM consultations c
       LEFT JOIN therapists t ON t.id = c.therapist_id
       WHERE (${clauses.join(' OR ')}) AND c.tenant_id=?
       ORDER BY c.session_date DESC LIMIT 100`, [...params, req.tenantId]);
    // The rows went out raw, and the screen reads camelCase: therapistName,
    // sessionDate, sessionType and meetingLink were all undefined against a row
    // carrying t_name, session_date, session_type and meeting_link. A customer's
    // confirmed consultation drew as «استشارة» with no therapist, no date and no
    // way in — the join button is gated on the link and on the status, and the
    // status arrives from an uppercase enum the screen compares in lower case.
    res.json(rows.map(row => ({
      id: row.id,
      therapistName: row.t_name || null,
      therapistSpecialty: row.t_specialty || null,
      therapistImage: row.t_image || null,
      status: String(row.status || '').toLowerCase(),
      sessionDate: row.session_date || null,
      sessionType: String(row.session_type || '').toLowerCase(),
      durationMinutes: row.session_duration_minutes != null ? Number(row.session_duration_minutes) : null,
      timezone: row.timezone || null,
      amount: row.amount != null ? Number(row.amount) : undefined,
      currency: row.currency || null,
      meetingLink: row.meeting_link || null,
      // The client sorts the list on this. Left out of the first mapping, so
      // the sort was comparing two empty strings and doing nothing.
      createdAt: row.created_at,
    })));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/me/heartbeat — تسجيل العميل كـ"متصل الآن"
router.post('/api/me/heartbeat', requireAuth, async (req, res) => {
  try {
    await setOnlineUser(req.tenantId, String(req.user.uid), {
      name: req.user.name || req.user.email?.split('@')[0] || '',
      email: req.user.email || '',
    });
    // Keep the session's recorded address current. The session is no longer
    // pinned to it (see hasCurrentSession), but the sessions view and the
    // sharing guard both read it, so a stale hash from the original sign-in
    // would misrepresent where the account is actually being used from.
    const currentIp = getClientIp(req);
    if (currentIp) {
      pool.query(
        `UPDATE users SET active_session_ip_hash=?, active_session_last_seen_at=NOW()
          WHERE tenant_id=? AND id=? AND active_session_id IS NOT NULL`,
        [hashClientIp(currentIp), req.tenantId, String(req.user.uid)]
      ).catch(() => {});
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error('[heartbeat]', error.message);
    res.status(503).json({ error: 'Presence service unavailable' });
  }
});

// GET /api/me/quiz-attempts - always resolves the subscriber from the token.
router.get('/api/me/quiz-attempts', requireAuth, async (req, res) => {
  try {
    const subscriber = await resolveSubscriberRow(req, ['id']);
    if (!subscriber) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at
       FROM quiz_attempts WHERE subscriber_id = ? AND tenant_id=? ORDER BY taken_at DESC LIMIT 200`,
      [subscriber.id, req.tenantId]
    );
    // The student's own results, in the shape their screen reads.
    //
    // These went out raw, and StudentQuizTab pairs an attempt to a quiz with
    // `attempt.quizId === quiz.id && attempt.subscriberId === subscriber.id`.
    // Against a row spelling those quiz_id and subscriber_id, both sides were
    // undefined, so the filter matched nothing and every quiz showed as never
    // attempted — however many times it had been passed. The sort by takenAt
    // was comparing two empty strings for the same reason.
    res.json(rows.map(row => ({
      id: row.id,
      subscriberId: row.subscriber_id,
      quizId: row.quiz_id,
      courseId: row.course_id,
      score: Number(row.score) || 0,
      passed: !!row.passed,
      answers: tryJson(row.answers_json, []),
      takenAt: row.taken_at,
    })));
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/me/quiz-attempts — student submits their own quiz attempt (LMS-06).
// Before this route existed, StudentQuizTab.tsx graded entirely client-side and
// never sent the result anywhere — a real passing attempt only ever reached
// quiz_attempts if an admin manually re-typed it via POST /api/admin/quiz-attempts.
// Grading here reloads the quiz's own questions_json (which still carries
// correctIndex — the public GET /api/quizzes response never does, LMS-05) so a
// tampered client-side score/passed can't be trusted or submitted.
router.post('/api/me/quiz-attempts', requireAuth, async (req, res) => {
  try {
    const { quizId, answers } = req.body || {};
    if (!quizId || !Array.isArray(answers)) return res.status(400).json({ error: 'quizId and answers[] are required' });
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });

    const [[quiz]] = await pool.query(
      'SELECT id, course_id, questions_json, passing_score FROM course_quizzes WHERE id=? AND tenant_id=? LIMIT 1',
      [quizId, req.tenantId]
    );
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    // The enrolment row is held while the attempt is counted and recorded, so
    // ten submissions sent at once are counted one after another. Read without
    // it, all of them saw fewer than ten and all were graded — and each answer
    // says how many were right, which is how a quiz is solved by brute force.
    const conn = await pool.getConnection();
    let result;
    try {
      await conn.beginTransaction();
      const [[enrolled]] = await conn.query(
        "SELECT id FROM enrollments WHERE subscriber_id=? AND course_id=? AND tenant_id=? AND status='active' LIMIT 1 FOR UPDATE",
        [sub.id, quiz.course_id, req.tenantId]
      );
      if (!enrolled) {
        await conn.rollback();
        return res.status(403).json({ error: 'Active enrollment is required' });
      }
      const [[attempts]] = await conn.query(
        `SELECT COUNT(*) AS count FROM quiz_attempts
          WHERE tenant_id=? AND subscriber_id=? AND quiz_id=?
            AND taken_at>=DATE_SUB(NOW(),INTERVAL 24 HOUR)`,
        [req.tenantId, sub.id, quiz.id]
      );
      if (Number(attempts?.count) >= 10) {
        await conn.rollback();
        return res.status(429).json({ error: 'Maximum 10 attempts per quiz within 24 hours' });
      }
      // Was `emailNorm`, a variable removed when this route stopped resolving the
      // client by email — a ReferenceError on every quiz submission. The account
      // is the actor; the subscriber id is the fallback for a WhatsApp-only client
      // who has no email at all.
      const actor = req.user?.email || req.user?.uid || sub.id;
      result = await recordQuizAttempt({ quiz, subscriberId: sub.id, answers, tenantId: req.tenantId, actor }, conn);
      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally { conn.release(); }
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error('[quiz-attempt]', e.message);
    res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'Internal server error' });
  }
});

// Public FAQ knowledge base — self-service, reduces support ticket volume.
router.get('/api/faq', publicLimiter, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, question, answer, category FROM faq_entries WHERE tenant_id=? AND is_published=1 ORDER BY category, sort_order, created_at LIMIT 500',
      [req.tenantId]
    );
    res.json(rows);
  } catch (e) { logger.error('[public/faq]', e.message); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
