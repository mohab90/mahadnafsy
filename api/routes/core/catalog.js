'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');

const { pool, cacheInvalidate } = require('../../lib/db');
const { mailer, sendEmail, htmlEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, validate } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, mapBundle, mapTherapist, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logPaymentAudit, logFinancialAudit, postJournalEntry, _paymentAccountCode, _expenseAccountCode, toEgp } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
const { syncLeadDealValue } = require('../public-orders');
const { logLeadEvent } = require('../../lib/crm');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, ADMIN_UIDS, requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { paymobLimiter, whatsappSendLimiter, publicLimiter, contactLimiter } = require('../../middleware/rateLimits');
const { safeDateOnly } = require('../../lib/dates');
const { isString, validateBody } = require('../../middleware/validate');

router.get('/api/admin/activity-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit, 200, 500);
    const offset = parseOffset(req.query.offset);
    const [rows] = await pool.query(
      'SELECT id, action, entity, entity_id, label, actor, at FROM activity_logs ORDER BY at DESC LIMIT ? OFFSET ?', [limit, offset]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Initialize extra tables on startup ───────────────────────────────────────
// ── Initialize extra tables on startup ───────────────────────────────────────
(async () => {
  try {
    // Ensure crm_json column exists on subscribers and leads for rich CRM data
    await pool.query(`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS crm_json LONGTEXT`).catch(() => {});
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_json LONGTEXT`).catch(() => {});
    await pool.query(`CREATE TABLE IF NOT EXISTS lead_timeline (
      id VARCHAR(100) PRIMARY KEY,
      lead_id VARCHAR(100) NOT NULL,
      event_type VARCHAR(80) NOT NULL,
      description TEXT,
      meta_json TEXT,
      at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_lt_lead (lead_id),
      INDEX idx_lt_at (at)
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS site_config (
      \`key\` VARCHAR(100) PRIMARY KEY,
      \`value\` LONGTEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS community_posts (
      id VARCHAR(100) PRIMARY KEY, title VARCHAR(500), category VARCHAR(100),
      body LONGTEXT, author VARCHAR(200), image_url TEXT, tags TEXT,
      featured TINYINT(1) DEFAULT 0, pinned TINYINT(1) DEFAULT 0, likes INT DEFAULT 0,
      created_at VARCHAR(50)
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS community_library (
      id VARCHAR(100) PRIMARY KEY, title VARCHAR(500), category VARCHAR(100),
      description TEXT, file_url TEXT, thumbnail TEXT, file_type VARCHAR(50),
      tags TEXT, created_at VARCHAR(50)
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS community_videos (
      id VARCHAR(100) PRIMARY KEY, title VARCHAR(500), category VARCHAR(100),
      description TEXT, video_url TEXT, thumbnail TEXT, duration VARCHAR(50),
      tags TEXT, created_at VARCHAR(50)
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS community_events (
      id VARCHAR(100) PRIMARY KEY, title VARCHAR(500), category VARCHAR(100),
      description TEXT, image_url TEXT, event_date VARCHAR(100),
      date_label VARCHAR(200), location_name VARCHAR(300),
      registration_url TEXT, is_online TINYINT(1) DEFAULT 0,
      tags TEXT, created_at VARCHAR(50)
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS inbox_conversations (
      id VARCHAR(100) PRIMARY KEY, channel VARCHAR(50),
      contact_name VARCHAR(200), contact_id VARCHAR(200), contact_avatar TEXT,
      last_message TEXT, last_message_at VARCHAR(50), unread_count INT DEFAULT 0,
      status VARCHAR(50) DEFAULT 'open', assigned_to_staff_id VARCHAR(100),
      assigned_to_staff_name VARCHAR(200), tags TEXT, messages LONGTEXT,
      linked_lead_id VARCHAR(100), linked_subscriber_id VARCHAR(100),
      created_at VARCHAR(50),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS client_code_counter (
      id INT PRIMARY KEY DEFAULT 1, next_value INT DEFAULT 10001
    ) CHARACTER SET utf8mb4`);
    await pool.query(`INSERT IGNORE INTO client_code_counter (id, next_value) VALUES (1, 10001)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS automation_workflows (
      id VARCHAR(100) PRIMARY KEY, name VARCHAR(300), \`trigger\` VARCHAR(100),
      action VARCHAR(100), enabled TINYINT(1) DEFAULT 1,
      conditions TEXT, action_config TEXT, last_triggered_at VARCHAR(50),
      trigger_count INT DEFAULT 0, created_at VARCHAR(50)
    ) CHARACTER SET utf8mb4`);
    // ── Payment proofs — client uploads transfer/instapay receipts ────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS payment_proofs (
      id VARCHAR(100) PRIMARY KEY,
      subscriber_id VARCHAR(100) NOT NULL,
      course_id VARCHAR(100) DEFAULT NULL,
      amount DOUBLE NOT NULL,
      currency ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
      payment_method VARCHAR(50) NOT NULL DEFAULT 'instapay',
      proof_image MEDIUMTEXT DEFAULT NULL,
      note TEXT DEFAULT NULL,
      status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
      reviewer_id VARCHAR(100) DEFAULT NULL,
      reviewer_note TEXT DEFAULT NULL,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME DEFAULT NULL,
      INDEX idx_pp_subscriber (subscriber_id),
      INDEX idx_pp_status (status)
    ) CHARACTER SET utf8mb4`);
    // ── Staff members table ────────────────────────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS staff (
      id VARCHAR(100) PRIMARY KEY,
      firebase_uid VARCHAR(128) DEFAULT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(50) NOT NULL DEFAULT '',
      role ENUM('INSTRUCTOR','TRAINER','EXPERT','SALES','MANAGER','ADMIN','SUPPORT','RECEPTION_DAQQI','COLLECTION','ACCOUNTANT','CONSULTANT','OTHER') NOT NULL DEFAULT 'OTHER',
      image TEXT DEFAULT NULL,
      specialization VARCHAR(255) DEFAULT NULL,
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      notes TEXT DEFAULT NULL,
      commission_rate DOUBLE DEFAULT NULL,
      permissions_json TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY idx_staff_email (email)
    ) CHARACTER SET utf8mb4`);
    // ── users table (JWT auth) ─────────────────────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(100) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      is_active TINYINT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4`);
    // ── Ensure utf8mb4_unicode_ci on main tables — ONLY when not already correct ──
    // CRITICAL: `CONVERT TO CHARACTER SET` REBUILDS the whole table (full copy +
    // table lock). Running it unconditionally on EVERY startup repeatedly locked
    // staff/users/subscribers — on the constrained host this blocked logins and
    // fed a restart→rebuild→restart crash-loop. So we check the current collation
    // first and skip the rebuild entirely once the tables are already correct.
    try {
      const [collRows] = await pool.query(
        `SELECT TABLE_NAME AS t, TABLE_COLLATION AS c FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('staff','leads','subscribers','users')`
      );
      const needFix = (collRows || []).filter(r => r.c && r.c !== 'utf8mb4_unicode_ci').map(r => r.t);
      for (const tbl of needFix) {
        await pool.query(`ALTER TABLE \`${tbl}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`).catch(e => {
          logger.warn(`[startup] collation fix skipped for ${tbl}:`, e.message);
        });
      }
      if (needFix.length) logger.info(`[startup] Collation fixed for: ${needFix.join(', ')}`);
      else logger.info('[startup] Collation already correct (staff/leads/subscribers/users) — no rebuild');
    } catch (e) {
      logger.warn('[startup] collation check failed (skipping):', e.message);
    }
    // ── Ensure payments table has all required columns (schema evolution) ─────────────
    const paymentsExtraCols = [
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_name VARCHAR(255) DEFAULT NULL",
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS from_account VARCHAR(255) DEFAULT NULL",
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT NULL",
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS item_title VARCHAR(255) DEFAULT NULL",
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS cert_type VARCHAR(100) DEFAULT NULL",
    ];
    for (const col of paymentsExtraCols) { await pool.query(col).catch(() => {}); }
    // Ensure index on staff_id for role-scoped payment queries
    await pool.query(`ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_staff (staff_id)`).catch(() => {});
    // Index on transaction_id for fast idempotency checks in Paymob webhook handler
    await pool.query(`ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_txn_id (transaction_id(191))`).catch(() => {});
    logger.info('[startup] payments columns ensured');
    // ── Ensure staff table has permissions_json column (schema evolution) ────
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS permissions_json TEXT DEFAULT NULL`).catch(() => {});
    // ── Ensure staff sales-target / bonus columns exist (were UI-only before) ─
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_target DECIMAL(12,2) DEFAULT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_target_type VARCHAR(10) DEFAULT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_leads_target INT DEFAULT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_bonus DECIMAL(12,2) DEFAULT NULL`).catch(() => {});
    // ── Per-staff personal preferences (WhatsApp number/templates/tags) ──────
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS preferences_json TEXT DEFAULT NULL`).catch(() => {});
    logger.info('[startup] staff permissions_json + target/bonus + preferences columns ensured');
    // ── Daqqi tables ────────────────────────────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS daqqi_rounds (
      id VARCHAR(36) NOT NULL,
      code VARCHAR(50) NOT NULL DEFAULT '',
      course_id VARCHAR(36) NOT NULL DEFAULT '',
      instructor_id VARCHAR(100) DEFAULT NULL,
      instructor_name VARCHAR(255) NOT NULL DEFAULT '',
      reception_id VARCHAR(100) DEFAULT NULL,
      reception_name VARCHAR(255) NOT NULL DEFAULT '',
      day_of_week VARCHAR(20) NOT NULL DEFAULT '',
      start_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      time_slot ENUM('MORNING','NOON','EVENING') NOT NULL DEFAULT 'EVENING',
      status ENUM('NEW','ACTIVE','FINISHED') NOT NULL DEFAULT 'NEW',
      current_lecture INT NOT NULL DEFAULT 0,
      postponed_weeks_json TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_daqqi_code (code)
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS daqqi_attendees (
      round_id VARCHAR(36) NOT NULL,
      subscriber_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      phone VARCHAR(50) NOT NULL DEFAULT '',
      booked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      amount_paid DOUBLE NOT NULL DEFAULT 0,
      attended_lectures INT NOT NULL DEFAULT 0,
      PRIMARY KEY (round_id, subscriber_id)
    ) CHARACTER SET utf8mb4`);
    logger.info('✅ Extra tables OK');
    // ── Ensure phone columns are nullable (required for UNIQUE constraint to work with missing phones) ──
    await pool.query(`ALTER TABLE subscribers MODIFY COLUMN phone VARCHAR(50) NULL DEFAULT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE leads MODIFY COLUMN phone VARCHAR(50) NULL DEFAULT NULL`).catch(() => {});
    // ── Data cleanup: normalize empty/whitespace phones to NULL ──────────────
    await pool.query(`UPDATE subscribers SET phone = NULL WHERE phone IS NOT NULL AND TRIM(phone) = ''`).catch(() => {});
    await pool.query(`UPDATE leads SET phone = NULL WHERE phone IS NOT NULL AND TRIM(phone) = ''`).catch(() => {});
    // ── Ensure unique indexes ────────────────────────────────────────────────
    // subscribers: email unique
    await pool.query(`ALTER TABLE subscribers ADD CONSTRAINT uq_subs_email UNIQUE (email(191))`).catch(() => {});
    // subscribers: client_code unique
    await pool.query(`ALTER TABLE subscribers ADD CONSTRAINT uq_subs_code UNIQUE (client_code(50))`).catch(() => {});
    // subscribers: phone unique (NULL-safe: multiple NULLs allowed, only non-null values enforced)
    await pool.query(`ALTER TABLE subscribers ADD CONSTRAINT uq_subs_phone UNIQUE (phone(50))`).catch(() => {});
    // users: email unique
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (email(191))`).catch(() => {});
    // plain_password column removed — never store plaintext passwords
    logger.info('[startup] Unique indexes ensured');
  } catch (e) { logger.error('Table init error:', e.message); }
})();

// ── DELETE endpoints for basic entities ───────────────────────────────────────
router.delete('/api/admin/subscribers/:id', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    // Get subscriber data before deleting
    const [[sub]] = await conn.query('SELECT id, email, phone FROM subscribers WHERE id = ? LIMIT 1', [req.params.id]);
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });

    // Delete subscriber record completely
    await conn.query('DELETE FROM subscribers WHERE id = ?', [req.params.id]);

    // Fully delete users account (not just deactivate) so email can be reused
    if (sub.email) {
      const normEmail = sub.email.toLowerCase().trim();
      await conn.query('DELETE FROM users WHERE LOWER(TRIM(email)) = ? AND role = ?', [normEmail, 'user']);
      await conn.query('DELETE FROM otp_codes WHERE email = ?', [normEmail]);
    }

    logger.info(`[delete-subscriber] fully deleted id=${sub.id} email=${sub.email}`);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
  finally { conn.release(); }
});
router.delete('/api/admin/leads/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('UPDATE leads SET hidden = 1 WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/staff/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM staff WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/lectures/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM course_lectures WHERE id = ?', [req.params.id]); cacheInvalidate('courses'); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/chapters/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM course_chapters WHERE id = ?', [req.params.id]); cacheInvalidate('courses'); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
// GET /api/admin/therapists — all therapists (including inactive) with slots
router.get('/api/admin/therapists', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [therapists] = await pool.query(
      `SELECT id, name, specialty, image, experience, rating, title, bio,
       price_egp, price_sar, price_usd, is_consultation_enabled, session_duration_minutes,
       meeting_provider, provider_base_url, featured, sort_order, show_on_home, show_on_about,
       is_active, languages_json, focus_areas_json, qualifications_json, created_at
       FROM therapists ORDER BY sort_order ASC, name ASC`);
    if (therapists.length > 0) {
      const ids = therapists.map(t => t.id);
      const [slots] = await pool.query(
        `SELECT id, therapist_id, day, start_time, end_time, timezone, label, meeting_link, is_active
         FROM therapist_slots WHERE therapist_id IN (${ids.map(() => '?').join(',')}) ORDER BY day, start_time`, ids);
      const slotMap = {};
      slots.forEach(s => { (slotMap[s.therapist_id] = slotMap[s.therapist_id] || []).push(s); });
      therapists.forEach(t => { t.slots = slotMap[t.id] || []; });
    }
    res.json(therapists.map(mapTherapist));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/therapists/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM therapists WHERE id = ?', [req.params.id]); cacheInvalidate('therapists'); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/testimonials/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM testimonials WHERE id = ?', [req.params.id]); cacheInvalidate('testimonials'); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Bundles CRUD ───────────────────────────────────────────────────────────────
router.get('/api/admin/bundles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200, 500);
    const [rows] = await pool.query(
      `SELECT b.*, GROUP_CONCAT(bc.course_id ORDER BY bc.sort_order) AS course_ids_csv
       FROM bundles b
       LEFT JOIN bundle_courses bc ON bc.bundle_id = b.id
       GROUP BY b.id
       ORDER BY b.sort_order ASC, b.created_at DESC LIMIT ?`, [limit]
    );
    const [courses] = await pool.query(`SELECT ${COURSE_COLS} FROM courses WHERE is_published = 1`);
    const mappedCourses = courses.map(mapCourse);
    res.json(rows.map(r => mapBundle(r, mappedCourses)));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/bundles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body;
    const id = b.id || uuidv4();
    const titleEn      = b.title_en      ?? b.titleEn      ?? null;
    const shortDesc    = b.short_description ?? b.shortDescription ?? '';
    const videoUrl     = b.video_url     ?? b.videoUrl     ?? null;
    const priceEGP     = b.price_egp     ?? b.price?.EGP   ?? 0;
    const priceSAR     = b.price_sar     ?? b.price?.SAR   ?? 0;
    const priceUSD     = b.price_usd     ?? b.price?.USD   ?? 0;
    const origEGP      = b.orig_price_egp  ?? b.originalPrice?.EGP ?? 0;
    const origSAR      = b.orig_price_sar  ?? b.originalPrice?.SAR ?? 0;
    const origUSD      = b.orig_price_usd  ?? b.originalPrice?.USD ?? 0;
    const detailsJson  = b.details_content_json ?? (b.detailsContent != null ? JSON.stringify(b.detailsContent) : null);
    const isPublished  = b.is_published != null ? (b.is_published ? 1 : 0) : (b.isPublished != null ? (b.isPublished ? 1 : 0) : 0);
    const sortOrder    = b.sort_order    ?? b.sortOrder    ?? 0;
    const courseIds    = b.course_ids    ?? b.courseIds    ?? null;
    await pool.query(
      `INSERT INTO bundles (id, title, title_en, slug, short_description, description, thumbnail, video_url,
         price_egp, price_sar, price_usd, orig_price_egp, orig_price_sar, orig_price_usd,
         details_content_json, is_published, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), title_en=VALUES(title_en), short_description=VALUES(short_description),
         description=VALUES(description), thumbnail=VALUES(thumbnail), video_url=VALUES(video_url),
         price_egp=VALUES(price_egp), price_sar=VALUES(price_sar), price_usd=VALUES(price_usd),
         orig_price_egp=VALUES(orig_price_egp), orig_price_sar=VALUES(orig_price_sar), orig_price_usd=VALUES(orig_price_usd),
         details_content_json=VALUES(details_content_json), is_published=VALUES(is_published),
         sort_order=VALUES(sort_order), updated_at=CURRENT_TIMESTAMP`,
      [id, b.title||'', titleEn, b.slug||null, shortDesc, b.description||'',
       b.thumbnail||'', videoUrl,
       priceEGP, priceSAR, priceUSD, origEGP, origSAR, origUSD,
       detailsJson, isPublished, sortOrder]
    );
    // Sync courses into bundle_courses join table
    if (Array.isArray(courseIds)) {
      await pool.query('DELETE FROM bundle_courses WHERE bundle_id = ?', [id]);
      for (let i = 0; i < courseIds.length; i++) {
        await pool.query(
          'INSERT IGNORE INTO bundle_courses (bundle_id, course_id, sort_order) VALUES (?,?,?)',
          [id, courseIds[i], i]
        );
      }
    }
    cacheInvalidate('bundles');
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/bundles/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM bundle_courses WHERE bundle_id = ?', [req.params.id]);
    await pool.query('DELETE FROM bundles WHERE id = ?', [req.params.id]);
    cacheInvalidate('bundles');
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Quizzes CRUD ──────────────────────────────────────────────────────────────
router.post('/api/admin/quizzes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const q = req.body;
    const id = q.id || uuidv4();
    const courseId     = q.course_id    ?? q.courseId    ?? null;
    const passingScore = q.passing_score ?? q.passingScore ?? 70;
    const questions    = q.questions || [];
    // course_id has FK constraint — only insert if a valid course_id is provided
    if (!courseId) return res.status(400).json({ error: 'course_id is required' });
    await pool.query(
      `INSERT INTO course_quizzes (id, course_id, title, questions_json, passing_score, created_at)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), questions_json=VALUES(questions_json),
         passing_score=VALUES(passing_score), updated_at=CURRENT_TIMESTAMP`,
      [id, courseId, q.title||'', JSON.stringify(questions), passingScore,
       q.created_at||new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/quizzes/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM course_quizzes WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Live Streams CRUD ─────────────────────────────────────────────────────────
router.post('/api/admin/live-streams', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = req.body;
    const id = s.id || uuidv4();
    const streamUrl      = s.stream_url         ?? s.streamUrl         ?? '';
    const scheduledAt    = s.scheduled_at       ?? s.scheduledAt       ?? new Date().toISOString();
    const durationMins   = s.duration_minutes   ?? s.durationMinutes   ?? 60;
    const instructorName = s.instructor_name    ?? s.instructorName    ?? s.instructor ?? null;
    const targetIds      = s.target_course_ids_json ??
                           (Array.isArray(s.targetCourseIds) ? JSON.stringify(s.targetCourseIds) : null);
    const platform  = (s.platform  || 'ZOOM').toUpperCase().replace('-','_');
    const visibility= (s.visibility|| 'ALL_SUBSCRIBERS').toUpperCase().replace(/-/g,'_');
    const status    = (s.status    || 'UPCOMING').toUpperCase();
    await pool.query(
      `INSERT INTO live_streams (id, title, instructor_name, scheduled_at, duration_minutes,
         stream_url, platform, visibility, target_course_ids_json, status, description, recording_url, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), instructor_name=VALUES(instructor_name),
         scheduled_at=VALUES(scheduled_at), stream_url=VALUES(stream_url),
         platform=VALUES(platform), visibility=VALUES(visibility),
         target_course_ids_json=VALUES(target_course_ids_json),
         status=VALUES(status), description=VALUES(description),
         recording_url=VALUES(recording_url)`,
      [id, s.title||'', instructorName||'', scheduledAt, durationMins,
       streamUrl, platform, visibility, targetIds, status,
       s.description||null, s.recording_url||s.recordingUrl||null,
       s.created_at||new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/live-streams/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM live_streams WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Consultations CRUD ────────────────────────────────────────────────────────
router.post('/api/admin/consultations', requireAuth, requireAdmin, async (req, res) => {
  try {
    const c = req.body;
    const id = c.id || uuidv4();
    await pool.query(
      `INSERT INTO consultations (id, therapist_id, client_name, client_email, client_phone,
         session_date, session_type, status, notes, meeting_link, amount, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         status=VALUES(status), notes=VALUES(notes), meeting_link=VALUES(meeting_link),
         session_date=VALUES(session_date), updated_at=CURRENT_TIMESTAMP`,
      [id, c.therapist_id||null, c.client_name||'', c.client_email||null,
       c.client_phone||null, c.session_date||null, c.session_type||'online',
       c.status||'pending', c.notes||null, c.meeting_link||null, c.amount||0,
       c.created_at||new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.patch('/api/admin/consultations/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, notes, meeting_link } = req.body;
    await pool.query(
      'UPDATE consultations SET status=?, notes=?, meeting_link=? WHERE id=?',
      [status||'pending', notes||null, meeting_link||null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/consultations/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM consultations WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Financial Reconciliation — enrollments without matching payment ────────────
// POST /api/admin/backfill-payments — one-time: sync paymentHistory from crm_json → payments table
// Idempotent: uses INSERT IGNORE on the payment id so re-runs are safe.
module.exports = router;
