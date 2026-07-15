'use strict';

function installCoreStartupSchema({ pool, logger }) {
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
        amount DECIMAL(12,2) NOT NULL,
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
        commission_rate DECIMAL(5,2) DEFAULT NULL,
        permissions_json TEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY idx_staff_email (email)
      ) CHARACTER SET utf8mb4`);
      // ── users table (JWT auth) ─────────────────────────────────────────────────
      await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(100) PRIMARY KEY,
        firebase_uid VARCHAR(128) DEFAULT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'user',
        is_active TINYINT DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4`);
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128) DEFAULT NULL AFTER id').catch(() => {});
      await pool.query('ALTER TABLE users ADD INDEX IF NOT EXISTS idx_users_firebase (firebase_uid)').catch(() => {});
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
        amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
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
}

module.exports = { installCoreStartupSchema };
