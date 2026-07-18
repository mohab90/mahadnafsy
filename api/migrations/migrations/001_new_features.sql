-- ══════════════════════════════════════════════════════════════
-- Migration 001 — New Features
-- Run: mysql -u USER -p DB < migrations/001_new_features.sql
-- ══════════════════════════════════════════════════════════════
SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ── 1. ALTER: courses — SEO + preview + drip ─────────────────────────────────
ALTER TABLE `courses`
  ADD COLUMN IF NOT EXISTS `seo_title`        VARCHAR(255) DEFAULT NULL AFTER `sort_order`,
  ADD COLUMN IF NOT EXISTS `seo_description`  VARCHAR(500) DEFAULT NULL AFTER `seo_title`,
  ADD COLUMN IF NOT EXISTS `seo_keywords`     VARCHAR(500) DEFAULT NULL AFTER `seo_description`,
  ADD COLUMN IF NOT EXISTS `preview_video_url` TEXT DEFAULT NULL AFTER `seo_keywords`,
  ADD COLUMN IF NOT EXISTS `drip_days`        INT DEFAULT NULL AFTER `preview_video_url`;

-- ── 2. ALTER: bundles — SEO ──────────────────────────────────────────────────
ALTER TABLE `bundles`
  ADD COLUMN IF NOT EXISTS `seo_title`        VARCHAR(255) DEFAULT NULL AFTER `sort_order`,
  ADD COLUMN IF NOT EXISTS `seo_description`  VARCHAR(500) DEFAULT NULL AFTER `seo_title`,
  ADD COLUMN IF NOT EXISTS `seo_keywords`     VARCHAR(500) DEFAULT NULL AFTER `seo_description`;

-- ── 3. ALTER: course_lectures — HLS + preview + seconds ──────────────────────
ALTER TABLE `course_lectures`
  ADD COLUMN IF NOT EXISTS `hls_url`           TEXT DEFAULT NULL AFTER `video_url`,
  ADD COLUMN IF NOT EXISTS `duration_seconds`  INT DEFAULT NULL AFTER `duration`,
  ADD COLUMN IF NOT EXISTS `is_preview`        TINYINT(1) NOT NULL DEFAULT 0 AFTER `duration_seconds`;

-- ── 4. ALTER: leads — score + retargeting ────────────────────────────────────
ALTER TABLE `leads`
  ADD COLUMN IF NOT EXISTS `lead_score`           SMALLINT DEFAULT 0 AFTER `interest_level`,
  ADD COLUMN IF NOT EXISTS `retargeting_sent_at`  DATETIME DEFAULT NULL AFTER `next_follow_up_date`;

-- ── 5. ALTER: staff — 2FA ────────────────────────────────────────────────────
ALTER TABLE `staff`
  ADD COLUMN IF NOT EXISTS `totp_secret`   VARCHAR(64) DEFAULT NULL AFTER `permissions_json`,
  ADD COLUMN IF NOT EXISTS `totp_enabled`  TINYINT(1) NOT NULL DEFAULT 0 AFTER `totp_secret`;

-- ── 6. NEW TABLE: lecture_progress ───────────────────────────────────────────
-- NOTE: backend uses 'lecture_completions' name — create both for compatibility
CREATE TABLE IF NOT EXISTS `lecture_completions` (
  `id`              VARCHAR(36) NOT NULL DEFAULT (UUID()),
  `subscriber_id`   VARCHAR(36) NOT NULL,
  `lecture_id`      VARCHAR(36) NOT NULL,
  `course_id`       VARCHAR(36) DEFAULT NULL,
  `progress_pct`    DOUBLE NOT NULL DEFAULT 0,
  `watch_seconds`   INT NOT NULL DEFAULT 0,
  `completed_at`    DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_completion` (`subscriber_id`, `lecture_id`),
  KEY `idx_comp_sub`    (`subscriber_id`),
  KEY `idx_comp_course` (`subscriber_id`, `course_id`),
  CONSTRAINT `fk_comp_sub` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6b. NEW TABLE: course_completions (certificates) ─────────────────────────
CREATE TABLE IF NOT EXISTS `course_completions` (
  `id`               VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `subscriber_id`    VARCHAR(36)  NOT NULL,
  `course_id`        VARCHAR(36)  NOT NULL,
  `certificate_code` VARCHAR(50)  NOT NULL,
  `completed_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_comp` (`subscriber_id`, `course_id`),
  UNIQUE KEY `uq_cert_code`   (`certificate_code`),
  KEY `idx_coursecomp_sub` (`subscriber_id`),
  CONSTRAINT `fk_coursecomp_sub` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_coursecomp_crs` FOREIGN KEY (`course_id`)     REFERENCES `courses`     (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 7. NEW TABLE: leave_requests ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `leave_requests` (
  `id`          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `staff_id`    VARCHAR(36)  NOT NULL,
  `type`        ENUM('ANNUAL','SICK','EMERGENCY','UNPAID','OTHER') NOT NULL DEFAULT 'ANNUAL',
  `start_date`  DATE NOT NULL,
  `end_date`    DATE NOT NULL,
  `days`        SMALLINT NOT NULL DEFAULT 1,
  `reason`      TEXT DEFAULT NULL,
  `status`      ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `approved_by` VARCHAR(36) DEFAULT NULL,
  `admin_note`  TEXT DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_leave_staff`  (`staff_id`),
  KEY `idx_leave_dates`  (`start_date`, `end_date`),
  KEY `idx_leave_status` (`status`),
  CONSTRAINT `fk_leave_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 8. NEW TABLE: staff_kpis ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `staff_kpis` (
  `id`          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `staff_id`    VARCHAR(36)  NOT NULL,
  `period`      VARCHAR(7)   NOT NULL COMMENT 'YYYY-MM',
  `metric`      VARCHAR(100) NOT NULL COMMENT 'e.g. leads_converted, calls_made, nps_score',
  `value`       DOUBLE NOT NULL DEFAULT 0,
  `target`      DOUBLE DEFAULT NULL,
  `note`        TEXT DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kpi` (`staff_id`, `period`, `metric`),
  KEY `idx_kpi_staff`  (`staff_id`),
  KEY `idx_kpi_period` (`period`),
  CONSTRAINT `fk_kpi_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 9. NEW TABLE: backup_logs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `backup_logs` (
  `id`          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `filename`    VARCHAR(255) NOT NULL,
  `size_bytes`  BIGINT DEFAULT NULL,
  `status`      ENUM('SUCCESS','FAILED') NOT NULL DEFAULT 'SUCCESS',
  `error`       TEXT DEFAULT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_backup_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 10. NEW TABLE: support_tickets ───────────────────────────────────────────
-- (Replaces/extends communications for formal ticket tracking with SLA)
CREATE TABLE IF NOT EXISTS `support_tickets` (
  `id`               VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `ticket_code`      VARCHAR(20)  DEFAULT NULL,
  `subscriber_id`    VARCHAR(36)  DEFAULT NULL,
  `lead_id`          VARCHAR(36)  DEFAULT NULL,
  `subject`          VARCHAR(500) NOT NULL,
  `description`      TEXT NOT NULL,
  `channel`          ENUM('WHATSAPP','EMAIL','PHONE','PORTAL','OTHER') NOT NULL DEFAULT 'OTHER',
  `priority`         ENUM('LOW','MEDIUM','HIGH','URGENT') NOT NULL DEFAULT 'MEDIUM',
  `status`           ENUM('OPEN','IN_PROGRESS','WAITING_CLIENT','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  `assigned_to_id`   VARCHAR(36)  DEFAULT NULL,
  `assigned_to_name` VARCHAR(255) DEFAULT NULL,
  `sla_due_at`       DATETIME DEFAULT NULL,
  `first_response_at`DATETIME DEFAULT NULL,
  `resolved_at`      DATETIME DEFAULT NULL,
  `resolution_note`  TEXT DEFAULT NULL,
  `tags_json`        TEXT DEFAULT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_code` (`ticket_code`),
  KEY `idx_ticket_status`   (`status`),
  KEY `idx_ticket_sla`      (`sla_due_at`),
  KEY `idx_ticket_assignee` (`assigned_to_id`),
  CONSTRAINT `fk_ticket_sub`  FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ticket_lead` FOREIGN KEY (`lead_id`)       REFERENCES `leads`       (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 11. NEW TABLE: ticket_replies ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ticket_replies` (
  `id`          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `ticket_id`   VARCHAR(36)  NOT NULL,
  `author_id`   VARCHAR(36)  DEFAULT NULL,
  `author_name` VARCHAR(255) NOT NULL,
  `author_type` ENUM('STAFF','CLIENT') NOT NULL DEFAULT 'STAFF',
  `body`        TEXT NOT NULL,
  `is_internal` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_replies_ticket` (`ticket_id`),
  CONSTRAINT `fk_reply_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 12. NEW TABLE: retargeting_log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `retargeting_log` (
  `id`          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  `lead_id`     VARCHAR(36)  NOT NULL,
  `channel`     ENUM('WHATSAPP','EMAIL') NOT NULL,
  `template`    VARCHAR(100) NOT NULL,
  `status`      ENUM('SENT','FAILED') NOT NULL DEFAULT 'SENT',
  `error`       TEXT DEFAULT NULL,
  `sent_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_retarget_lead` (`lead_id`),
  CONSTRAINT `fk_retarget_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 13. NEW TABLE: sla_rules ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sla_rules` (
  `id`                   VARCHAR(36) NOT NULL DEFAULT (UUID()),
  `priority`             ENUM('LOW','MEDIUM','HIGH','URGENT') NOT NULL,
  `first_response_hours` SMALLINT NOT NULL DEFAULT 24,
  `resolution_hours`     SMALLINT NOT NULL DEFAULT 72,
  `is_active`            TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sla_priority` (`priority`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default SLA rules
INSERT IGNORE INTO `sla_rules` (`priority`, `first_response_hours`, `resolution_hours`) VALUES
  ('LOW',    48, 120),
  ('MEDIUM', 24,  72),
  ('HIGH',    4,  24),
  ('URGENT',  1,   8);

-- ── 14. ALTER: enrollments — certificate_issued ──────────────────────────────
ALTER TABLE `enrollments`
  ADD COLUMN IF NOT EXISTS `certificate_issued`    TINYINT(1) NOT NULL DEFAULT 0 AFTER `completed_at`,
  ADD COLUMN IF NOT EXISTS `certificate_issued_at` DATETIME DEFAULT NULL AFTER `certificate_issued`;

SET FOREIGN_KEY_CHECKS = 1;
