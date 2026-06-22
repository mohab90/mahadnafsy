'use strict';
const logger = require('../lib/logger');
const { Router } = require('express');
const router = Router();

const { uuidv4 } = require('../lib/id');

const { pool, cached } = require('../lib/db');
const { parseLimit, parseOffset, sanitize, tryJson, validate } = require('../lib/helpers');
const { COURSE_COLS, mapCourse, mapBundle, mapTherapist, mapLecture, mapChapter, mapSubscriber } = require('../lib/mappers');
const { sendEmail, htmlEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { ADMIN_EMAILS, ADMIN_UIDS, optionalAuth, requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');
const { onlineMap } = require('../lib/onlineUsers');
const { publicLimiter, contactLimiter } = require('../middleware/rateLimits');
// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/courses?limit=100&offset=0
router.get('/api/courses', publicLimiter, async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 100, 500);
    const offset = parseOffset(req.query.offset);
    const data = await cached(`courses:${limit}:${offset}`, 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT ${COURSE_COLS} FROM courses WHERE is_published = 1
         ORDER BY sort_order ASC, created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      return rows.map(mapCourse);
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

// How many lectures per course are watchable for free (positional preview) — matches the
// client's courseDetails.previewLectureLimit. Cached with the rest of site content.
async function getPreviewLimit() {
  try {
    const content = await cached('site_content', 5 * 60 * 1000, async () => {
      const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'content' LIMIT 1");
      return rows[0]?.value ? JSON.parse(rows[0].value) : {};
    });
    const n = Number(content['courseDetails.previewLectureLimit']);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
  } catch { return 2; }
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
router.get('/api/courses/:id', async (req, res) => {
  try {
    const lookup = req.params.id;
    const [[row]] = await pool.query(`SELECT ${COURSE_COLS} FROM courses WHERE id = ? OR slug = ? LIMIT 1`, [lookup, lookup]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const [lectures] = await pool.query(
      'SELECT id, course_id, chapter_id, title, description, video_url, duration, is_preview, sort_order, is_published, lecture_type, drip_unlock_days FROM course_lectures WHERE course_id = ? ORDER BY sort_order ASC', [row.id]);
    const [chapters] = await pool.query(
      'SELECT id, course_id, title, sort_order FROM course_chapters WHERE course_id = ? ORDER BY sort_order ASC', [row.id]);
    const previewLimit = await getPreviewLimit();
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json({ ...mapCourse(row), lectures: lectures.map((r, i) => publicLecture(r, i, previewLimit)), chapters: chapters.map(mapChapter) });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/courses/:id/rate  (requires auth, subscriber must be enrolled)
router.post('/api/courses/:id/rate', requireAuth, async (req, res) => {
  try {
    const courseId = req.params.id;
    const { rating, comment } = req.body;
    const ratingNum = parseInt(rating, 10);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: 'rating must be 1–5' });
    const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE email=? LIMIT 1', [req.user.email]);
    if (!sub) return res.status(403).json({ error: 'يجب أن تكون مشتركاً للتقييم' });
    const [[enroll]] = await pool.query('SELECT id FROM enrollments WHERE subscriber_id=? AND course_id=? LIMIT 1', [sub.id, courseId]);
    if (!enroll) return res.status(403).json({ error: 'يجب أن تكون مسجلاً في الدورة' });
    await pool.query(
      `INSERT INTO course_ratings (id, course_id, subscriber_id, rating, comment, created_at)
       VALUES (UUID(),?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE rating=VALUES(rating), comment=VALUES(comment), created_at=NOW()`,
      [courseId, sub.id, ratingNum, comment || null]
    );
    const [[agg]] = await pool.query('SELECT AVG(rating) AS avg, COUNT(*) AS cnt FROM course_ratings WHERE course_id=?', [courseId]);
    res.json({ ok: true, avg: parseFloat((+agg.avg || 0).toFixed(1)), count: agg.cnt });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/courses/:id/ratings
router.get('/api/courses/:id/ratings', optionalAuth, async (req, res) => {
  try {
    const courseId = req.params.id;
    const [[agg]] = await pool.query('SELECT AVG(rating) AS avg, COUNT(*) AS cnt FROM course_ratings WHERE course_id=?', [courseId]);
    let myRating = null;
    if (req.user?.email) {
      const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE email=? LIMIT 1', [req.user.email]);
      if (sub) {
        const [[mine]] = await pool.query('SELECT rating, comment FROM course_ratings WHERE course_id=? AND subscriber_id=? LIMIT 1', [courseId, sub.id]);
        if (mine) myRating = mine;
      }
    }
    res.json({ avg: parseFloat((+agg.avg || 0).toFixed(1)), count: agg.cnt, myRating });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Content Analytics: POST /api/lectures/:id/view ──────────────────────────
router.post('/api/lectures/:id/view', optionalAuth, async (req, res) => {
  try {
    await pool.query('UPDATE course_lectures SET view_count = view_count + 1 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Admin: GET /api/admin/lesson-analytics/:courseId ─────────────────────────
router.get('/api/admin/lesson-analytics/:courseId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, sort_order, view_count FROM course_lectures WHERE course_id=? ORDER BY sort_order ASC',
      [req.params.courseId]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Course Completions ───────────────────────────────────────────────────────
// GET /api/me/completions — list digital certificates earned by the subscriber
router.get('/api/me/completions', requireAuth, async (req, res) => {
  try {
    const [[sub]] = await pool.query('SELECT id FROM subscribers WHERE email=? LIMIT 1', [req.user.email]);
    if (!sub) return res.json([]);
    const [rows] = await pool.query(
      `SELECT cc.*, c.title AS course_title, c.thumbnail_url AS course_thumbnail
       FROM course_completions cc
       LEFT JOIN courses c ON c.id = cc.course_id
       WHERE cc.subscriber_id = ?
       ORDER BY cc.completed_at DESC`,
      [sub.id]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/completions/verify/:code — public certificate verification (JSON)
router.get('/api/completions/verify/:code', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT cc.certificate_code, cc.completed_at, s.name AS subscriber_name, c.title AS course_title
       FROM course_completions cc
       JOIN subscribers s ON s.id = cc.subscriber_id
       JOIN courses c ON c.id = cc.course_id
       WHERE cc.certificate_code = ?`,
      [req.params.code]
    );
    if (!row) return res.status(404).json({ error: 'الشهادة غير موجودة' });
    res.json(row);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/completions/:code/certificate — printable HTML certificate (A4 portrait)
router.get('/api/completions/:code/certificate', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT cc.certificate_code, cc.completed_at,
              s.name AS subscriber_name, s.client_code,
              c.title AS course_title, c.hours_count,
              u.name AS instructor_name,
              sc_name.value AS institute_name,
              sc_mgr.value AS training_manager
       FROM course_completions cc
       JOIN subscribers s ON s.id = cc.subscriber_id
       JOIN courses c ON c.id = cc.course_id
       LEFT JOIN users u ON u.id = c.instructor_id
       LEFT JOIN site_config sc_name ON sc_name.\`key\` = 'site_name'
       LEFT JOIN site_config sc_mgr  ON sc_mgr.\`key\`  = 'training_manager_name'
       WHERE cc.certificate_code = ?`,
      [req.params.code]
    );
    if (!row) return res.status(404).send('<h3>الشهادة غير موجودة</h3>');

    const certCode    = row.certificate_code || req.params.code;
    const studentName = (row.subscriber_name || 'Student').toUpperCase();
    const courseName  = row.course_title || 'Training Course';
    const issuedAt    = row.completed_at
      ? new Date(row.completed_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
      : new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const instituteName = row.institute_name || 'Psychology Institute';
    const trainingMgr   = row.training_manager || 'WALID ABDRAHMAN';
    const instructorName = row.instructor_name || 'Trainer';
    const serialNo = row.client_code || certCode.slice(-8).toUpperCase();

    const LOGO_URL = 'https://h.top4top.io/p_3734xfq501.png';
    const qrData   = encodeURIComponent(`CERT:${certCode}|${studentName}|${courseName}`);
    const qrUrl    = `https://api.qrserver.com/v1/create-qr-code/?size=90x90&color=8B0000&bgcolor=fff&data=${qrData}`;
    const verifyUrl = `https://mahadnafsy.com/verify/${certCode}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Certificate – ${studentName}</title>
<style>
  @page { size: A4 portrait; margin: 5mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
  body { background: #f0f0f0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; font-family: Georgia, 'Times New Roman', serif; }
  .toolbar { width: 600px; display: flex; justify-content: space-between; align-items: center; padding: 12px 0; }
  .cert { width: 600px; background: #fff; border: 1px solid #e0e0e0; position: relative; overflow: hidden; }
  .body-pad { padding: 24px 50px 0; text-align: center; }
  .footer-row { display: flex; justify-content: space-between; align-items: flex-end; padding: 8px 36px 0; border-top: 1px solid #eee; gap: 8px; }
  .sig-block { text-align: center; min-width: 135px; }
  .sig-line { width: 88px; height: 30px; border-bottom: 2px solid #333; margin: 0 auto 8px; }
  .sig-badge { border: 1px solid #ccc; border-radius: 4px; padding: 5px 8px; display: inline-flex; align-items: center; gap: 5px; font-size: 10px; color: #555; }
  .serial-badge { border: 1px solid #ccc; border-radius: 4px; padding: 5px 8px; font-size: 9px; color: #555; line-height: 1.5; }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none !important; }
    .cert { border: none; }
  }
  @media screen {
    body { padding: 20px; min-height: 100vh; }
  }
</style>
</head>
<body>

<div class="toolbar no-print">
  <div style="font-size:13px;color:#555">Certificate of Achievement</div>
  <button onclick="window.print()"
    style="background:#B91C1C;color:#fff;border:none;padding:9px 24px;border-radius:6px;font-size:14px;cursor:pointer;font-weight:bold;font-family:Arial">
    🖨️ Print / Save PDF
  </button>
</div>

<div class="cert" id="cert">

  <!-- Top swoosh SVG -->
  <svg viewBox="0 0 595 210" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;margin-bottom:-2px" preserveAspectRatio="none">
    <path d="M 0 0 L 0 205 Q 100 155 297 172 Q 494 189 595 148 L 595 0 Z" fill="#D97706"/>
    <path d="M 0 0 L 0 188 Q 100 138 297 155 Q 494 172 595 132 L 595 0 Z" fill="#B91C1C"/>
    <path d="M 0 0 L 152 12 Q 68 58 0 120 Z" fill="#F59E0B" opacity="0.55"/>
    <path d="M 595 0 L 443 12 Q 527 58 595 120 Z" fill="#F59E0B" opacity="0.55"/>
  </svg>

  <!-- Gold medal (logo) -->
  <div style="position:absolute;top:22px;left:50%;transform:translateX(-50%);width:82px;height:82px;border-radius:50%;background:radial-gradient(circle at 35% 32%, #FEF3C7, #F59E0B 52%, #92400E);box-shadow:0 4px 18px rgba(0,0,0,0.45),0 0 0 4px #FCD34D;display:flex;align-items:center;justify-content:center;z-index:10">
    <img src="${LOGO_URL}" style="width:52px;height:52px;border-radius:50%;object-fit:contain" onerror="this.style.display='none'"/>
  </div>

  <!-- Body -->
  <div class="body-pad">
    <div style="font-size:42px;font-weight:900;letter-spacing:7px;color:#111;line-height:1">CERTIFICATE</div>
    <div style="font-size:14px;letter-spacing:8px;color:#666;margin-top:5px;margin-bottom:12px;font-style:italic">OF ACHIEVEMENT</div>

    <!-- Divider -->
    <div style="display:flex;align-items:center;gap:10px;margin:0 40px 14px">
      <div style="flex:1;height:2px;background:linear-gradient(to right,transparent,#B91C1C)"></div>
      <div style="display:flex;gap:4px">
        <div style="width:6px;height:6px;border-radius:50%;background:#D97706"></div>
        <div style="width:8px;height:8px;border-radius:50%;background:#B91C1C"></div>
        <div style="width:6px;height:6px;border-radius:50%;background:#D97706"></div>
      </div>
      <div style="flex:1;height:2px;background:linear-gradient(to left,transparent,#B91C1C)"></div>
    </div>

    <div style="font-size:22px;font-weight:900;color:#B91C1C;letter-spacing:2px;margin-bottom:5px">${instituteName.toUpperCase()}</div>
    <div style="font-size:11px;letter-spacing:5px;color:#777;margin-bottom:16px">IS PROUDLY PRESENTED TO</div>

    <!-- Student name -->
    <div style="font-size:${studentName.length > 28 ? '20px' : '27px'};font-weight:900;color:#B91C1C;letter-spacing:2px;padding:10px 16px;border-top:2px solid #B91C1C;border-bottom:2px solid #B91C1C;margin:0 24px 16px;line-height:1.4;min-height:54px;display:flex;align-items:center;justify-content:center">
      ${studentName}
    </div>

    <div style="font-size:12px;color:#444;letter-spacing:2px;line-height:2">FOR THE SUCCESSFUL COMPLETION</div>
    <div style="font-size:12px;color:#444;letter-spacing:2px;line-height:2;margin-bottom:10px">OF THE TRAINING COURSE</div>

    <!-- Course name -->
    <div style="font-size:${courseName.length > 50 ? '13px' : '16px'};font-weight:700;color:#1a1a1a;margin:0 16px 16px;letter-spacing:0.5px;line-height:1.5;padding:8px 16px;background:#fafafa;border:1px solid #eee;border-radius:4px">
      ${courseName}
    </div>
  </div>

  <!-- Footer signatures -->
  <div class="footer-row">
    <!-- Trainer -->
    <div class="sig-block">
      <div style="font-size:13px;font-weight:800;margin-bottom:10px;letter-spacing:0.5px">Trainer</div>
      <div class="sig-line"></div>
      <div class="sig-badge" style="direction:rtl">
        <img src="${LOGO_URL}" style="width:18px;height:18px;border-radius:50%;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'"/>
        ${instituteName}
      </div>
    </div>

    <!-- Center: ribbon badge + serial -->
    <div style="text-align:center;flex:1">
      <svg width="52" height="68" viewBox="0 0 52 68" style="display:block;margin:0 auto 6px">
        <defs>
          <radialGradient id="mg" cx="35%" cy="32%">
            <stop offset="0%" stop-color="#FEF3C7"/>
            <stop offset="55%" stop-color="#F59E0B"/>
            <stop offset="100%" stop-color="#92400E"/>
          </radialGradient>
        </defs>
        <circle cx="26" cy="22" r="20" fill="url(#mg)" stroke="#B45309" stroke-width="2"/>
        <text x="26" y="29" text-anchor="middle" font-size="20" fill="#7C2D12" font-weight="bold">★</text>
        <polygon points="14,40 20,40 17,68 9,60" fill="#B91C1C"/>
        <polygon points="32,40 38,40 43,60 35,68" fill="#B91C1C"/>
      </svg>
      <div style="font-size:8px;color:#999;letter-spacing:1px;text-transform:uppercase">Serial No.</div>
      <div style="font-size:11px;font-weight:700;font-family:monospace;color:#B91C1C;margin-top:2px">${serialNo}</div>
      <div style="font-size:8px;color:#aaa;margin-top:2px">${issuedAt}</div>
    </div>

    <!-- Training Manager -->
    <div class="sig-block">
      <div style="font-size:13px;font-weight:800;margin-bottom:10px;letter-spacing:0.5px">Training Manager</div>
      <div class="sig-line"></div>
      <div class="serial-badge">
        <div style="font-weight:800">${trainingMgr.toUpperCase()}</div>
        <div>PSY TRAINING MANAGER</div>
      </div>
    </div>
  </div>

  <!-- QR row -->
  <div style="text-align:center;padding:10px 0 0">
    <a href="${verifyUrl}" target="_blank">
      <img src="${qrUrl}" alt="QR" style="width:54px;height:54px;display:inline-block"/>
    </a>
    <div style="font-size:8px;color:#bbb;margin-top:2px">Scan to verify certificate authenticity</div>
  </div>

  <!-- Bottom swoosh -->
  <svg viewBox="0 0 595 62" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;margin-top:-1px" preserveAspectRatio="none">
    <path d="M 0 62 L 0 25 Q 100 65 297 48 Q 494 31 595 55 L 595 62 Z" fill="#D97706"/>
    <path d="M 0 62 L 0 10 Q 100 50 297 33 Q 494 16 595 42 L 595 62 Z" fill="#B91C1C"/>
  </svg>

</div><!-- /cert -->

<div style="text-align:center;padding:12px;font-size:12px;color:#999">
  Verify at: <a href="${verifyUrl}" style="color:#B91C1C">${verifyUrl}</a>
</div>

<script>
  if (new URLSearchParams(location.search).get('print') === '1') setTimeout(() => window.print(), 500);
</script>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(html);
  } catch (e) { logger.error('[certificate]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Referral System ──────────────────────────────────────────────────────────
// GET /api/referral/my-code — get (or create) referral code for the logged-in subscriber
router.get('/api/referral/my-code', requireAuth, async (req, res) => {
  try {
    const [[sub]] = await pool.query('SELECT id, name FROM subscribers WHERE email=? LIMIT 1', [req.user.email]);
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    const _refCols = 'id, subscriber_id, code, uses, earnings, created_at';
    let [[ref]] = await pool.query(`SELECT ${_refCols} FROM referral_codes WHERE subscriber_id=? LIMIT 1`, [sub.id]);
    if (!ref) {
      // Generate a unique short code: first 4 chars of name (Arabic safe) + 6 random hex
      const prefix = (sub.name || 'REF').replace(/\s+/g,'').slice(0,3).toUpperCase().replace(/[^A-Z0-9]/g,'') || 'REF';
      const code = prefix + Math.random().toString(36).slice(2,8).toUpperCase();
      await pool.query(
        'INSERT INTO referral_codes (id, subscriber_id, code) VALUES (UUID(),?,?)',
        [sub.id, code]
      );
      [[ref]] = await pool.query(`SELECT ${_refCols} FROM referral_codes WHERE subscriber_id=? LIMIT 1`, [sub.id]);
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
       JOIN subscribers s ON s.id = rc.subscriber_id
       ORDER BY rc.uses DESC, rc.created_at DESC
       LIMIT 500`
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/bundles?limit=50
router.get('/api/bundles', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 50, 200);
    const data = await cached(`bundles:${limit}`, 5 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        `SELECT b.*, GROUP_CONCAT(bc.course_id ORDER BY bc.sort_order) AS course_ids_csv
         FROM bundles b
         LEFT JOIN bundle_courses bc ON bc.bundle_id = b.id
         WHERE b.is_published = 1
         GROUP BY b.id
         ORDER BY b.sort_order ASC, b.created_at DESC LIMIT ?`, [limit]
      );
      const [courses] = await pool.query(`SELECT ${COURSE_COLS} FROM courses WHERE is_published = 1`);
      return rows.map(r => mapBundle(r, courses.map(mapCourse)));
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/lectures?limit=500&offset=0
router.get('/api/lectures', async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 500, 5000);
    const offset = parseOffset(req.query.offset);
    const [rows] = await pool.query(
      'SELECT id, course_id, chapter_id, title, description, video_url, duration, is_preview, sort_order, is_published, lecture_type, drip_unlock_days FROM course_lectures WHERE is_published = 1 ORDER BY course_id, sort_order ASC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    const previewLimit = await getPreviewLimit();
    const posByCourse = {};
    res.json(rows.map(r => {
      const pos = (posByCourse[r.course_id] = (posByCourse[r.course_id] ?? -1) + 1);
      return publicLecture(r, pos, previewLimit);
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/chapters?limit=500
router.get('/api/chapters', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 1000);
    const [rows] = await pool.query(
      'SELECT id, course_id, title, sort_order FROM course_chapters ORDER BY course_id, sort_order ASC LIMIT ?', [limit]);
    res.json(rows.map(mapChapter));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/therapists?limit=50
router.get('/api/therapists', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 50, 200);
    const data = await cached(`therapists:${limit}`, 10 * 60 * 1000, async () => {
      const [therapists] = await pool.query(
        `SELECT id, name, specialty, image, experience, rating, title, bio,
         price_egp, price_sar, price_usd, is_consultation_enabled, session_duration_minutes,
         meeting_provider, provider_base_url, featured, sort_order, show_on_home, show_on_about,
         is_active, languages_json, focus_areas_json, qualifications_json, created_at
         FROM therapists WHERE is_active = 1 ORDER BY sort_order ASC LIMIT ?`, [limit]);
      if (therapists.length > 0) {
        const ids = therapists.map(t => t.id);
        const [slots] = await pool.query(
          `SELECT id, therapist_id, day, start_time, end_time, timezone, label, meeting_link, is_active
           FROM therapist_slots WHERE therapist_id IN (${ids.map(() => '?').join(',')}) AND is_active = 1`, ids);
        const slotMap = {};
        slots.forEach(s => { (slotMap[s.therapist_id] = slotMap[s.therapist_id] || []).push(s); });
        therapists.forEach(t => { t.slots = slotMap[t.id] || []; });
      }
      return therapists.map(mapTherapist);
    });
    res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/testimonials
router.get('/api/testimonials', async (req, res) => {
  try {
    const data = await cached('testimonials', 10 * 60 * 1000, async () => {
      const [rows] = await pool.query(
        'SELECT id, name, role, text, image, sort_order, is_active FROM testimonials WHERE is_active = 1 ORDER BY sort_order ASC LIMIT 100');
      return rows;
    });
    res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/content  (public site content key-value store)
router.get('/api/content', async (req, res) => {
  try {
    const data = await cached('site_content', 5 * 60 * 1000, async () => {
      const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'content' LIMIT 1");
      return rows[0]?.value ? JSON.parse(rows[0].value) : {};
    });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(data);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/quizzes
router.get('/api/quizzes', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200, 500);
    const [rows] = await pool.query(
      `SELECT id, course_id, title, questions_json, passing_score, generated_by_ai, created_at
       FROM course_quizzes ORDER BY created_at DESC LIMIT ?`, [limit]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/live-streams
router.get('/api/live-streams', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, instructor_id, instructor_name, scheduled_at, duration_minutes,
       stream_url, platform, visibility, target_course_ids_json, status, recording_url,
       description, created_at
       FROM live_streams ORDER BY scheduled_at DESC LIMIT 200`);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/contact  (نموذج التواصل)
router.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;
    const verr = validate(req.body, { name: 'required|120', phone: 'required|40', message: 'required|2000', email: 'optional|160', subject: 'optional|200' });
    if (verr) return res.status(400).json({ error: verr });
    const id = uuidv4();
    await pool.query(
      'INSERT INTO contact_messages (id, name, email, phone, subject, message) VALUES (?,?,?,?,?,?)',
      [id, name, email || null, phone, subject || null, message]
    );
    // Lifecycle: instant acknowledgment to the sender.
    require('../lib/lifecycle').trigger('contact_received', { name, email, phone });
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/join-us  (طلب انضمام)
router.post('/api/join-us', contactLimiter, async (req, res) => {
  try {
    const { name, email, phone, specialty, experience, type, linkedin, message } = req.body;
    const verr = validate(req.body, { name: 'required|120', email: 'email|160', phone: 'required|40', specialty: 'required|160', type: 'required|40', experience: 'optional|2000', linkedin: 'optional|300', message: 'optional|2000' });
    if (verr) return res.status(400).json({ error: verr });
    const id = uuidv4();
    const safeType = ['INSTRUCTOR', 'CONSULTANT', 'EMPLOYEE'].includes(String(type || '').toUpperCase())
      ? String(type).toUpperCase() : 'INSTRUCTOR';
    await pool.query(
      'INSERT INTO join_us_applications (id, name, email, phone, specialty, experience, type, linkedin, message) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, name, email, phone, specialty, experience || '', safeType, linkedin || null, message || null]
    );
    // Lifecycle: instant acknowledgment to the applicant.
    const roleLabel = { INSTRUCTOR: 'محاضر', CONSULTANT: 'مستشار', EMPLOYEE: 'وظيفة إدارية' }[safeType] || '';
    require('../lib/lifecycle').trigger('join_us_received', { name, email, phone, roleLabel });
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH-REQUIRED ROUTES (logged-in users)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/me/subscriber  — بيانات المشترك لنفسه
router.get('/api/me/subscriber', requireAuth, async (req, res) => {
  try {
    const email = req.user.email?.toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    // Case-insensitive email lookup (handles mixed-case stored emails)
    const [[sub]] = await pool.query(
      `SELECT id, firebase_uid, client_code, lead_id, name, email, phone, branch,
       is_active, notes, assigned_sales_id, assigned_sales_name, assigned_cs_id, assigned_cs_name,
       crm_json, created_at, updated_at
       FROM subscribers WHERE LOWER(TRIM(email)) = ? LIMIT 1`, [email]);
    if (!sub) return res.json(null);

    const [enrollments] = await pool.query(
      `SELECT e.*, c.id AS c_id, c.title AS c_title, c.slug AS c_slug,
              c.thumbnail AS c_thumb, c.instructor AS c_instructor
       FROM enrollments e
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.subscriber_id = ?`, [sub.id]);
    const [payments] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
       payment_method, transaction_id, is_installment, \`date\`, note, status,
       staff_id, staff_name, from_account, source, item_title, cert_type, created_at
       FROM payments WHERE subscriber_id = ? ORDER BY date DESC LIMIT 200`, [sub.id]);
    const [certRequests] = await pool.query(
      `SELECT cr.*, c.id AS c_id, c.title AS c_title
       FROM certificate_requests cr
       LEFT JOIN courses c ON c.id = cr.course_id
       WHERE cr.subscriber_id = ? ORDER BY cr.requested_at DESC`, [sub.id]);
    let mapped = mapSubscriber({ ...sub, enrollments, payments, certRequests });
    // Backward-compat: expand any bundle:xxx keys in enrolledCourseIds to individual course UUIDs
    // (handles subscribers enrolled before the bundle-expansion fix was deployed)
    const bundleKeys = (mapped.enrolledCourseIds || []).filter(id => String(id).startsWith('bundle:'));
    if (bundleKeys.length > 0) {
      const bIds = bundleKeys.map(k => String(k).replace('bundle:', ''));
      const ph = bIds.map(() => '?').join(',');
      const [bRows] = await pool.query(`SELECT course_id FROM bundle_courses WHERE bundle_id IN (${ph})`, bIds).catch(() => [[]]);
      const expandedIds = bRows.map(r => r.course_id);
      const plainIds = (mapped.enrolledCourseIds || []).filter(id => !String(id).startsWith('bundle:'));
      mapped = { ...mapped, enrolledCourseIds: [...new Set([...plainIds, ...expandedIds])] };
    }
    // Fetch full course objects for all enrolled courses (incl. unpublished) so
    // the client can display them even when GET /api/courses filters by is_published
    const allEnrolledIds = mapped.enrolledCourseIds || [];
    let enrolledCoursesData = [];
    if (allEnrolledIds.length > 0) {
      const placeholders = allEnrolledIds.map(() => '?').join(',');
      const [courseRows] = await pool.query(
        `SELECT ${COURSE_COLS} FROM courses WHERE id IN (${placeholders})`, allEnrolledIds);
      enrolledCoursesData = courseRows.map(mapCourse);
    }
    res.json({ ...mapped, enrolledCoursesData });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/me/consultations
router.get('/api/me/consultations', requireAuth, async (req, res) => {
  try {
    const email = req.user.email?.toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const [rows] = await pool.query(
      `SELECT c.*, t.name AS t_name, t.specialty AS t_specialty, t.image AS t_image
       FROM consultations c
       LEFT JOIN therapists t ON t.id = c.therapist_id
       WHERE c.client_email = ?
       ORDER BY c.session_date DESC LIMIT 100`, [email]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/me/heartbeat — تسجيل العميل كـ"متصل الآن"
router.post('/api/me/heartbeat', requireAuth, (req, res) => {
  onlineMap.set(String(req.user.uid), {
    name: (req.body?.name || '').slice(0, 100),
    email: req.user.email || '',
    lastSeen: Date.now(),
  });
  res.json({ ok: true });
});

// GET /api/me/quiz-attempts?subscriberId=xxx
router.get('/api/me/quiz-attempts', requireAuth, async (req, res) => {
  try {
    const { subscriberId } = req.query;
    if (!subscriberId) return res.status(400).json({ error: 'subscriberId required' });
    // Admins and active staff can view any subscriber's quiz attempts
    const isAdmin = ADMIN_EMAILS.includes(req.user.email) || ADMIN_UIDS.includes(req.user.uid);
    if (!isAdmin) {
      // Regular users: verify the subscriber belongs to them (IDOR prevention)
      let isStaff = false;
      try {
        const [[staffRow]] = await pool.query(
          'SELECT id FROM staff WHERE email = ? AND is_active = 1 LIMIT 1',
          [(req.user.email || '').toLowerCase().trim()]
        );
        isStaff = !!staffRow;
      } catch (_) {}
      if (!isStaff) {
        const [[ownerCheck]] = await pool.query(
          'SELECT id FROM subscribers WHERE id = ? AND (firebase_uid = ? OR LOWER(TRIM(email)) = ?) LIMIT 1',
          [subscriberId, req.user.uid || '', (req.user.email || '').toLowerCase().trim()]
        );
        if (!ownerCheck) return res.status(403).json({ error: 'Access denied' });
      }
    }
    const [rows] = await pool.query(
      `SELECT id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at
       FROM quiz_attempts WHERE subscriber_id = ? ORDER BY taken_at DESC LIMIT 200`,
      [subscriberId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
