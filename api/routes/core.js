'use strict';
const logger = require('../lib/logger');
const crypto   = require('crypto');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool, cacheInvalidate } = require('../lib/db');
const { mailer, sendEmail, htmlEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, validate } = require('../lib/helpers');
const { COURSE_COLS, mapCourse, mapBundle, mapTherapist, getNextClientCode } = require('../lib/mappers');
const { createNotification } = require('../lib/notification');
const { logPaymentAudit, logFinancialAudit, postJournalEntry, _paymentAccountCode, _expenseAccountCode, toEgp } = require('../lib/finance');
const { assertWritable } = require('../lib/periodLock');
const { syncLeadDealValue } = require('./public-orders');
const { logLeadEvent } = require('../lib/crm');
const { enqueueEmailSequence } = require('../lib/emailSequence');
const { ADMIN_EMAILS, ADMIN_UIDS, requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { paymobLimiter, whatsappSendLimiter, publicLimiter, contactLimiter } = require('../middleware/rateLimits');
const { safeDateOnly } = require('../lib/dates');
const { isString, validateBody } = require('../middleware/validate');

router.get('/api/admin/expenses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, description, amount, currency, category, date, receipt_url, note, staff_id,
       vat_rate, vat_amount, amount_before_vat, created_at
       FROM expenses ORDER BY date DESC LIMIT 500`);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/payments/:id/status — approve or reject a payment (admin/manager)
router.patch('/api/admin/payments/:id/status', requireAuth, requireAdminOrStaff, requirePermission('manage_payments'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reviewNote } = req.body || {};
    if (!['paid', 'failed', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const actor = req.user?.email || 'admin';

    const [[pay]] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method,
       transaction_id, is_installment, \`date\`, note, status, staff_id, staff_name, from_account,
       source, item_title, cert_type, created_at
       FROM payments WHERE id = ? LIMIT 1`, [id]);
    if (!pay) return res.status(404).json({ error: 'Payment not found' });

    const oldStatus = pay.status || 'paid';
    await pool.query(
      `UPDATE payments SET status = ?, note = COALESCE(CONCAT(COALESCE(note,''), IF(?!='', CONCAT(' | مراجعة: ', ?), '')), note) WHERE id = ?`,
      [status, reviewNote || '', reviewNote || '', id]
    );
    await logPaymentAudit(id, 'update', oldStatus, status, pay.amount, pay.subscriber_id, actor);

    // Update crm_json paymentHistory status — upsert the entry even if not present yet
    if (pay.subscriber_id) {
      const [[sub]] = await pool.query('SELECT crm_json FROM subscribers WHERE id = ? LIMIT 1', [pay.subscriber_id]);
      if (sub) {
        const crm = tryJson(sub.crm_json, {});
        crm.paymentHistory = crm.paymentHistory || [];
        const idx = crm.paymentHistory.findIndex(p => p.id === id);
        const dateStr = safeDateOnly(pay.date);
        if (idx >= 0) {
          crm.paymentHistory[idx] = { ...crm.paymentHistory[idx], status };
        } else {
          crm.paymentHistory.push({
            id, status,
            amount: Number(pay.amount) || 0,
            currency: pay.currency || 'EGP',
            paymentType: (pay.payment_type || 'other').toLowerCase(),
            paymentMethod: pay.payment_method || null,
            transactionId: pay.transaction_id || null,
            isInstallment: !!pay.is_installment,
            courseId: pay.course_id || null,
            bundleId: pay.bundle_id || null,
            note: pay.note || null,
            at: dateStr,
            staffId: pay.staff_id || null,
            staffName: pay.staff_name || null,
            fromAccountNumber: pay.from_account || null,
            source: pay.source || null,
            itemTitle: pay.item_title || null,
            certType: pay.cert_type || null,
          });
        }
        // If newly paid with a course → sync enrolledCourseIds in crm_json + calc commission
        const becomingPaid = status === 'paid' && oldStatus !== 'paid';
        const courseId = pay.course_id || null;
        const bundleId = pay.bundle_id || null;
        if (becomingPaid && (courseId || bundleId)) {
          crm.enrolledCourseIds = crm.enrolledCourseIds || [];
          if (courseId && !crm.enrolledCourseIds.includes(courseId)) {
            crm.enrolledCourseIds.push(courseId);
            crm.courseAccess = crm.courseAccess || {};
            if (!crm.courseAccess[courseId]) crm.courseAccess[courseId] = 'full';
          }
          if (bundleId && !crm.enrolledCourseIds.includes(`bundle:${bundleId}`)) {
            crm.enrolledCourseIds.push(`bundle:${bundleId}`);
          }
          // Determine correct access type — installment payments get 'limited' unless fully paid
          let patchAccessType = 'full';
          if (pay.is_installment) {
            const courseExpected = pay.course_expected ? Number(pay.course_expected) : 0;
            if (courseExpected > 0) {
              const [[paidRow]] = await pool.query(
                `SELECT COALESCE(SUM(amount),0) AS total_paid FROM payments
                 WHERE subscriber_id=? AND (course_id=? OR (? IS NOT NULL AND bundle_id=?)) AND status='paid'`,
                [pay.subscriber_id, courseId || null, bundleId, bundleId || null]
              ).catch(() => [[{ total_paid: 0 }]]);
              const totalPaid = Number(paidRow?.total_paid || 0) + Number(pay.amount || 0);
              patchAccessType = totalPaid >= courseExpected ? 'full' : 'limited';
            } else {
              patchAccessType = 'limited';
            }
            if (courseId && crm.courseAccess) {
              crm.courseAccess[courseId] = patchAccessType;
            }
          }
          await pool.query(
            `INSERT INTO enrollments (id, subscriber_id, course_id, bundle_id, enrolled_at, access_type)
             VALUES (?,?,?,?,NOW(),?)
             ON DUPLICATE KEY UPDATE access_type=IF(VALUES(access_type)='full','full',access_type)`,
            [uuidv4(), pay.subscriber_id, courseId, bundleId, patchAccessType]
          ).catch(() => {});
        }
        await pool.query('UPDATE subscribers SET crm_json = ? WHERE id = ?', [JSON.stringify(crm), pay.subscriber_id]);

        // Calculate commission when payment is newly confirmed as paid
        if (becomingPaid && Number(pay.amount) > 0) {
          // Staff resolution (pay.staff_id → subscriber's assigned sales) happens inside.
          {
            try {
              const [[commSub]] = await pool.query('SELECT assigned_sales_id FROM subscribers WHERE id=? LIMIT 1', [pay.subscriber_id]);
              const finalStaffId = pay.staff_id || commSub?.assigned_sales_id || null;
              if (finalStaffId) {
                const [[rule]] = await pool.query(`
                  SELECT id, percentage_value FROM commission_rules
                  WHERE is_active=1 AND calc_type='PERCENTAGE'
                    AND (staff_id=? OR (staff_id IS NULL AND JSON_CONTAINS(COALESCE(apply_to_roles,'[]'), JSON_QUOTE((SELECT role FROM staff WHERE id=? LIMIT 1)))))
                    AND effective_from <= CURDATE() AND (effective_to IS NULL OR effective_to >= CURDATE())
                    AND (min_payment IS NULL OR min_payment <= ?)
                  ORDER BY staff_id DESC, priority ASC LIMIT 1
                `, [finalStaffId, finalStaffId, Number(pay.amount)]).catch(() => [[null]]);
                let commRate = rule?.percentage_value || 0;
                if (!commRate) {
                  const [[stf]] = await pool.query('SELECT commission_rate FROM staff WHERE id=? LIMIT 1', [finalStaffId]).catch(() => [[null]]);
                  commRate = stf?.commission_rate || 0;
                }
                if (commRate > 0) {
                  // Commission stored in EGP so payroll sums stay single-currency
                  const amtEgp = await toEgp(Number(pay.amount), pay.currency);
                  const commAmount = parseFloat((amtEgp * commRate / 100).toFixed(2));
                  const now = new Date();
                  await pool.query(
                    `INSERT INTO crm_commissions (id, staff_id, payment_id, rule_id, client_id, client_type, payment_amount, commission_amount, calc_details, month, year, status, created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,'PENDING',NOW()) ON DUPLICATE KEY UPDATE commission_amount=VALUES(commission_amount)`,
                    [uuidv4(), finalStaffId, id, rule?.id||null, pay.subscriber_id, 'subscriber',
                     amtEgp, commAmount,
                     JSON.stringify({ rate: commRate, calc_type: 'PERCENTAGE', rule_id: rule?.id||null, trigger: 'status_change_to_paid', originalAmount: Number(pay.amount), originalCurrency: pay.currency || 'EGP' }),
                     now.getMonth()+1, now.getFullYear()]
                  );
                }
              }
            } catch (commErr) { logger.warn('[patch-payment] commission calc error:', commErr.message); }
          }
          // Send WhatsApp payment confirmation to subscriber
          const [[subPhone]] = await pool.query('SELECT phone FROM subscribers WHERE id=? LIMIT 1', [pay.subscriber_id]).catch(() => [[null]]);
          if (subPhone?.phone) {
            const payDateStr = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
            let courseLabel = '';
            if (courseId) {
              const [[ci]] = await pool.query('SELECT title FROM courses WHERE id=? LIMIT 1', [courseId]).catch(() => [[null]]);
              courseLabel = ci?.title || '';
            }
            const waMsg = `✅ تم تأكيد دفعتك!\nالمبلغ: ${pay.amount} ${pay.currency || 'EGP'}${courseLabel ? '\nالبرنامج: ' + courseLabel : ''}\nالتاريخ: ${payDateStr}\nشكراً لثقتك بمعهد الدراسات النفسية 💚`;
            sendWhatsApp(subPhone.phone.replace(/\D/g, ''), waMsg).catch(() => {});
          }
        }
      }
    }

    res.json({ ok: true, id, status });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/staff
router.post('/api/admin/staff', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = req.body;
    const id = s.id || uuidv4();
    // Accept both camelCase (frontend) and snake_case (direct DB) field names
    const role           = ((s.role || 'other').toUpperCase());  // DB ENUM is uppercase
    const firebaseUid    = s.firebaseUid    || s.firebase_uid    || null;
    const joinedAt       = s.joinedAt       || s.joined_at       || new Date().toISOString();
    const commissionRate = s.commissionRate || s.commission_rate || null;
    const isActive       = s.is_active !== undefined ? s.is_active
                         : (s.status === 'inactive' ? 0 : 1);
    const permissionsJson = s.permissions_json
      || (Array.isArray(s.permissions) ? JSON.stringify(s.permissions) : null);
    await pool.query(
      `INSERT INTO staff (id, firebase_uid, name, email, phone, role, image, specialization, joined_at, is_active, notes, commission_rate, permissions_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), role=VALUES(role), image=VALUES(image), is_active=VALUES(is_active), notes=VALUES(notes), commission_rate=VALUES(commission_rate), permissions_json=VALUES(permissions_json)`,
      [id, firebaseUid, s.name||'', s.email||'', s.phone||'', role, s.image||null, s.specialization||null, joinedAt, isActive, s.notes||null, commissionRate, permissionsJson]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/staff
// (removed dead duplicate GET /api/admin/staff — live in an earlier-mounted router)

// GET /api/staff/me — any authenticated user can get their own staff record (for role-based dashboard)
router.get('/api/staff/me', requireAuth, async (req, res) => {
  try {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const [rows] = await pool.query(
      'SELECT id, firebase_uid, name, email, phone, role, is_active, image, specialization, joined_at, created_at, notes, commission_rate, permissions_json FROM staff WHERE LOWER(email) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1',
      [email]
    );
    if (!rows.length) return res.json(null);
    const r = rows[0];
    res.json({
      id: r.id,
      name: r.name || '',
      email: r.email || '',
      phone: r.phone || '',
      role: (r.role || 'other').toLowerCase(),
      status: r.is_active ? 'active' : 'inactive',
      image: r.image || null,
      specialization: r.specialization || null,
      joinedAt: r.joined_at || r.created_at || null,
      firebaseUid: r.firebase_uid || null,
      commissionRate: r.commission_rate || null,
      notes: r.notes || null,
      permissions: r.permissions_json ? tryJson(r.permissions_json, []) : [],
    });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/staff/me — update own safe profile fields (name, phone, image)
router.patch('/api/staff/me', requireAuth, async (req, res) => {
  try {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const { name, phone, image } = req.body || {};
    const fields = [];
    const vals = [];
    if (name !== undefined && typeof name === 'string') { fields.push('name = ?'); vals.push(name.slice(0, 120)); }
    if (phone !== undefined && typeof phone === 'string') { fields.push('phone = ?'); vals.push(phone.slice(0, 30)); }
    if (image !== undefined && (image === null || typeof image === 'string')) { fields.push('image = ?'); vals.push(image ? image.slice(0, 500) : null); }
    if (fields.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    vals.push(email);
    await pool.query(`UPDATE staff SET ${fields.join(', ')} WHERE LOWER(email) COLLATE utf8mb4_unicode_ci = ?`, vals);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/consultations
router.get('/api/admin/consultations', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      `SELECT c.*, t.name AS t_name, t.specialty AS t_specialty
       FROM consultations c
       LEFT JOIN therapists t ON t.id = c.therapist_id
       ORDER BY c.session_date DESC LIMIT ?`, [limit]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/activity-logs
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
    // ── Force utf8mb4_unicode_ci on all main tables (unconditional — safe to re-run) ────
    for (const tbl of ['staff', 'leads', 'subscribers', 'users']) {
      await pool.query(`ALTER TABLE ${tbl} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`).catch(e => {
        logger.warn(`[startup] collation fix skipped for ${tbl}:`, e.message);
      });
    }
    logger.info('[startup] Collation fix applied to staff/leads/subscribers/users tables');
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
    logger.info('[startup] staff permissions_json column ensured');
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
router.delete('/api/admin/staff/:id', requireAuth, requireAdmin, async (req, res) => {
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
router.post('/api/admin/backfill-payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, crm_json FROM subscribers WHERE crm_json IS NOT NULL LIMIT 5000`
    );
    let inserted = 0, skipped = 0;
    const VALID_TYPES = new Set(['COURSE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER']);
    for (const row of rows) {
      const crm = tryJson(row.crm_json, {});
      const history = Array.isArray(crm.paymentHistory) ? crm.paymentHistory : [];
      for (const p of history) {
        if (!p.id || !p.amount || Number(p.amount) <= 0) { skipped++; continue; }
        const payType = (p.paymentType || 'OTHER').toUpperCase();
        const safeType = VALID_TYPES.has(payType) ? payType : 'OTHER';
        const dateVal = p.at || p.date || new Date().toISOString().slice(0, 10);
        try {
          const [result] = await pool.query(
            `INSERT IGNORE INTO payments
               (id, subscriber_id, course_id, bundle_id, amount, currency, payment_type,
                payment_method, transaction_id, is_installment, date, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              p.id, row.id,
              p.courseId || null, p.bundleId || null,
              Number(p.amount) || 0,
              p.currency || 'EGP',
              safeType,
              p.paymentMethod || null,
              p.transactionId || null,
              p.isInstallment ? 1 : 0,
              typeof dateVal === 'string' ? dateVal.slice(0,10) : new Date().toISOString().slice(0,10),
              p.note || null,
            ]
          );
          if (result.affectedRows > 0) inserted++; else skipped++;
        } catch (_) { skipped++; }
      }
    }
    logger.info(`[backfill-payments] inserted=${inserted} skipped=${skipped}`);
    res.json({ ok: true, inserted, skipped });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Shows every subscriber who has access to a course but no payment record.
// Used to audit the historical gap (735 enrollments vs ~1 payment record).
router.get('/api/admin/reconcile-payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        s.name,
        s.email,
        s.client_code,
        s.branch,
        c.title   AS course_title,
        e.enrolled_at,
        p.id      AS payment_id,
        p.amount  AS payment_amount
      FROM enrollments e
      JOIN subscribers s ON s.id = e.subscriber_id
      LEFT JOIN courses c ON c.id = e.course_id
      LEFT JOIN payments p ON p.subscriber_id = e.subscriber_id
        AND (p.course_id = e.course_id OR p.course_id IS NULL)
      WHERE p.id IS NULL
      ORDER BY e.enrolled_at DESC
      LIMIT 500
    `);
    const [[totals]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM enrollments) AS total_enrollments,
        (SELECT COUNT(*) FROM payments)    AS total_payments,
        COUNT(DISTINCT e.id)               AS unpaid_enrollments
      FROM enrollments e
      LEFT JOIN payments p ON p.subscriber_id = e.subscriber_id
        AND (p.course_id = e.course_id OR p.course_id IS NULL)
      WHERE p.id IS NULL
    `);
    res.json({ summary: totals, unpaid: rows });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Payment Audit Log ────────────────────────────────────────────────────────
// GET /api/admin/payment-audit — paginated audit trail for all payment events
router.get('/api/admin/payment-audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1'));
    const limit = Math.min(200, parseInt(req.query.limit || '50'));
    const offset = (page - 1) * limit;
    const { paymentId, action, dateFrom, dateTo } = req.query;

    let where = '1=1';
    const params = [];
    if (paymentId) { where += ' AND a.payment_id = ?'; params.push(paymentId); }
    if (action)    { where += ' AND a.action = ?';     params.push(action); }
    if (dateFrom)  { where += ' AND a.created_at >= ?'; params.push(dateFrom + ' 00:00:00'); }
    if (dateTo)    { where += ' AND a.created_at <= ?'; params.push(dateTo + ' 23:59:59'); }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM payment_audit_log a WHERE ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS subscriber_name, s.client_code
       FROM payment_audit_log a
       LEFT JOIN subscribers s ON s.id = a.subscriber_id
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ total, page, limit, rows });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Server Monitor ────────────────────────────────────────────────────────────
// GET /api/admin/ai/config — returns server-side Gemini key (admin only, never exposed in client bundle)
router.get('/api/admin/ai/config', requireAuth, requireAdmin, (req, res) => {
  res.json({ geminiKey: process.env.GEMINI_API_KEY || null });
});

// GET /api/admin/server-status — process info + watchdog log (nohup mode, no PM2)
router.get('/api/admin/server-status', requireAuth, requireAdmin, (req, res) => {
  const _path = require('path');
  const _fs2 = require('fs');

  // Build process info from the CURRENT running process (nohup mode)
  const mem = process.memoryUsage();
  const pm2Info = {
    status: 'online',
    uptime: Math.round(process.uptime() * 1000), // ms
    restarts: 0,
    memory: mem.rss,
    cpu: 0,
    pid: process.pid,
  };

  // Tail cron.log (last 30 lines — written by Hostinger cron watchdog.sh)
  let watchdogLog = [];
  try {
    const cronLogPath = _path.join(__dirname, 'cron.log');
    const watchdogLogPath = _path.join(__dirname, 'watchdog.log');
    const logPath = _fs2.existsSync(cronLogPath) ? cronLogPath : watchdogLogPath;
    if (_fs2.existsSync(logPath)) {
      const lines = _fs2.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
      watchdogLog = lines.slice(-30);
    }
  } catch (_) {}

  // Read crash-history.log — permanent, never trimmed
  let crashHistory = [];
  let totalCrashes = 0;
  let totalStarts = 0;
  let autoHeals = 0;
  try {
    const crashPath = _path.join(__dirname, 'crash-history.log');
    if (_fs2.existsSync(crashPath)) {
      const lines = _fs2.readFileSync(crashPath, 'utf8').split('\n').filter(Boolean);
      totalCrashes = lines.filter(l => l.includes('[CRASH]')).length;
      totalStarts  = lines.filter(l => l.includes('[START]')).length;
      autoHeals    = lines.filter(l => l.includes('[AUTO-HEAL]')).length;
      crashHistory = lines.slice(-100);
    }
  } catch (_) {}

  res.json({
    ok: true,
    time: new Date().toISOString(),
    pm2: pm2Info,
    watchdogLog,
    crashHistory,
    stats: { totalCrashes, totalStarts, autoHeals },
    memNow: mem.rss,
    dbPool: { connectionLimit: pool.pool?.config?.connectionLimit ?? null },
  });
});

// POST /api/admin/server-restart — restart via watchdog (nohup mode, no PM2)
router.post('/api/admin/server-restart', requireAuth, requireAdmin, (req, res) => {
  const { spawn } = require('child_process');
  const _path = require('path');
  const NODE2 = '/opt/alt/alt-nodejs22/root/usr/bin/node';
  const APP_DIR = __dirname;

  // Respond first so the client gets the response before we die
  res.json({ ok: true, message: 'جاري إعادة التشغيل... سيعود خلال ثوانٍ' });

  // Spawn a detached child that kills us and relaunches (watchdog also catches the gap)
  setTimeout(() => {
    const child = spawn('/bin/bash', ['-c',
      `sleep 2 && for pid in $(ps aux | grep nodejs22 | grep -v grep | awk '{print $2}'); do kill -9 $pid 2>/dev/null; done; rm -f /tmp/mahad_supervisor.pid; sleep 2 && cd '${APP_DIR}' && nohup ${NODE2} supervisor.js >> '${APP_DIR}/server.log' 2>&1 &`
    ], { detached: true, stdio: 'ignore' });
    child.unref();
  }, 500);
});


// ── Expenses CRUD ─────────────────────────────────────────────────────────────
// Posts the double-entry journal for an expense (debit 5xxx, credit 1100), normalised to EGP.
// sign=+1 records the expense, sign=-1 posts a reversal (on update/delete).
async function postExpenseJournal(expense, sign, actor) {
  const amt = await toEgp(Number(expense.amount) || 0, expense.currency);
  if (!amt) return;
  const [accCode, accName] = _expenseAccountCode(expense.category);
  const dateStr = String(expense.date || new Date().toISOString()).slice(0, 10);
  const label = sign > 0
    ? `مصروف ${expense.amount} ${expense.currency || 'EGP'} (= ${amt} EGP) — ${expense.description || accName}`
    : `عكس مصروف ${expense.amount} ${expense.currency || 'EGP'} (= ${amt} EGP) — ${expense.description || accName}`;
  const lines = sign > 0
    ? [
        { account_code: accCode, account_name: accName,      debit: amt, credit: 0 },
        { account_code: '1100', account_name: 'نقدية وبنوك', debit: 0,   credit: amt },
      ]
    : [
        { account_code: '1100', account_name: 'نقدية وبنوك', debit: amt, credit: 0 },
        { account_code: accCode, account_name: accName,      debit: 0,   credit: amt },
      ];
  await postJournalEntry(sign > 0 ? 'expense' : 'expense_reversal', expense.id, dateStr, label, lines, actor || 'system');
}

router.post('/api/admin/expenses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const e2 = req.body;
    const id = e2.id || uuidv4();
    const expDate = e2.date || new Date().toISOString().slice(0, 10);
    await assertWritable(expDate); // reject writes into a closed accounting period
    const [result] = await pool.query(
      `INSERT INTO expenses (id, date, description, amount, currency, category, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE description=VALUES(description), amount=VALUES(amount),
         category=VALUES(category), notes=VALUES(notes)`,
      [id, e2.date||new Date().toISOString().slice(0,10), e2.description||'',
       e2.amount||0, e2.currency||'EGP', e2.category||'other', e2.notes||null,
       e2.created_at||new Date().toISOString()]
    );
    // affectedRows: 1 = fresh insert, 2 = duplicate-key update (already journaled via PATCH path)
    if (result.affectedRows === 1) {
      postExpenseJournal({ ...e2, id }, +1, req.user?.email).catch(() => {});
    }
    res.json({ ok: true, id });
  } catch (e) {
    if (e.status === 409) return res.status(409).json({ error: e.message });
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});
router.patch('/api/admin/expenses/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const e2 = req.body;
    const [[oldExp]] = await pool.query('SELECT id, date, description, amount, currency, category FROM expenses WHERE id=? LIMIT 1', [req.params.id]);
    await pool.query(
      'UPDATE expenses SET description=?, amount=?, category=?, notes=? WHERE id=?',
      [e2.description||'', e2.amount||0, e2.category||'other', e2.notes||null, req.params.id]
    );
    // Journal: reverse the old amount then post the new one (keeps ledger = expenses table)
    if (oldExp) {
      postExpenseJournal(oldExp, -1, req.user?.email)
        .then(() => postExpenseJournal({ ...oldExp, ...e2, id: req.params.id }, +1, req.user?.email))
        .catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/expenses/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[oldExp]] = await pool.query('SELECT id, date, description, amount, currency, category FROM expenses WHERE id=? LIMIT 1', [req.params.id]);
    await pool.query('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    if (oldExp) postExpenseJournal(oldExp, -1, req.user?.email).catch(() => {});
    res.json({ ok: true });
  }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Activity Logs POST ────────────────────────────────────────────────────────
router.post('/api/admin/activity-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const a = req.body;
    const id = a.id || uuidv4();
    await pool.query(
      'INSERT IGNORE INTO activity_logs (id, action, entity, entity_name, user_id, at) VALUES (?,?,?,?,?,?)',
      [id, a.action||'', a.entity||'', a.entity_name||'', a.user_id||req.user.uid,
       a.at||new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Subscriber enrollments & payments ─────────────────────────────────────────
router.post('/api/admin/enrollments', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    // Allow: super-admins OR online_manager staff
    if (!req.isSuperAdmin) {
      const role = (req.staffRecord?.role || '').toLowerCase();
      if (role !== 'online_manager') return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { subscriber_id, course_id, bundle_id, access_level, lecture_limit } = req.body;
    if (!subscriber_id || (!course_id && !bundle_id)) return res.status(400).json({ error: 'subscriber_id and course_id or bundle_id required' });
    const accessType = access_level === 'limited' ? 'limited' : 'full';
    await pool.query(
      `INSERT INTO enrollments (id, subscriber_id, course_id, bundle_id, enrolled_at, access_type, lecture_limit)
       VALUES (?,?,?,?,NOW(),?,?)
       ON DUPLICATE KEY UPDATE access_type=VALUES(access_type), lecture_limit=VALUES(lecture_limit)`,
      [uuidv4(), subscriber_id, course_id || null, bundle_id || null, accessType, lecture_limit || null]
    );

    // Send enrollment confirmation email
    setImmediate(async () => {
      try {
        const [[subData]] = await pool.query('SELECT name, email FROM subscribers WHERE id=? LIMIT 1', [subscriber_id]);
        if (!subData?.email) return;
        let itemName = 'الاشتراك';
        if (course_id) {
          const [[courseRow]] = await pool.query('SELECT title FROM courses WHERE id=? LIMIT 1', [course_id]);
          itemName = courseRow?.title || 'الكورس';
        } else if (bundle_id) {
          const [[bundleRow]] = await pool.query('SELECT title FROM bundles WHERE id=? LIMIT 1', [bundle_id]);
          itemName = bundleRow?.title || 'الباقة';
        }
        await sendEmail(subData.email,
          `🎓 تم تسجيلك في ${itemName}`,
          `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="color:#7c3aed">مبروك ${subData.name || 'عزيزنا'}! 🎉</h2>
            <p>تم تسجيلك بنجاح في: <strong>${itemName}</strong></p>
            <p>يمكنك الوصول إليه الآن من خلال <a href="https://mahadnafsy.com/dashboard" style="color:#7c3aed">لوحة التحكم</a>.</p>
            <p style="color:#9ca3af;font-size:12px">معهد نفسي — mahadnafsy.com</p>
          </div>`
        );
      } catch (e) { logger.warn('[email] enrollment confirmation failed:', e.message); }
    });

    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
// ── Join-Us Applications admin GET/PUT/DELETE ────────────────────────────────
router.get('/api/admin/join-us', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, specialty, experience, type, linkedin, message, status, admin_note, created_at
       FROM join_us_applications ORDER BY created_at DESC LIMIT 500`);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.patch('/api/admin/join-us/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, notes } = req.body;
    await pool.query('UPDATE join_us_applications SET status=?, message=COALESCE(?,message) WHERE id=?',
      [status||'new', notes||null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/join-us/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM join_us_applications WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Contact Messages admin GET/PATCH/DELETE ───────────────────────────────────
router.get('/api/admin/contact-messages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, subject, message, status, admin_note, created_at
       FROM contact_messages ORDER BY created_at DESC LIMIT 500`);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.patch('/api/admin/contact-messages/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE contact_messages SET status=? WHERE id=?',
      [req.body.status||'new', req.params.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/contact-messages/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM contact_messages WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


// ── Quiz Attempts GET/POST/DELETE ─────────────────────────────────────────────
router.get('/api/admin/quiz-attempts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      'SELECT id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at FROM quiz_attempts ORDER BY taken_at DESC LIMIT ?',
      [limit]
    );
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/api/admin/quiz-attempts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const a = req.body;
    const id = a.id || uuidv4();
    await pool.query(
      `INSERT INTO quiz_attempts (id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE score=VALUES(score), passed=VALUES(passed)`,
      [id, a.subscriberId||null, a.quizId||null, a.courseId||null,
       a.score||0, a.passed?1:0, JSON.stringify(a.answers||[]),
       a.takenAt||new Date().toISOString()]
    );
    // ── Auto-certificate on quiz pass ──────────────────────────────────────────
    if (a.passed && a.courseId && a.subscriberId) {
      try {
        const [[alreadyDone]] = await pool.query('SELECT id FROM course_completions WHERE subscriber_id=? AND course_id=? LIMIT 1', [a.subscriberId, a.courseId]);
        if (!alreadyDone) {
          const certCode = 'MHAD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
          await pool.query('INSERT IGNORE INTO course_completions (id, subscriber_id, course_id, certificate_code) VALUES (UUID(),?,?,?)', [a.subscriberId, a.courseId, certCode]);
          const [[course]] = await pool.query('SELECT title FROM courses WHERE id=? LIMIT 1', [a.courseId]);
          const [[sub]] = await pool.query('SELECT name, email FROM subscribers WHERE id=? LIMIT 1', [a.subscriberId]);
          if (sub?.email) {
            sendEmail(sub.email, `🎓 مبروك! اجتزت اختبار "${course?.title || ''}"`,
              htmlEmail('شهادة إتمام', `
                <p>مبروك <strong>${sub.name || ''}</strong>!</p>
                <p>لقد اجتزت بنجاح اختبار <strong>${course?.title || ''}</strong>.</p>
                <div class="otp-box">${certCode}</div>
                <p>يمكنك التحقق من شهادتك على موقعنا.</p>
              `)
            ).catch(() => {});
          }
        }
      } catch (cerr) { logger.warn('[quiz] auto-cert error:', cerr.message); }
    }
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.delete('/api/admin/quiz-attempts/:id', requireAuth, requireAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM quiz_attempts WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Client Code Counter (atomic) ──────────────────────────────────────────────
router.post('/api/admin/next-client-code', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE client_code_counter SET next_value = next_value + 1 WHERE id = 1');
    const [[row]] = await pool.query('SELECT next_value FROM client_code_counter WHERE id = 1');
    const code = `C${(row.next_value - 1)}`;
    res.json({ ok: true, code });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Sync counter to MAX existing code ─────────────────────────────────────────
// Call this once to repair the counter if codes were assigned locally in bulk
router.post('/api/admin/sync-client-code-counter', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[subMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM subscribers WHERE client_code REGEXP '^C[0-9]+$'`
    );
    const [[leadMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM leads WHERE client_code REGEXP '^C[0-9]+$'`
    );
    const maxVal = Math.max(subMax.mx || 0, leadMax.mx || 0);
    const newNext = maxVal >= 10000 ? maxVal + 1 : 10001;
    await conn.query(
      'UPDATE client_code_counter SET next_value = ? WHERE id = 1 AND next_value < ?',
      [newNext, newNext]
    );
    await conn.commit();
    const [[counterRow]] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1');
    res.json({ ok: true, maxExisting: maxVal, counterNow: counterRow.next_value });
  } catch (e) {
    await conn.rollback();
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});


// POST /api/admin/leads/migrate-branches — fill branch column from rawBranch (crm_json) or notes for branchless leads
router.post('/api/admin/leads/migrate-branches', requireAuth, requireAdmin, async (req, res) => {
  try {
    const normB = (v) => {
      if (!v) return null;
      const s = v.trim().toLowerCase().replace(/[\s_\-]/g, '');
      if (s.includes('دقي') || s.includes('daqqi') || s.includes('dokki')) return 'DAQQI';
      if (s.includes('تجمع') || s.includes('tagamoa') || s.includes('tagamo') || s.includes('قاهرةالجديدة') || s.includes('cairo') || s.includes('قاطميه') || s.includes('قطاميه') || s.includes('qatat')) return 'TAGAMOA';
      if (s.includes('online') || s.includes('اونلاين') || s.includes('أونلاين') || s.includes('اون')) {
        if (s.includes('سعودي') || s.includes('saudi')) return 'ONLINE_SAUDI';
        if (s.includes('خارج') || s.includes('abroad')) return 'ONLINE_ABROAD';
        return 'ONLINE_EGYPT';
      }
      if (s.length >= 2) return 'OTHER';
      return null;
    };

    const tryParseJson = (s, def) => { try { return JSON.parse(s); } catch { return def; } };

    const [rows] = await pool.query(
      `SELECT id, notes, crm_json FROM leads WHERE hidden=0 AND (branch IS NULL OR branch='')`
    );

    let updated = 0;
    const results = [];
    for (const row of rows) {
      const crm = tryParseJson(row.crm_json, {});
      // 1. Try rawBranch from crm_json first
      let raw = (crm.rawBranch || '').trim();
      // 2. Try crm_json.branch (stored as e.g. "online-egypt", "other", "daqqi")
      if (!raw && crm.branch) raw = String(crm.branch).trim();
      // 3. Fallback: extract from notes "الفرع: X"
      if (!raw && row.notes) {
        const m = /الفرع:\s*([^|\n]+)/.exec(row.notes);
        if (m) raw = m[1].trim();
      }
      if (!raw) continue;
      const branch = normB(raw);
      if (!branch) { results.push({ id: row.id, raw, branch: null }); continue; }
      await pool.query('UPDATE leads SET branch=? WHERE id=?', [branch, row.id]);
      updated++;
      results.push({ id: row.id, raw, branch });
    }
    res.json({ ok: true, updated, total: rows.length, results });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Admin data-maintenance tools (cleanup-junk-leads, cleanup-staff-subscribers,
// fix-auto-subscribers, bulk-assign-client-codes, fix-all-codes) moved to
// routes/admin-maintenance.js to slim core.js (Refactor #3).

// ── is-staff check ────────────────────────────────────────────────────────────
router.get('/api/me/is-staff', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    if (ADMIN_UIDS.includes(uid) || ADMIN_EMAILS.includes(email||'')) {
      return res.json({ isStaff: true, isAdmin: true });
    }
    const [[row]] = await pool.query(
      'SELECT id, role FROM staff WHERE (firebase_uid = ? OR email = ?) AND is_active = 1 LIMIT 1',
      [uid, email||'']
    );
    res.json({ isStaff: !!row, isAdmin: false, staffId: row?.id, role: row?.role });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Register activity (logged-in user opts in for a course / confirms interest) ─
// Was incorrectly named /api/auth/register — renamed to avoid duplicate route conflict.
router.post('/api/me/register-interest', requireAuth, async (req, res) => {
  try {
    const { name, phone, source } = req.body;
    const { uid, email } = req.user;
    // Auto-create lead in DB
    const id = `reg-${uid}`;
    await pool.query(
      `INSERT IGNORE INTO leads (id, name, email, phone, source, status)
       VALUES (?,?,?,?,?,?)`,
      [id, name||email?.split('@')[0]||'مستخدم', email||'', phone||'', source||'تسجيل اهتمام', 'new']
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Health check ──────────────────────────────────────────────────────────────
router.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: e.message });
  }
});

// ── Atomic client-code counter (admin) ───────────────────────────────────────
router.post('/api/admin/client-code', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
    const next = rows[0]?.next_value ?? 10001;
    await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [next + 1]);
    await conn.commit();
    res.json({ ok: true, code: `C${next}` });
  } catch (e) {
    await conn.rollback();
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// ── Public registration (creates a lead + issues client code) ─────────────────
router.post('/api/registrations', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const item = req.body;
    const id = item.id || uuidv4();
    // Atomic client code issuance
    let code = `C${Date.now()}`;
    try {
      await conn.beginTransaction();
      const [cRows] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
      const next = cRows[0]?.next_value ?? 10001;
      await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [next + 1]);
      await conn.commit();
      code = `C${next}`;
    } catch { await conn.rollback(); }
    conn.release();
    // Insert lead
    const { id: _id, name, email, phone, source, status, notes, createdAt, created_at, ...crmData } = item;
    await pool.query(
      `INSERT INTO leads (id, client_code, name, email, phone, source, status, notes, crm_json)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE crm_json=VALUES(crm_json),
         client_code=COALESCE(client_code, VALUES(client_code))`,
      [id, code, name||'', email||null, phone||'', source||'تسجيل اهتمام',
       'new', notes||null, JSON.stringify({ ...crmData, clientCode: code })]
    );
    res.json({ ok: true, id, clientCode: code });
  } catch (e) {
    try { conn.release(); } catch { /* ignore */ }
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ── Lead Capture Widget (public, no auth) ────────────────────────────────────
// POST /api/leads-public
router.post('/api/leads-public', publicLimiter,
  validateBody({
    name:  v => isString(v, 120) || 'name is required (max 120 chars)',
    phone: v => isString(v, 30)  || 'phone is required (max 30 chars)',
  }),
  async (req, res) => {
  try {
    const { name, phone, notes, source } = req.body;
    const id = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // Assign sequential client code
    let code = null;
    const conn = await pool.getConnection();
    try { code = await getNextClientCode(conn); } catch (_) {} finally { conn.release(); }
    await pool.execute(
      `INSERT INTO leads (id, client_code, name, phone, notes, status, interest_level, source, lead_type, created_at, hidden)
       VALUES (?, ?, ?, ?, ?, 'new', 'medium', ?, 'general', NOW(), 0)`,
      [id, code, name.trim().slice(0, 120), phone.trim().slice(0, 30), (notes || '').trim().slice(0, 500), (source || 'chatbot').slice(0, 50)]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── CRM Settings (sources, auto-assign, gsheet) ──────────────────────────────
router.get('/api/admin/crm-settings', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'crm_settings'");
    res.json(rows[0]?.value ? JSON.parse(rows[0].value) : {});
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});
router.put('/api/admin/crm-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('crm_settings', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});


// ── Round-Robin Lead Distribution ────────────────────────────────────────────
// POST /api/admin/leads/distribute
// body: { mode: 'unassigned' | 'all' }  — 'unassigned' only touches leads with no rep yet
router.post('/api/admin/leads/distribute', requireAuth, requireAdmin, async (req, res) => {
  const { mode = 'unassigned' } = req.body || {};
  try {
    const whereClause = mode === 'all'
      ? `WHERE hidden=0 AND status NOT IN ('converted','lost')`
      : `WHERE hidden=0 AND assigned_sales_id IS NULL AND status NOT IN ('converted','lost')`;
    const [targets] = await pool.execute(
      `SELECT id FROM leads ${whereClause} ORDER BY created_at ASC`
    );
    // Get all sales reps (staff with sales role)
    const [reps] = await pool.execute(
      `SELECT id, name FROM staff WHERE role IN ('SALES','MANAGER') AND is_active=1 ORDER BY name ASC`
    );
    if (!reps.length) return res.json({ ok: false, assigned: 0, reason: 'No sales reps found' });
    if (!targets.length) return res.json({ ok: true, assigned: 0 });
    // Use persisted round-robin index
    const [rrRows] = await pool.query("SELECT `value` FROM site_config WHERE `key`='crm_rr_index'");
    let rrIdx = parseInt(rrRows[0]?.value || '0') || 0;
    let count = 0;
    for (let i = 0; i < targets.length; i++) {
      const rep = reps[rrIdx % reps.length];
      await pool.execute(
        `UPDATE leads SET assigned_sales_id=?, assigned_sales_name=? WHERE id=?`,
        [rep.id, rep.name, targets[i].id]
      );
      rrIdx++;
      count++;
    }
    // Persist updated RR index
    await pool.query(
      "INSERT INTO site_config (`key`,`value`) VALUES ('crm_rr_index',?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [String(rrIdx)]
    );
    res.json({ ok: true, assigned: count, reps: reps.length });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Abandoned Checkout Lead Capture ──────────────────────────────────────────
// POST /api/public/checkout-intent  (requires auth — user must be logged in)
// Called by Checkout.tsx on mount when a logged-in user lands on checkout.
// Creates/updates a CRM lead with source='checkout_intent' so sales can follow up.
router.post('/api/public/checkout-intent', requireAuth, publicLimiter, async (req, res) => {
  try {
    const { itemId, itemType, itemTitle } = req.body || {};
    const { uid, email } = req.user;
    if (!email) return res.json({ ok: false, reason: 'no_email' });

    // Skip if already a subscriber (no point creating an "abandoned" lead)
    const [[alreadySub]] = await pool.query(
      'SELECT id FROM subscribers WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [email.toLowerCase().trim()]
    );
    if (alreadySub) return res.json({ ok: true, skipped: true, reason: 'already_subscriber' });

    // Upsert lead — create if not exists, update source/note if exists
    const leadId = `checkout-${uid}`;
    const crmJson = JSON.stringify({ interestedCourseIds: itemId ? [itemId] : [], itemTitle, itemType });
    await pool.query(
      `INSERT INTO leads (id, name, email, source, status, hidden, crm_json, created_at)
       VALUES (?, ?, ?, 'checkout_intent', 'new', 0, ?, NOW())
       ON DUPLICATE KEY UPDATE
         source = IF(source = 'checkout_intent', source, source),
         crm_json = VALUES(crm_json)`,
      [leadId, email.split('@')[0], email.toLowerCase().trim(), crmJson]
    );
    res.json({ ok: true });
  } catch (e) {
    logger.warn('[checkout-intent]', e.message);
    res.json({ ok: false, reason: e.message }); // best-effort — don't fail the checkout page
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Admin Subscriber Lecture Progress ─────────────────────────────
// GET /api/admin/subscribers/:id/payments — fetch all payments for a single subscriber (authoritative)
router.get('/api/admin/subscribers/:id/payments', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const subId = req.params.id;
    const [payRows] = await pool.query(
      `SELECT id, subscriber_id, course_id, bundle_id, amount, currency,
              payment_type, payment_method, transaction_id, is_installment, \`date\`, note,
              status, staff_id, staff_name, from_account, source, item_title, cert_type, branch
       FROM payments WHERE subscriber_id = ? ORDER BY \`date\` ASC`,
      [subId]
    );
    const payments = payRows.map(p => {
      const d = p.date;
      const dateStr = d instanceof Date ? d.toISOString().slice(0,10) : String(d || '').slice(0,10);
      return {
        id: p.id,
        amount: Number(p.amount) || 0,
        currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(),
        paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null,
        isInstallment: !!p.is_installment,
        courseId: p.course_id || null,
        bundleId: p.bundle_id || null,
        note: p.note || null,
        at: dateStr,
        status: p.status || 'paid',
        staffId: p.staff_id || null,
        staffName: p.staff_name || null,
        fromAccountNumber: p.from_account || null,
        source: p.source || null,
        itemTitle: p.item_title || null,
        certType: p.cert_type || null,
        branch: p.branch || null,
      };
    });
    res.json(payments);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/subscribers/:id/progress — get all lecture progress for a subscriber
router.get('/api/admin/subscribers/:id/progress', requireAuth, requireAdmin, async (req, res) => {
  try {
    const subId = req.params.id;
    // Get from lecture_progress table
    const [lpRows] = await pool.query(
      `SELECT lp.*, cl.title AS lecture_title, cl.course_id, c.title AS course_title
       FROM lecture_progress lp
       LEFT JOIN course_lectures cl ON cl.id = lp.lecture_id
       LEFT JOIN courses c ON c.id = lp.course_id
       WHERE lp.subscriber_id = ?
       ORDER BY lp.updated_at DESC`,
      [subId]
    );
    // Also get from crm_json lectureProgress (fallback)
    const [[sub]] = await pool.query('SELECT crm_json FROM subscribers WHERE id=? LIMIT 1', [subId]);
    const crm = tryJson(sub?.crm_json, {});
    const crmProgress = crm.lectureProgress || {};
    // Get all enrolled courses (batch load lectures + courses in 2 queries)
    const enrolledIds = (crm.enrolledCourseIds || []).filter(id => !id.startsWith('bundle:'));
    const courseStats = [];
    if (enrolledIds.length > 0) {
      const ph = enrolledIds.map(() => '?').join(',');
      const [allLectures] = await pool.query(
        `SELECT id, title, course_id FROM course_lectures WHERE course_id IN (${ph}) ORDER BY course_id, sort_order`,
        enrolledIds
      );
      const [allCourses] = await pool.query(`SELECT id, title FROM courses WHERE id IN (${ph})`, enrolledIds);
      const lecturesByCourse = {};
      allLectures.forEach(l => { (lecturesByCourse[l.course_id] = lecturesByCourse[l.course_id] || []).push(l); });
      const courseMap = Object.fromEntries(allCourses.map(c => [c.id, c.title]));
      for (const courseId of enrolledIds) {
        const lectures = lecturesByCourse[courseId] || [];
        const total = lectures.length;
        const completed = lectures.filter(l => (crmProgress[l.id] || 0) >= 90).length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        courseStats.push({ courseId, courseTitle: courseMap[courseId] || courseId, total, completed, pct });
      }
    }
    res.json({ lpRows, crmProgress, courseStats });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ── Waitlist ─────────────────────────────────────────────────────────────────
module.exports = router;
