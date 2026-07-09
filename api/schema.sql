-- ══════════════════════════════════════════════════════════════
-- MySQL Schema — المعهد الجديد | mahadnafsy.com
-- ══════════════════════════════════════════════════════════════
-- ⚠️  SOURCE OF TRUTH / مصدر الحقيقة:
--   ملف الـ migrations في api/migrations/ هو المرجع الموثوق لسكيما الإنتاج،
--   ويُطبَّق عبر:  node tools/run-migrations.mjs
--   migration 007_consolidated_runtime_schema.sql = اللقطة الكاملة للإنتاج (90 جدول).
--
--   هذا الملف (schema.sql) لقطة bootstrap مبسّطة (~32 جدول أساسي) للتطوير المحلي
--   فقط. عند أي اختلاف، الـ migrations هي الصحيحة. لا تعتمد عليه في الإنتاج.
-- ══════════════════════════════════════════════════════════════
-- الاستخدام (تطوير محلي فقط): mysql -u USER -p DB < schema.sql
--   ثم: node tools/run-migrations.mjs   (لتطبيق بقية الـ migrations)
-- ══════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ── Catalog Tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `courses` (
  `id`                       VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `course_code`              VARCHAR(50)  DEFAULT NULL,
  `slug`                     VARCHAR(255) DEFAULT NULL,
  `title`                    VARCHAR(500) NOT NULL,
  `title_en`                 VARCHAR(500) DEFAULT NULL,
  `title_ar`                 VARCHAR(500) DEFAULT NULL,
  `description`              TEXT NOT NULL,
  `short_description`        TEXT NOT NULL,
  `instructor`               VARCHAR(255) NOT NULL,
  `thumbnail`                TEXT NOT NULL,
  `category`                 ENUM('THERAPY','DIAGNOSIS','CHILD','GENERAL') NOT NULL,
  `type`                     ENUM('RECORDED','LIVE','MIX') NOT NULL,
  `price_egp`                DECIMAL(12,2) NOT NULL DEFAULT 0,
  `price_sar`                DECIMAL(12,2) NOT NULL DEFAULT 0,
  `price_usd`                DECIMAL(12,2) NOT NULL DEFAULT 0,
  `orig_price_egp`           DECIMAL(12,2) NOT NULL DEFAULT 0,
  `orig_price_sar`           DECIMAL(12,2) NOT NULL DEFAULT 0,
  `orig_price_usd`           DECIMAL(12,2) NOT NULL DEFAULT 0,
  `rating`                   DOUBLE NOT NULL DEFAULT 0,
  `students`                 INT NOT NULL DEFAULT 0,
  `duration`                 VARCHAR(100) NOT NULL DEFAULT '',
  `level`                    VARCHAR(100) NOT NULL DEFAULT '',
  `hours`                    DOUBLE DEFAULT NULL,
  `promo_video_url`          TEXT DEFAULT NULL,
  `live_session_url`         TEXT DEFAULT NULL,
  `certificate_template_url` TEXT DEFAULT NULL,
  `certificate_template_name`VARCHAR(255) DEFAULT NULL,
  `is_published`             TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order`               INT NOT NULL DEFAULT 0,
  `modules_json`             LONGTEXT DEFAULT NULL,
  `gallery_images_json`      LONGTEXT DEFAULT NULL,
  `details_content_json`     LONGTEXT DEFAULT NULL,
  `course_modules_json`      LONGTEXT DEFAULT NULL,
  `created_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_courses_slug` (`slug`),
  KEY `idx_courses_published` (`is_published`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `course_materials` (
  `id`           VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `course_id`    VARCHAR(36)  NOT NULL,
  `title`        VARCHAR(500) NOT NULL,
  `url`          TEXT NOT NULL,
  `access_level` ENUM('PARTIAL','FULL') NOT NULL,
  `sort_order`   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_materials_course` (`course_id`),
  CONSTRAINT `fk_materials_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `course_chapters` (
  `id`         VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `course_id`  VARCHAR(36)  NOT NULL,
  `title`      VARCHAR(500) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_chapters_course` (`course_id`),
  CONSTRAINT `fk_chapters_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `course_lectures` (
  `id`           VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `course_id`    VARCHAR(36)  NOT NULL,
  `chapter_id`   VARCHAR(36)  DEFAULT NULL,
  `title`        VARCHAR(500) NOT NULL,
  `lecture_type` ENUM('RECORDED','LIVE') NOT NULL,
  `video_url`    TEXT NOT NULL,
  `duration`     VARCHAR(50)  NOT NULL DEFAULT '',
  `thumbnail`    TEXT DEFAULT NULL,
  `sort_order`   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_lectures_course` (`course_id`),
  KEY `idx_lectures_chapter` (`chapter_id`),
  CONSTRAINT `fk_lectures_course`   FOREIGN KEY (`course_id`)  REFERENCES `courses`         (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lectures_chapter`  FOREIGN KEY (`chapter_id`) REFERENCES `course_chapters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `bundles` (
  `id`                VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `title`             VARCHAR(500) NOT NULL,
  `title_en`          VARCHAR(500) DEFAULT NULL,
  `slug`              VARCHAR(255) DEFAULT NULL,
  `video_url`         TEXT DEFAULT NULL,
  `short_description` TEXT DEFAULT NULL,
  `description`       TEXT NOT NULL,
  `price_egp`         DECIMAL(12,2) NOT NULL DEFAULT 0,
  `price_sar`         DECIMAL(12,2) NOT NULL DEFAULT 0,
  `price_usd`         DECIMAL(12,2) NOT NULL DEFAULT 0,
  `orig_price_egp`    DECIMAL(12,2) NOT NULL DEFAULT 0,
  `orig_price_sar`    DECIMAL(12,2) NOT NULL DEFAULT 0,
  `orig_price_usd`    DECIMAL(12,2) NOT NULL DEFAULT 0,
  `is_published`      TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order`        INT NOT NULL DEFAULT 0,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_bundles_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `bundle_courses` (
  `bundle_id`  VARCHAR(36) NOT NULL,
  `course_id`  VARCHAR(36) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`bundle_id`, `course_id`),
  CONSTRAINT `fk_bc_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bc_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `testimonials` (
  `id`         VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `name`       VARCHAR(255) NOT NULL,
  `role`       VARCHAR(255) NOT NULL,
  `text`       TEXT NOT NULL,
  `image`      TEXT NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── People Tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `therapists` (
  `id`                         VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `name`                       VARCHAR(255) NOT NULL,
  `specialty`                  VARCHAR(255) NOT NULL,
  `image`                      TEXT NOT NULL,
  `experience`                 INT NOT NULL DEFAULT 0,
  `rating`                     DOUBLE NOT NULL DEFAULT 5,
  `title`                      VARCHAR(255) DEFAULT NULL,
  `bio`                        TEXT DEFAULT NULL,
  `price_egp`                  DECIMAL(12,2) NOT NULL DEFAULT 0,
  `price_sar`                  DECIMAL(12,2) NOT NULL DEFAULT 0,
  `price_usd`                  DECIMAL(12,2) NOT NULL DEFAULT 0,
  `is_consultation_enabled`    TINYINT(1) NOT NULL DEFAULT 0,
  `session_duration_minutes`   INT DEFAULT 60,
  `meeting_provider`           ENUM('ZOOM','GOOGLE_MEET','CUSTOM') DEFAULT NULL,
  `provider_base_url`          TEXT DEFAULT NULL,
  `featured`                   TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order`                 INT NOT NULL DEFAULT 0,
  `show_on_home`               TINYINT(1) NOT NULL DEFAULT 0,
  `show_on_about`              TINYINT(1) NOT NULL DEFAULT 0,
  `is_active`                  TINYINT(1) NOT NULL DEFAULT 1,
  `languages_json`             TEXT DEFAULT NULL,
  `focus_areas_json`           TEXT DEFAULT NULL,
  `qualifications_json`        TEXT DEFAULT NULL,
  `created_at`                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `therapist_slots` (
  `id`           VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `therapist_id` VARCHAR(36)  NOT NULL,
  `day`          VARCHAR(20)  NOT NULL,
  `start_time`   VARCHAR(10)  NOT NULL,
  `end_time`     VARCHAR(10)  NOT NULL,
  `timezone`     VARCHAR(100) NOT NULL,
  `label`        VARCHAR(255) DEFAULT NULL,
  `meeting_link` TEXT DEFAULT NULL,
  `is_active`    TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_slots_therapist` (`therapist_id`),
  CONSTRAINT `fk_slots_therapist` FOREIGN KEY (`therapist_id`) REFERENCES `therapists` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `staff` (
  `id`               VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `firebase_uid`     VARCHAR(128) DEFAULT NULL,
  `name`             VARCHAR(255) NOT NULL,
  `email`            VARCHAR(255) NOT NULL,
  `phone`            VARCHAR(50)  NOT NULL,
  `role`             ENUM('INSTRUCTOR','TRAINER','EXPERT','SALES','MANAGER','ADMIN','SUPPORT','RECEPTION_DAQQI','COLLECTION','ACCOUNTANT','CONSULTANT','OTHER','ONLINE_MANAGER','DAQQI_MANAGER','SALES_COLLECTION_MANAGER','HR') NOT NULL,
  `image`            TEXT DEFAULT NULL,
  `specialization`   VARCHAR(255) DEFAULT NULL,
  `joined_at`        DATETIME NOT NULL,
  `is_active`        TINYINT(1) NOT NULL DEFAULT 1,
  `notes`            TEXT DEFAULT NULL,
  `commission_rate`  DECIMAL(5,2) DEFAULT NULL,
  `permissions_json` TEXT DEFAULT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_staff_email`       (`email`),
  UNIQUE KEY `idx_staff_firebase_uid`(`firebase_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── CRM Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `leads` (
  `id`                       VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `client_code`              VARCHAR(50)  DEFAULT NULL,
  `name`                     VARCHAR(255) NOT NULL,
  `email`                    VARCHAR(255) NOT NULL,
  `phone`                    VARCHAR(50)  DEFAULT NULL,
  `source`                   VARCHAR(255) NOT NULL,
  `status`                   VARCHAR(50) NOT NULL DEFAULT 'new',
  `lead_type`                ENUM('COURSE','CONSULTATION','GENERAL') NOT NULL DEFAULT 'GENERAL',
  `branch`                   ENUM('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT NULL,
  `interest_level`           ENUM('LOW','MEDIUM','HIGH') DEFAULT NULL,
  `enrolled_course_id`       VARCHAR(36)  DEFAULT NULL,
  `interested_course_ids_json` TEXT DEFAULT NULL,
  `assigned_sales_id`        VARCHAR(36)  DEFAULT NULL,
  `assigned_sales_name`      VARCHAR(255) DEFAULT NULL,
  `assigned_cs_id`           VARCHAR(36)  DEFAULT NULL,
  `assigned_cs_name`         VARCHAR(255) DEFAULT NULL,
  `notes`                    TEXT DEFAULT NULL,
  `last_follow_up`           DATETIME DEFAULT NULL,
  `last_contact_note`        TEXT DEFAULT NULL,
  `next_follow_up_date`      DATETIME DEFAULT NULL,
  `promo_code`               VARCHAR(100) DEFAULT NULL,
  `login_email`              VARCHAR(255) DEFAULT NULL,
  `fb_lead_id`               VARCHAR(255) DEFAULT NULL,
  `fb_form_id`               VARCHAR(255) DEFAULT NULL,
  `fb_form_name`             VARCHAR(255) DEFAULT NULL,
  `hidden`                   TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_leads_client_code` (`client_code`),
  UNIQUE KEY `idx_leads_fb_lead_id`  (`fb_lead_id`),
  KEY `idx_leads_status`    (`status`),
  KEY `idx_leads_email`     (`email`),
  KEY `idx_leads_created_at`(`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `subscribers` (
  `id`                   VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `firebase_uid`         VARCHAR(128) DEFAULT NULL,
  `client_code`          VARCHAR(50)  DEFAULT NULL,
  `lead_id`              VARCHAR(36)  DEFAULT NULL,
  `name`                 VARCHAR(255) NOT NULL,
  `name_en`              VARCHAR(255) DEFAULT NULL,
  `name_ar`              VARCHAR(255) DEFAULT NULL,
  `email`                VARCHAR(255) DEFAULT NULL,
  `phone`                VARCHAR(50)  DEFAULT NULL,
  `national_id`          VARCHAR(50)  DEFAULT NULL,
  `whatsapp`             VARCHAR(50)  DEFAULT NULL,
  `nationality`          ENUM('EGYPTIAN','NON_EGYPTIAN_EGYPT','SAUDI_RESIDENT','INTERNATIONAL') DEFAULT NULL,
  `branch`               ENUM('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT NULL,
  `assigned_sales_id`    VARCHAR(36)  DEFAULT NULL,
  `assigned_sales_name`  VARCHAR(255) DEFAULT NULL,
  `assigned_cs_id`       VARCHAR(36)  DEFAULT NULL,
  `assigned_cs_name`     VARCHAR(255) DEFAULT NULL,
  `discount`             DECIMAL(12,2) DEFAULT NULL,
  `is_active`            TINYINT(1) NOT NULL DEFAULT 1,
  `notes`                TEXT DEFAULT NULL,
  `course_access_json`   LONGTEXT DEFAULT NULL,
  `lecture_progress_json`LONGTEXT DEFAULT NULL,
  `expected_totals_json` TEXT DEFAULT NULL,
  `created_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_subscribers_email`       (`email`),
  UNIQUE KEY `idx_subscribers_firebase_uid`(`firebase_uid`),
  UNIQUE KEY `idx_subscribers_client_code` (`client_code`),
  KEY `idx_subscribers_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `communications` (
  `id`            VARCHAR(36) NOT NULL DEFAULT (UUID()),
  `lead_id`       VARCHAR(36) DEFAULT NULL,
  `subscriber_id` VARCHAR(36) DEFAULT NULL,
  `type`          ENUM('CALL','WHATSAPP','EMAIL','MEETING','NOTE','PAYMENT_FOLLOWUP','NEW_COURSE_SALE','CERTIFICATE') NOT NULL,
  `date`          DATETIME NOT NULL,
  `notes`         TEXT NOT NULL,
  `outcome`       TEXT DEFAULT NULL,
  `next_follow_up`DATETIME DEFAULT NULL,
  `staff_id`      VARCHAR(36) DEFAULT NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_comm_lead`       (`lead_id`),
  KEY `idx_comm_subscriber` (`subscriber_id`),
  CONSTRAINT `fk_comm_lead`       FOREIGN KEY (`lead_id`)       REFERENCES `leads`       (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_comm_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Student Tables ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `enrollments` (
  `id`               VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `subscriber_id`    VARCHAR(36)  NOT NULL,
  `course_id`        VARCHAR(36)  DEFAULT NULL,
  `bundle_id`        VARCHAR(36)  DEFAULT NULL,
  `enrolled_at`      DATETIME NOT NULL,
  `expiry_date`      DATETIME DEFAULT NULL,
  `access_type`      VARCHAR(20) NOT NULL DEFAULT 'full',
  `progress_percent` INT NOT NULL DEFAULT 0,
  `completed_at`     DATETIME DEFAULT NULL,
  `lecture_limit`    INT DEFAULT NULL,
  `attended_lectures`INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_enroll_subscriber` (`subscriber_id`),
  KEY `idx_enroll_course`     (`course_id`),
  CONSTRAINT `fk_enroll_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_enroll_course`     FOREIGN KEY (`course_id`)     REFERENCES `courses`     (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_enroll_bundle`     FOREIGN KEY (`bundle_id`)     REFERENCES `bundles`     (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `payments` (
  `id`              VARCHAR(36) NOT NULL DEFAULT (UUID()),
  `subscriber_id`   VARCHAR(36) NOT NULL,
  `course_id`       VARCHAR(36) DEFAULT NULL,
  `bundle_id`       VARCHAR(36) DEFAULT NULL,
  `amount`          DECIMAL(12,2) NOT NULL,
  `currency`        ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `payment_type`    ENUM('COURSE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER') DEFAULT NULL,
  `payment_method`  VARCHAR(50) DEFAULT NULL,
  `transaction_id`  VARCHAR(255) DEFAULT NULL,
  `is_installment`  TINYINT(1) NOT NULL DEFAULT 0,
  `course_expected` DECIMAL(12,2) DEFAULT NULL,
  `discount`        DECIMAL(12,2) DEFAULT NULL,
  `date`            DATETIME NOT NULL,
  `note`            TEXT DEFAULT NULL,
  `staff_id`        VARCHAR(36) DEFAULT NULL,
  `status`          ENUM('pending','paid','failed') NOT NULL DEFAULT 'paid',
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payments_subscriber` (`subscriber_id`),
  KEY `idx_payments_date`       (`date`),
  CONSTRAINT `fk_payments_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payments_course`     FOREIGN KEY (`course_id`)     REFERENCES `courses`     (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payments_bundle`     FOREIGN KEY (`bundle_id`)     REFERENCES `bundles`     (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `certificate_requests` (
  `id`          VARCHAR(36) NOT NULL DEFAULT (UUID()),
  `subscriber_id`VARCHAR(36) DEFAULT NULL,
  `course_id`   VARCHAR(36) DEFAULT NULL,
  `type`        ENUM('SOCIAL_SOLIDARITY','AIN_SHAMS','EXPERIENCE_EXTERNAL','PRACTICE_EXTERNAL','NATIONAL_COUNCIL','AMERICAN_BOARD','INSTITUTE','OTHER') NOT NULL,
  `custom_name` VARCHAR(255) DEFAULT NULL,
  `name_ar`     VARCHAR(255) DEFAULT NULL,
  `name_en`     VARCHAR(255) DEFAULT NULL,
  `nationality` ENUM('EGYPTIAN','NON_EGYPTIAN_EGYPT','SAUDI_RESIDENT','INTERNATIONAL') DEFAULT NULL,
  `id_number`   VARCHAR(50) DEFAULT NULL,
  `status`      ENUM('PENDING','PRICED','PAID','IN_PROGRESS','NOT_SENT','ISSUED','AT_BRANCH','DELIVERED') NOT NULL DEFAULT 'PENDING',
  `price`       DECIMAL(12,2) DEFAULT NULL,
  `paid_amount` DECIMAL(12,2) DEFAULT NULL,
  `currency`    ENUM('EGP','SAR','USD') DEFAULT NULL,
  `note`        TEXT DEFAULT NULL,
  `admin_note`  TEXT DEFAULT NULL,
  `requested_at`DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `issued_at`   DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cert_subscriber` (`subscriber_id`),
  CONSTRAINT `fk_cert_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cert_course`     FOREIGN KEY (`course_id`)     REFERENCES `courses`     (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Operations Tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `consultations` (
  `id`                      VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `client_name`             VARCHAR(255) NOT NULL,
  `client_email`            VARCHAR(255) DEFAULT NULL,
  `client_phone`            VARCHAR(50)  DEFAULT NULL,
  `therapist_id`            VARCHAR(36)  NOT NULL,
  `session_type`            ENUM('INDIVIDUAL','COUPLE','FAMILY') NOT NULL DEFAULT 'INDIVIDUAL',
  `session_date`            DATETIME NOT NULL,
  `slot_id`                 VARCHAR(36) DEFAULT NULL,
  `timezone`                VARCHAR(100) DEFAULT NULL,
  `status`                  ENUM('PENDING','CONFIRMED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `notes`                   TEXT NOT NULL DEFAULT '',
  `amount`                  DECIMAL(12,2) DEFAULT NULL,
  `currency`                ENUM('EGP','SAR','USD') DEFAULT NULL,
  `session_duration_minutes`INT DEFAULT NULL,
  `meeting_link`            TEXT DEFAULT NULL,
  `subscriber_id`           VARCHAR(36) DEFAULT NULL,
  `assigned_staff_id`       VARCHAR(36) DEFAULT NULL,
  `created_at`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_consult_therapist`   (`therapist_id`),
  KEY `idx_consult_email`       (`client_email`),
  KEY `idx_consult_session_date`(`session_date`),
  CONSTRAINT `fk_consult_therapist`   FOREIGN KEY (`therapist_id`)  REFERENCES `therapists`  (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_consult_subscriber`  FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `orders` (
  `id`             VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `type`           ENUM('COURSE','BUNDLE','CONSULTATION') NOT NULL,
  `item_id`        VARCHAR(36)  NOT NULL,
  `item_title`     VARCHAR(500) NOT NULL,
  `amount`         DECIMAL(12,2) NOT NULL,
  `currency`       ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `payment_method` VARCHAR(50) NOT NULL DEFAULT 'CARD',
  `customer_name`  VARCHAR(255) NOT NULL,
  `customer_email` VARCHAR(255) DEFAULT NULL,
  `customer_phone` VARCHAR(50)  DEFAULT NULL,
  `status`         ENUM('PAID','FAILED','REFUNDED','PENDING') NOT NULL DEFAULT 'PENDING',
  `transaction_id` VARCHAR(255) DEFAULT NULL,
  `coupon_code`    VARCHAR(100) DEFAULT NULL,
  `subscriber_id`  VARCHAR(36)  DEFAULT NULL,
  `course_id`      VARCHAR(36)  DEFAULT NULL,
  `bundle_id`      VARCHAR(36)  DEFAULT NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at`        DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_orders_status`     (`status`),
  KEY `idx_orders_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `expenses` (
  `id`          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `description` TEXT NOT NULL,
  `amount`      DECIMAL(12,2) NOT NULL,
  `currency`    ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `category`    ENUM('SALARIES','RENT','UTILITIES','SOFTWARE','MARKETING','EQUIPMENT','MAINTENANCE','TRAVEL','OTHER') NOT NULL DEFAULT 'OTHER',
  `date`        DATETIME NOT NULL,
  `receipt_url` TEXT DEFAULT NULL,
  `note`        TEXT DEFAULT NULL,
  `staff_id`    VARCHAR(36) DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_expenses_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `daqqi_rounds` (
  `id`                   VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `code`                 VARCHAR(50)  NOT NULL,
  `course_id`            VARCHAR(36)  NOT NULL,
  `instructor_id`        VARCHAR(36)  NOT NULL,
  `instructor_name`      VARCHAR(255) NOT NULL,
  `reception_id`         VARCHAR(36)  NOT NULL,
  `reception_name`       VARCHAR(255) NOT NULL,
  `day_of_week`          VARCHAR(20)  NOT NULL,
  `start_date`           DATETIME NOT NULL,
  `time_slot`            ENUM('MORNING','NOON','EVENING') NOT NULL,
  `status`               ENUM('NEW','ACTIVE','FINISHED') NOT NULL DEFAULT 'NEW',
  `current_lecture`      INT NOT NULL DEFAULT 0,
  `postponed_weeks_json` TEXT DEFAULT NULL,
  `created_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_daqqi_code` (`code`),
  CONSTRAINT `fk_daqqi_course`      FOREIGN KEY (`course_id`)     REFERENCES `courses`     (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_daqqi_reception`   FOREIGN KEY (`reception_id`)  REFERENCES `staff`       (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `daqqi_attendees` (
  `round_id`          VARCHAR(36)  NOT NULL,
  `subscriber_id`     VARCHAR(36)  NOT NULL,
  `name`              VARCHAR(255) NOT NULL,
  `phone`             VARCHAR(50)  NOT NULL,
  `booked_at`         DATETIME NOT NULL,
  `amount_paid`       DECIMAL(12,2) NOT NULL DEFAULT 0,
  `attended_lectures` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`round_id`, `subscriber_id`),
  CONSTRAINT `fk_att_round`       FOREIGN KEY (`round_id`)      REFERENCES `daqqi_rounds` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_att_subscriber`  FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers`  (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Engagement Tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `discount_rules` (
  `id`               VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `type`             ENUM('COURSE','BUNDLE','ALL_COURSES','THERAPIST_CONSULTATION','ALL_CONSULTATIONS') NOT NULL,
  `target_id`        VARCHAR(36)  DEFAULT NULL,
  `discount_percent` DECIMAL(5,2) NOT NULL,
  `label`            VARCHAR(255) DEFAULT NULL,
  `promo_code`       VARCHAR(100) DEFAULT NULL,
  `is_active`        TINYINT(1) NOT NULL DEFAULT 1,
  `expires_at`       DATETIME DEFAULT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_discounts_promo_code` (`promo_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `join_us_applications` (
  `id`          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `name`        VARCHAR(255) NOT NULL,
  `email`       VARCHAR(255) NOT NULL,
  `phone`       VARCHAR(50)  NOT NULL,
  `specialty`   VARCHAR(255) NOT NULL,
  `experience`  TEXT NOT NULL,
  `type`        ENUM('INSTRUCTOR','CONSULTANT') NOT NULL,
  `linkedin`    TEXT DEFAULT NULL,
  `message`     TEXT DEFAULT NULL,
  `status`      ENUM('NEW','REVIEWED','ACCEPTED','REJECTED') NOT NULL DEFAULT 'NEW',
  `admin_note`  TEXT DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `contact_messages` (
  `id`         VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `name`       VARCHAR(255) NOT NULL,
  `email`      VARCHAR(255) DEFAULT NULL,
  `phone`      VARCHAR(50)  NOT NULL,
  `subject`    VARCHAR(500) DEFAULT NULL,
  `message`    TEXT NOT NULL,
  `status`     ENUM('NEW','READ','REPLIED') NOT NULL DEFAULT 'NEW',
  `admin_note` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id`        VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `action`    VARCHAR(50)  NOT NULL,
  `entity`    VARCHAR(100) NOT NULL,
  `entity_id` VARCHAR(36)  DEFAULT NULL,
  `label`     TEXT NOT NULL,
  `actor`     VARCHAR(255) DEFAULT NULL,
  `at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_logs_at`     (`at`),
  KEY `idx_logs_entity` (`entity`, `entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Quiz Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `course_quizzes` (
  `id`               VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `course_id`        VARCHAR(36)  NOT NULL,
  `title`            VARCHAR(500) NOT NULL,
  `questions_json`   LONGTEXT NOT NULL,
  `passing_score`    DOUBLE NOT NULL DEFAULT 70,
  `generated_by_ai`  TINYINT(1) NOT NULL DEFAULT 0,
  `source_material`  TEXT DEFAULT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_quizzes_course` (`course_id`),
  CONSTRAINT `fk_quizzes_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `quiz_attempts` (
  `id`            VARCHAR(36) NOT NULL DEFAULT (UUID()),
  `subscriber_id` VARCHAR(36) NOT NULL,
  `course_id`     VARCHAR(36) NOT NULL,
  `quiz_id`       VARCHAR(36) NOT NULL,
  `answers_json`  TEXT NOT NULL,
  `score`         DOUBLE NOT NULL,
  `passed`        TINYINT(1) NOT NULL,
  `taken_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_qa_subscriber` (`subscriber_id`),
  KEY `idx_qa_quiz`       (`quiz_id`),
  CONSTRAINT `fk_qa_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers`    (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qa_course`     FOREIGN KEY (`course_id`)     REFERENCES `courses`        (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qa_quiz`       FOREIGN KEY (`quiz_id`)       REFERENCES `course_quizzes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Live Streams & Automation ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `live_streams` (
  `id`                   VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `title`                VARCHAR(500) NOT NULL,
  `instructor_id`        VARCHAR(36)  DEFAULT NULL,
  `instructor_name`      VARCHAR(255) NOT NULL,
  `scheduled_at`         DATETIME NOT NULL,
  `duration_minutes`     INT DEFAULT NULL,
  `stream_url`           TEXT NOT NULL,
  `platform`             ENUM('ZOOM','YOUTUBE','MEET','OTHER') DEFAULT NULL,
  `visibility`           ENUM('ALL_SUBSCRIBERS','COURSE_SUBSCRIBERS','COMMUNITY_ALL','COMMUNITY_AND_SUBSCRIBERS') NOT NULL DEFAULT 'ALL_SUBSCRIBERS',
  `target_course_ids_json` TEXT DEFAULT NULL,
  `status`               ENUM('UPCOMING','LIVE','ENDED') NOT NULL DEFAULT 'UPCOMING',
  `recording_url`        TEXT DEFAULT NULL,
  `description`          TEXT DEFAULT NULL,
  `created_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_streams_scheduled` (`scheduled_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `automation_workflows` (
  `id`                VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `name`              VARCHAR(500) NOT NULL,
  `description`       TEXT DEFAULT NULL,
  `trigger`           VARCHAR(100) NOT NULL,
  `conditions_json`   TEXT DEFAULT NULL,
  `action`            VARCHAR(100) NOT NULL,
  `action_config_json`TEXT DEFAULT NULL,
  `enabled`           TINYINT(1) NOT NULL DEFAULT 1,
  `trigger_count`     INT NOT NULL DEFAULT 0,
  `last_triggered_at` DATETIME DEFAULT NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `issued_certificates` (
  `id`                 VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `subscriber_id`      VARCHAR(36)  NOT NULL,
  `course_id`          VARCHAR(36)  NOT NULL,
  `certificate_number` VARCHAR(100) NOT NULL,
  `issued_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `note`               TEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_issued_cert_number` (`certificate_number`),
  KEY `idx_issued_cert_subscriber` (`subscriber_id`),
  KEY `idx_issued_cert_course`     (`course_id`),
  CONSTRAINT `fk_issued_cert_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_issued_cert_course`     FOREIGN KEY (`course_id`)     REFERENCES `courses`     (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `notification_broadcasts` (
  `id`         VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `title`      VARCHAR(500) NOT NULL,
  `body`       TEXT NOT NULL,
  `type`       VARCHAR(20)  NOT NULL DEFAULT 'info',
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_active` (`is_active`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Payment Proofs — client-submitted transfer / instapay receipts ────────────

CREATE TABLE IF NOT EXISTS `payment_proofs` (
  `id`             VARCHAR(100)  NOT NULL,
  `subscriber_id`  VARCHAR(100)  NOT NULL,
  `course_id`      VARCHAR(100)  DEFAULT NULL,
  `amount`         DECIMAL(12,2)        NOT NULL,
  `currency`       ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `payment_method` VARCHAR(50)   NOT NULL DEFAULT 'instapay',
  `proof_image`    MEDIUMTEXT    DEFAULT NULL,
  `note`           TEXT          DEFAULT NULL,
  `status`         ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `reviewer_id`    VARCHAR(100)  DEFAULT NULL,
  `reviewer_note`  TEXT          DEFAULT NULL,
  `submitted_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at`    DATETIME      DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pp_subscriber` (`subscriber_id`),
  KEY `idx_pp_status` (`status`),
  CONSTRAINT `fk_pp_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ══════════════════════════════════════════════════════════════
-- IMPORTANT: This file contains the CORE tables only.
-- The full schema requires running ALL files in migrations/ in
-- numeric order (001 → 008+). In particular:
--   007_consolidated_runtime_schema.sql — ~55 additional tables
--     (HR, payroll, tickets, promo codes, journal, ...)
--   008_money_decimal_and_payroll_fix.sql — exact money columns
-- New schema changes MUST be added as numbered migration files,
-- NOT in api/lib/startupTasks.js.
-- ══════════════════════════════════════════════════════════════
