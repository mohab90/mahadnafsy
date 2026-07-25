-- =============================================================================
-- Mahad Nafsy — Reference schema (structure only, no data)
-- Regenerated 2026-07-18 from the LIVE production database via
-- mysqldump --no-data (authoritative). The previous file had irrecoverable
-- mojibake and had drifted from reality. This file is reference-only:
-- the runtime schema source of truth is api/migrations/*.sql (numbered).
-- =============================================================================

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `accounting_periods` (
  `id` varchar(36) NOT NULL,
  `period_label` varchar(20) NOT NULL,
  `opened_at` datetime DEFAULT current_timestamp(),
  `closed_at` datetime DEFAULT NULL,
  `closed_by` varchar(100) DEFAULT NULL,
  `summary_json` text DEFAULT NULL,
  `status` enum('open','closed') DEFAULT 'open',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_logs` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `action` varchar(50) NOT NULL,
  `entity` varchar(100) NOT NULL,
  `entity_id` varchar(36) DEFAULT NULL,
  `label` text NOT NULL,
  `actor` varchar(255) DEFAULT NULL,
  `at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_logs_at` (`at`),
  KEY `idx_logs_entity` (`entity`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` varchar(50) NOT NULL COMMENT 'alert|info|warning|success',
  `title` varchar(255) NOT NULL,
  `message` text DEFAULT NULL,
  `link` varchar(512) DEFAULT NULL,
  `is_read` tinyint(4) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_read` (`is_read`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_import_batches` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `filename` varchar(255) NOT NULL,
  `month` tinyint(3) unsigned NOT NULL,
  `year` smallint(5) unsigned NOT NULL,
  `branch` enum('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT NULL,
  `rows_total` int(11) NOT NULL DEFAULT 0,
  `rows_ok` int(11) NOT NULL DEFAULT 0,
  `rows_error` int(11) NOT NULL DEFAULT 0,
  `errors_json` longtext DEFAULT NULL CHECK (json_valid(`errors_json`)),
  `imported_by` varchar(36) DEFAULT NULL,
  `imported_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `attendance_logs` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `branch` enum('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT NULL,
  `date` date NOT NULL,
  `check_in` time DEFAULT NULL,
  `check_out` time DEFAULT NULL,
  `total_hours` decimal(5,2) DEFAULT NULL,
  `late_minutes` int(11) NOT NULL DEFAULT 0,
  `status` enum('PRESENT','ABSENT','LATE','HALF_DAY','LEAVE','HOLIDAY','REMOTE') NOT NULL DEFAULT 'PRESENT',
  `notes` text DEFAULT NULL,
  `source` enum('FINGERPRINT_IMPORT','MANUAL_ENTRY','APP') NOT NULL DEFAULT 'FINGERPRINT_IMPORT',
  `import_batch_id` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_attendance` (`staff_id`,`date`),
  KEY `idx_att_staff` (`staff_id`),
  KEY `idx_att_date` (`date`),
  KEY `idx_att_staff_date` (`staff_id`,`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `actor_id` varchar(100) DEFAULT NULL,
  `actor_role` varchar(80) DEFAULT NULL,
  `action` varchar(160) NOT NULL,
  `entity_type` varchar(120) DEFAULT NULL,
  `entity_id` varchar(120) DEFAULT NULL,
  `severity` enum('info','warning','critical') NOT NULL DEFAULT 'info',
  `metadata_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata_json`)),
  `ip_address` varchar(80) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_audit_logs_entity` (`entity_type`,`entity_id`),
  KEY `idx_audit_logs_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `automation_log` (
  `id` varchar(100) NOT NULL,
  `workflow_id` varchar(100) DEFAULT NULL,
  `lead_id` varchar(100) DEFAULT NULL,
  `subscriber_id` varchar(100) DEFAULT NULL,
  `action` varchar(100) DEFAULT NULL,
  `triggered_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_al_wf` (`workflow_id`),
  KEY `idx_al_lead` (`lead_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `automation_workflows` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(500) NOT NULL,
  `description` text DEFAULT NULL,
  `trigger` varchar(100) NOT NULL,
  `conditions_json` text DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `action_config_json` text DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `trigger_count` int(11) NOT NULL DEFAULT 0,
  `last_triggered_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `backup_logs` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `filename` varchar(255) NOT NULL,
  `size_bytes` bigint(20) DEFAULT NULL,
  `status` enum('SUCCESS','FAILED') NOT NULL DEFAULT 'SUCCESS',
  `error` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_backup_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `branches` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `branch_key` varchar(120) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `label` varchar(255) NOT NULL,
  `branch_type` enum('online','physical','hybrid','other') NOT NULL DEFAULT 'other',
  `timezone` varchar(80) NOT NULL DEFAULT 'Africa/Cairo',
  `currency` varchar(10) NOT NULL DEFAULT 'EGP',
  `modules_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`modules_json`)),
  `tabs_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`tabs_json`)),
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_branches_tenant_slug` (`tenant_id`,`slug`),
  UNIQUE KEY `uq_branches_tenant_key` (`tenant_id`,`branch_key`),
  KEY `idx_branches_tenant_active` (`tenant_id`,`is_active`),
  CONSTRAINT `fk_branches_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `budgets` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `month` char(7) NOT NULL COMMENT 'YYYY-MM',
  `category` varchar(255) NOT NULL,
  `budgeted_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `currency` char(3) NOT NULL DEFAULT 'EGP',
  `notes` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_budget` (`month`,`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `bundle_courses` (
  `bundle_id` varchar(36) NOT NULL,
  `course_id` varchar(36) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`bundle_id`,`course_id`),
  KEY `fk_bc_course` (`course_id`),
  CONSTRAINT `fk_bc_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bc_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `bundles` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `title` varchar(500) NOT NULL,
  `title_en` varchar(500) DEFAULT NULL,
  `slug` varchar(255) DEFAULT NULL,
  `video_url` text DEFAULT NULL,
  `short_description` text DEFAULT NULL,
  `description` text NOT NULL,
  `price_egp` decimal(12,2) NOT NULL DEFAULT 0.00,
  `price_sar` decimal(12,2) NOT NULL DEFAULT 0.00,
  `price_usd` decimal(12,2) NOT NULL DEFAULT 0.00,
  `orig_price_egp` decimal(12,2) NOT NULL DEFAULT 0.00,
  `orig_price_sar` decimal(12,2) NOT NULL DEFAULT 0.00,
  `orig_price_usd` decimal(12,2) NOT NULL DEFAULT 0.00,
  `is_published` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `seo_title` varchar(255) DEFAULT NULL,
  `seo_description` varchar(500) DEFAULT NULL,
  `seo_keywords` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_bundles_slug` (`slug`),
  KEY `idx_bundles_tenant` (`tenant_id`),
  KEY `idx_bundles_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `canned_responses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `body` text NOT NULL,
  `category` varchar(100) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `certificate_requests` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `subscriber_id` varchar(36) DEFAULT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `type` enum('SOCIAL_SOLIDARITY','AIN_SHAMS','EXPERIENCE_EXTERNAL','PRACTICE_EXTERNAL','NATIONAL_COUNCIL','AMERICAN_BOARD','INSTITUTE','OTHER') NOT NULL,
  `custom_name` varchar(255) DEFAULT NULL,
  `name_ar` varchar(255) DEFAULT NULL,
  `name_en` varchar(255) DEFAULT NULL,
  `nationality` enum('EGYPTIAN','NON_EGYPTIAN_EGYPT','SAUDI_RESIDENT','INTERNATIONAL') DEFAULT NULL,
  `id_number` varchar(50) DEFAULT NULL,
  `status` enum('PENDING','PRICED','PAID','IN_PROGRESS','NOT_SENT','ISSUED','AT_BRANCH','DELIVERED') NOT NULL DEFAULT 'PENDING',
  `price` decimal(12,2) DEFAULT NULL,
  `paid_amount` decimal(12,2) DEFAULT NULL,
  `currency` enum('EGP','SAR','USD') DEFAULT NULL,
  `note` text DEFAULT NULL,
  `admin_note` text DEFAULT NULL,
  `requested_at` datetime NOT NULL DEFAULT current_timestamp(),
  `issued_at` datetime DEFAULT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  PRIMARY KEY (`id`),
  KEY `idx_cert_subscriber` (`subscriber_id`),
  KEY `fk_cert_course` (`course_id`),
  KEY `idx_cert_req_tenant` (`tenant_id`),
  CONSTRAINT `fk_cert_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cert_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chart_of_accounts` (
  `code` varchar(32) NOT NULL,
  `name` varchar(255) NOT NULL,
  `type` enum('asset','liability','equity','revenue','expense') NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `checkout_reminders` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `order_id` varchar(100) NOT NULL,
  `customer_phone` varchar(50) DEFAULT NULL,
  `customer_email` varchar(255) DEFAULT NULL,
  `channel` varchar(30) NOT NULL DEFAULT 'whatsapp',
  `status` enum('sent','skipped','failed') NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `sent_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_checkout_reminder_order_channel` (`order_id`,`channel`),
  KEY `idx_checkout_reminders_status` (`status`),
  KEY `idx_checkout_reminders_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `classroom_bookings` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `classroom_id` varchar(36) NOT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `staff_id` varchar(36) DEFAULT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `purpose` varchar(255) DEFAULT NULL,
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_classroom_bookings_room_time` (`classroom_id`,`start_time`,`end_time`),
  KEY `idx_classroom_bookings_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `client_code_counter` (
  `id` int(11) NOT NULL DEFAULT 1,
  `next_value` int(11) DEFAULT 10001,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `commission_rules` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(255) NOT NULL,
  `staff_id` varchar(36) DEFAULT NULL,
  `apply_to_roles` longtext DEFAULT NULL CHECK (json_valid(`apply_to_roles`)),
  `calc_type` enum('PERCENTAGE','FIXED_PER_SALE','TIERED','TARGET_BONUS') NOT NULL DEFAULT 'PERCENTAGE',
  `percentage_value` decimal(5,2) DEFAULT NULL,
  `tiers_json` longtext DEFAULT NULL CHECK (json_valid(`tiers_json`)),
  `target_amount` decimal(10,2) DEFAULT NULL,
  `bonus_value` decimal(10,2) DEFAULT NULL,
  `bonus_type` enum('FIXED','PERCENTAGE') DEFAULT NULL,
  `applies_to` enum('PAYMENT','COURSE_ONLY','CONSULTATION_ONLY','ENROLLMENT') NOT NULL DEFAULT 'PAYMENT',
  `min_payment` decimal(10,2) DEFAULT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `priority` int(11) NOT NULL DEFAULT 1,
  `stackable` tinyint(1) NOT NULL DEFAULT 0,
  `effective_from` date NOT NULL DEFAULT curdate(),
  `effective_to` date DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_crules_staff` (`staff_id`),
  KEY `idx_crules_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `communications` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `lead_id` varchar(36) DEFAULT NULL,
  `subscriber_id` varchar(36) DEFAULT NULL,
  `type` enum('CALL','WHATSAPP','EMAIL','MEETING','NOTE','PAYMENT_FOLLOWUP','NEW_COURSE_SALE','CERTIFICATE') NOT NULL,
  `date` datetime NOT NULL,
  `notes` text NOT NULL,
  `outcome` text DEFAULT NULL,
  `next_follow_up` datetime DEFAULT NULL,
  `staff_id` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_comm_lead` (`lead_id`),
  KEY `idx_comm_subscriber` (`subscriber_id`),
  CONSTRAINT `fk_comm_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_comm_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `community_events` (
  `id` varchar(100) NOT NULL,
  `title` varchar(500) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `image_url` text DEFAULT NULL,
  `event_date` varchar(100) DEFAULT NULL,
  `date_label` varchar(200) DEFAULT NULL,
  `location_name` varchar(300) DEFAULT NULL,
  `registration_url` text DEFAULT NULL,
  `is_online` tinyint(1) DEFAULT 0,
  `tags` text DEFAULT NULL,
  `created_at` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `community_library` (
  `id` varchar(100) NOT NULL,
  `title` varchar(500) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `file_url` text DEFAULT NULL,
  `thumbnail` text DEFAULT NULL,
  `file_type` varchar(50) DEFAULT NULL,
  `tags` text DEFAULT NULL,
  `created_at` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `community_posts` (
  `id` varchar(100) NOT NULL,
  `title` varchar(500) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `body` longtext DEFAULT NULL,
  `author` varchar(200) DEFAULT NULL,
  `image_url` text DEFAULT NULL,
  `tags` text DEFAULT NULL,
  `featured` tinyint(1) DEFAULT 0,
  `pinned` tinyint(1) DEFAULT 0,
  `likes` int(11) DEFAULT 0,
  `created_at` varchar(50) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'approved',
  `author_role` varchar(80) DEFAULT NULL,
  `subscriber_id` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `community_videos` (
  `id` varchar(100) NOT NULL,
  `title` varchar(500) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `video_url` text DEFAULT NULL,
  `thumbnail` text DEFAULT NULL,
  `duration` varchar(50) DEFAULT NULL,
  `tags` text DEFAULT NULL,
  `created_at` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `consultations` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `client_name` varchar(255) NOT NULL,
  `client_email` varchar(255) DEFAULT NULL,
  `client_phone` varchar(50) DEFAULT NULL,
  `therapist_id` varchar(36) NOT NULL,
  `session_type` enum('INDIVIDUAL','COUPLE','FAMILY') NOT NULL DEFAULT 'INDIVIDUAL',
  `session_date` datetime NOT NULL,
  `slot_id` varchar(36) DEFAULT NULL,
  `timezone` varchar(100) DEFAULT NULL,
  `status` enum('PENDING','CONFIRMED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `notes` text NOT NULL DEFAULT '',
  `amount` decimal(12,2) DEFAULT NULL,
  `currency` enum('EGP','SAR','USD') DEFAULT NULL,
  `session_duration_minutes` int(11) DEFAULT NULL,
  `meeting_link` text DEFAULT NULL,
  `subscriber_id` varchar(36) DEFAULT NULL,
  `assigned_staff_id` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `branch_id` varchar(36) NOT NULL DEFAULT 'branch-other',
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_consult_therapist` (`therapist_id`),
  KEY `idx_consult_email` (`client_email`),
  KEY `idx_consult_session_date` (`session_date`),
  KEY `fk_consult_subscriber` (`subscriber_id`),
  KEY `idx_consult_assigned_staff` (`assigned_staff_id`),
  KEY `idx_consultations_tenant` (`tenant_id`),
  KEY `idx_consultations_deleted` (`deleted_at`),
  KEY `idx_consultations_status` (`status`),
  KEY `idx_consultations_tenant_branch` (`tenant_id`,`branch_id`),
  CONSTRAINT `fk_consult_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_consult_therapist` FOREIGN KEY (`therapist_id`) REFERENCES `therapists` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contact_messages` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(50) NOT NULL,
  `subject` varchar(500) DEFAULT NULL,
  `message` text NOT NULL,
  `status` enum('NEW','READ','REPLIED') NOT NULL DEFAULT 'NEW',
  `admin_note` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  `branch_id` varchar(36) DEFAULT NULL,
  `converted_ticket_id` varchar(36) DEFAULT NULL,
  `priority` varchar(50) DEFAULT 'medium',
  PRIMARY KEY (`id`),
  KEY `idx_contact_messages_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_contact_messages_tenant_status` (`tenant_id`,`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_chapters` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `course_id` varchar(36) NOT NULL,
  `title` varchar(500) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_chapters_course` (`course_id`),
  CONSTRAINT `fk_chapters_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_completions` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `subscriber_id` varchar(36) NOT NULL,
  `course_id` varchar(36) NOT NULL,
  `certificate_code` varchar(50) NOT NULL,
  `completed_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_comp` (`subscriber_id`,`course_id`),
  UNIQUE KEY `uq_cert_code` (`certificate_code`),
  KEY `idx_coursecomp_sub` (`subscriber_id`),
  KEY `fk_coursecomp_crs` (`course_id`),
  KEY `idx_completions_subscriber` (`subscriber_id`),
  CONSTRAINT `fk_coursecomp_crs` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_coursecomp_sub` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_lectures` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `course_id` varchar(36) NOT NULL,
  `chapter_id` varchar(36) DEFAULT NULL,
  `title` varchar(500) NOT NULL,
  `lecture_type` enum('RECORDED','LIVE') NOT NULL,
  `video_url` text NOT NULL,
  `hls_url` text DEFAULT NULL,
  `duration` varchar(50) NOT NULL DEFAULT '',
  `duration_seconds` int(11) DEFAULT NULL,
  `is_preview` tinyint(1) NOT NULL DEFAULT 0,
  `thumbnail` text DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `view_count` int(11) NOT NULL DEFAULT 0,
  `description` text DEFAULT NULL,
  `is_published` tinyint(1) NOT NULL DEFAULT 1,
  `drip_unlock_days` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_lectures_course` (`course_id`),
  KEY `idx_lectures_chapter` (`chapter_id`),
  CONSTRAINT `fk_lectures_chapter` FOREIGN KEY (`chapter_id`) REFERENCES `course_chapters` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_lectures_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_materials` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `course_id` varchar(36) NOT NULL,
  `title` varchar(500) NOT NULL,
  `url` text NOT NULL,
  `access_level` enum('PARTIAL','FULL') NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_materials_course` (`course_id`),
  CONSTRAINT `fk_materials_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_quizzes` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `course_id` varchar(36) NOT NULL,
  `title` varchar(500) NOT NULL,
  `questions_json` longtext NOT NULL,
  `passing_score` double NOT NULL DEFAULT 70,
  `generated_by_ai` tinyint(1) NOT NULL DEFAULT 0,
  `source_material` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_quizzes_course` (`course_id`),
  CONSTRAINT `fk_quizzes_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_ratings` (
  `id` varchar(36) NOT NULL,
  `course_id` varchar(36) NOT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `rating` tinyint(4) NOT NULL CHECK (`rating` between 1 and 5),
  `comment` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rating` (`course_id`,`subscriber_id`),
  KEY `idx_cr_course` (`course_id`),
  KEY `idx_cr_subscriber` (`subscriber_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_waitlist` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `course_id` varchar(36) NOT NULL,
  `subscriber_id` varchar(36) DEFAULT NULL,
  `name` varchar(200) DEFAULT NULL,
  `email` varchar(200) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `position` int(10) unsigned NOT NULL DEFAULT 0,
  `status` enum('waiting','notified','enrolled','cancelled') NOT NULL DEFAULT 'waiting',
  `notified_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_wl_course` (`course_id`,`status`),
  KEY `idx_wl_sub` (`subscriber_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `courses` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `course_code` varchar(50) DEFAULT NULL,
  `slug` varchar(255) DEFAULT NULL,
  `title` varchar(500) NOT NULL,
  `title_en` varchar(500) DEFAULT NULL,
  `title_ar` varchar(500) DEFAULT NULL,
  `description` text NOT NULL,
  `short_description` text NOT NULL,
  `instructor` varchar(255) NOT NULL,
  `thumbnail` text NOT NULL,
  `category` enum('THERAPY','DIAGNOSIS','CHILD','GENERAL') NOT NULL,
  `type` enum('RECORDED','LIVE','MIX') NOT NULL,
  `price_egp` decimal(12,2) NOT NULL DEFAULT 0.00,
  `price_sar` decimal(12,2) NOT NULL DEFAULT 0.00,
  `price_usd` decimal(12,2) NOT NULL DEFAULT 0.00,
  `orig_price_egp` decimal(12,2) NOT NULL DEFAULT 0.00,
  `orig_price_sar` decimal(12,2) NOT NULL DEFAULT 0.00,
  `orig_price_usd` decimal(12,2) NOT NULL DEFAULT 0.00,
  `rating` double NOT NULL DEFAULT 0,
  `students` int(11) NOT NULL DEFAULT 0,
  `duration` varchar(100) NOT NULL DEFAULT '',
  `level` varchar(100) NOT NULL DEFAULT '',
  `hours` double DEFAULT NULL,
  `promo_video_url` text DEFAULT NULL,
  `live_session_url` text DEFAULT NULL,
  `certificate_template_url` text DEFAULT NULL,
  `certificate_template_name` varchar(255) DEFAULT NULL,
  `is_published` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `seo_title` varchar(255) DEFAULT NULL,
  `seo_description` varchar(500) DEFAULT NULL,
  `seo_keywords` varchar(500) DEFAULT NULL,
  `preview_video_url` text DEFAULT NULL,
  `drip_days` int(11) DEFAULT NULL,
  `modules_json` longtext DEFAULT NULL,
  `gallery_images_json` longtext DEFAULT NULL,
  `details_content_json` longtext DEFAULT NULL,
  `course_modules_json` longtext DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `max_students` int(10) unsigned DEFAULT NULL COMMENT 'NULL = unlimited',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_courses_slug` (`slug`),
  KEY `idx_courses_published` (`is_published`,`sort_order`),
  KEY `idx_courses_tenant` (`tenant_id`),
  KEY `idx_courses_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `crm_commissions` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `payment_id` varchar(100) DEFAULT NULL,
  `rule_id` varchar(36) DEFAULT NULL,
  `client_id` varchar(36) DEFAULT NULL,
  `client_type` enum('SUBSCRIBER','LEAD') DEFAULT 'SUBSCRIBER',
  `payment_amount` decimal(12,2) NOT NULL,
  `commission_amount` decimal(12,2) NOT NULL,
  `calc_details` longtext DEFAULT NULL CHECK (json_valid(`calc_details`)),
  `month` tinyint(3) unsigned NOT NULL,
  `year` smallint(5) unsigned NOT NULL,
  `status` enum('PENDING','INCLUDED_IN_PAYROLL','PAID','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `payroll_run_id` varchar(36) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  `branch_id` varchar(36) NOT NULL DEFAULT 'branch-other',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_comm_payment_staff` (`payment_id`,`staff_id`),
  KEY `idx_comm_staff` (`staff_id`),
  KEY `idx_comm_month` (`staff_id`,`year`,`month`),
  KEY `idx_comm_payment` (`payment_id`),
  KEY `idx_comm_status` (`status`),
  KEY `idx_comm_year_month_status` (`year`,`month`,`status`),
  KEY `idx_comm_client` (`client_id`),
  KEY `idx_comm_tenant_branch` (`tenant_id`,`branch_id`),
  CONSTRAINT `fk_comm_client` FOREIGN KEY (`client_id`) REFERENCES `subscribers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `daqqi_attendees` (
  `round_id` varchar(36) NOT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `booked_at` datetime NOT NULL,
  `amount_paid` decimal(12,2) NOT NULL DEFAULT 0.00,
  `attended_lectures` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`round_id`,`subscriber_id`),
  KEY `idx_daqqi_attendees_round` (`round_id`),
  KEY `idx_daqqi_attendees_subscriber` (`subscriber_id`),
  CONSTRAINT `fk_att_round` FOREIGN KEY (`round_id`) REFERENCES `daqqi_rounds` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_att_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `daqqi_rounds` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `code` varchar(50) NOT NULL,
  `course_id` varchar(36) NOT NULL,
  `instructor_id` varchar(36) DEFAULT NULL,
  `instructor_name` varchar(255) NOT NULL,
  `reception_id` varchar(36) DEFAULT NULL,
  `reception_name` varchar(255) NOT NULL,
  `day_of_week` varchar(20) NOT NULL,
  `start_date` datetime DEFAULT NULL,
  `time_slot` enum('MORNING','NOON','EVENING') NOT NULL,
  `status` enum('NEW','ACTIVE','FINISHED') NOT NULL DEFAULT 'NEW',
  `current_lecture` int(11) NOT NULL DEFAULT 0,
  `postponed_weeks_json` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_daqqi_code` (`code`),
  KEY `fk_daqqi_course` (`course_id`),
  KEY `fk_daqqi_reception` (`reception_id`),
  KEY `idx_daqqi_rounds_tenant` (`tenant_id`),
  KEY `idx_daqqi_rounds_created` (`created_at`,`id`),
  CONSTRAINT `fk_daqqi_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`),
  CONSTRAINT `fk_daqqi_reception` FOREIGN KEY (`reception_id`) REFERENCES `staff` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `daqqi_waitlist` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `course_name` varchar(255) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` enum('waiting','contacted','enrolled','cancelled') DEFAULT 'waiting',
  `branch` enum('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT 'DAQQI',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `disciplinary_records` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `type` enum('warning','verbal_warning','written_warning','suspension','termination','other') DEFAULT 'warning',
  `severity` enum('low','medium','high') DEFAULT 'medium',
  `title` varchar(300) NOT NULL,
  `description` text DEFAULT NULL,
  `incident_date` date DEFAULT NULL,
  `action_taken` text DEFAULT NULL,
  `issued_by` varchar(36) DEFAULT NULL,
  `acknowledged_at` datetime DEFAULT NULL,
  `acknowledged_by` varchar(36) DEFAULT NULL,
  `status` enum('open','acknowledged','resolved','appealed') DEFAULT 'open',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `discount_rules` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `type` enum('COURSE','BUNDLE','ALL_COURSES','THERAPIST_CONSULTATION','ALL_CONSULTATIONS') NOT NULL,
  `target_id` varchar(36) DEFAULT NULL,
  `discount_percent` decimal(5,2) NOT NULL,
  `label` varchar(255) DEFAULT NULL,
  `promo_code` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `expires_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_discounts_promo_code` (`promo_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `drip_campaigns` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(500) NOT NULL,
  `trigger_event` varchar(255) NOT NULL DEFAULT 'subscription_created' COMMENT 'subscription_created|lead_status:interested|consultation_completed|payment_received',
  `audience` enum('subscribers','leads','all') NOT NULL DEFAULT 'subscribers',
  `status` enum('active','paused','draft') NOT NULL DEFAULT 'draft',
  `enrolled_count` int(11) NOT NULL DEFAULT 0,
  `completed_count` int(11) NOT NULL DEFAULT 0,
  `steps` longtext NOT NULL DEFAULT '[]' CHECK (json_valid(`steps`)),
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  PRIMARY KEY (`id`),
  KEY `idx_drip_campaigns_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `drip_enrollments` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `sequence_id` varchar(36) NOT NULL,
  `lead_id` varchar(36) DEFAULT NULL,
  `subscriber_id` varchar(100) DEFAULT NULL,
  `email` varchar(200) NOT NULL,
  `current_step` int(11) DEFAULT 0,
  `started_at` timestamp NULL DEFAULT current_timestamp(),
  `next_send_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `unsubscribed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_drip_next` (`next_send_at`),
  KEY `idx_drip_seq` (`sequence_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `drip_sequences` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `trigger_status` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `steps` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Array of {delay_days, subject, body_html}' CHECK (json_valid(`steps`)),
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `created_by` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_campaigns` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `title` varchar(500) NOT NULL,
  `subject` varchar(500) NOT NULL,
  `body_html` text NOT NULL,
  `audience` enum('all','subscribers','leads','manual') NOT NULL DEFAULT 'all',
  `audience_filter` longtext DEFAULT NULL CHECK (json_valid(`audience_filter`)),
  `status` enum('draft','sending','sent','failed') NOT NULL DEFAULT 'draft',
  `sent_count` int(11) NOT NULL DEFAULT 0,
  `fail_count` int(11) NOT NULL DEFAULT 0,
  `scheduled_at` datetime DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_by` varchar(36) DEFAULT NULL,
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_sequence_queue` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `step_id` varchar(36) NOT NULL,
  `recipient_email` varchar(320) NOT NULL,
  `recipient_name` varchar(255) DEFAULT NULL,
  `scheduled_at` datetime NOT NULL,
  `sent_at` datetime DEFAULT NULL,
  `failed_at` datetime DEFAULT NULL,
  `error_msg` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_esq_step` (`step_id`),
  KEY `idx_esq_scheduled` (`scheduled_at`),
  KEY `idx_esq_email` (`recipient_email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_sequence_steps` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `sequence_id` varchar(36) NOT NULL,
  `step_order` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `delay_hours` int(10) unsigned NOT NULL DEFAULT 0 COMMENT 'hours after trigger to send',
  `subject` varchar(500) NOT NULL DEFAULT '',
  `body_html` longtext NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ess_seq` (`sequence_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_sequences` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(200) NOT NULL,
  `trigger_event` enum('registration','enrollment','payment','lead_created') NOT NULL DEFAULT 'registration',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_bonuses` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `type` enum('bonus','deduction') DEFAULT 'bonus',
  `amount` decimal(12,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') DEFAULT 'EGP',
  `reason` text DEFAULT NULL,
  `for_month` tinyint(3) unsigned DEFAULT NULL,
  `for_year` smallint(5) unsigned DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_bonuses_staff` (`staff_id`),
  KEY `idx_bonuses_period` (`for_year`,`for_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_documents` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `title` varchar(300) NOT NULL,
  `category` enum('contract','id','certificate','medical','other') DEFAULT 'other',
  `file_url` text DEFAULT NULL,
  `file_name` varchar(300) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `uploaded_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_onboarding` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `template_id` varchar(36) DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT current_timestamp(),
  `completed_at` timestamp NULL DEFAULT NULL,
  `status` enum('in_progress','completed','cancelled') DEFAULT 'in_progress',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_onboarding_items` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `onboarding_id` varchar(36) NOT NULL,
  `task_title` varchar(300) NOT NULL,
  `category` varchar(50) DEFAULT 'other',
  `due_date` date DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `completed_by` varchar(36) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `sort_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `enrollments` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `subscriber_id` varchar(36) NOT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `bundle_id` varchar(36) DEFAULT NULL,
  `enrolled_at` datetime NOT NULL,
  `expiry_date` datetime DEFAULT NULL,
  `access_type` varchar(20) NOT NULL DEFAULT 'full',
  `progress_percent` int(11) NOT NULL DEFAULT 0,
  `completed_at` datetime DEFAULT NULL,
  `certificate_issued` tinyint(1) NOT NULL DEFAULT 0,
  `certificate_issued_at` datetime DEFAULT NULL,
  `lecture_limit` int(11) DEFAULT NULL,
  `attended_lectures` int(11) NOT NULL DEFAULT 0,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `branch_id` varchar(36) NOT NULL DEFAULT 'branch-other',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_enroll_sub_course` (`subscriber_id`,`course_id`),
  KEY `idx_enroll_subscriber` (`subscriber_id`),
  KEY `idx_enroll_course` (`course_id`),
  KEY `fk_enroll_bundle` (`bundle_id`),
  KEY `idx_enrollments_tenant` (`tenant_id`),
  KEY `idx_enrollments_subscriber` (`subscriber_id`),
  KEY `idx_enrollments_course` (`course_id`),
  KEY `idx_enroll_sub_course` (`subscriber_id`,`course_id`),
  KEY `idx_enrollments_tenant_branch` (`tenant_id`,`branch_id`),
  CONSTRAINT `fk_enroll_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_enroll_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_enroll_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `expenses` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `description` text NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `category` enum('SALARIES','RENT','UTILITIES','SOFTWARE','MARKETING','EQUIPMENT','MAINTENANCE','TRAVEL','OTHER') NOT NULL DEFAULT 'OTHER',
  `date` datetime NOT NULL,
  `receipt_url` text DEFAULT NULL,
  `note` text DEFAULT NULL,
  `staff_id` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `branch_id` varchar(36) DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `vat_rate` decimal(5,2) DEFAULT 0.00,
  `vat_amount` decimal(12,2) DEFAULT 0.00,
  `amount_before_vat` decimal(12,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_expenses_date` (`date`),
  KEY `idx_expenses_tenant` (`tenant_id`),
  KEY `idx_expenses_deleted` (`deleted_at`),
  KEY `idx_expenses_tenant_date` (`tenant_id`,`date`),
  KEY `idx_expenses_tenant_category_date` (`tenant_id`,`category`,`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `feature_flags` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `flag_key` varchar(160) NOT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `config_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`config_json`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_feature_flags_tenant_key` (`tenant_id`,`flag_key`),
  KEY `idx_feature_flags_key` (`flag_key`),
  CONSTRAINT `fk_feature_flags_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `finance_outbox` (
  `id` varchar(36) NOT NULL,
  `event_type` varchar(120) NOT NULL,
  `ref_type` varchar(120) DEFAULT NULL,
  `ref_id` varchar(120) DEFAULT NULL,
  `payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload_json`)),
  `error_message` text DEFAULT NULL,
  `status` enum('pending','processed','failed') NOT NULL DEFAULT 'pending',
  `attempts` int(11) NOT NULL DEFAULT 0,
  `next_attempt_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_finance_outbox_status_next` (`status`,`next_attempt_at`),
  KEY `idx_finance_outbox_ref` (`ref_type`,`ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `financial_audit_log` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'mahad',
  `entity_type` varchar(40) NOT NULL,
  `entity_id` varchar(64) DEFAULT NULL,
  `action` varchar(40) NOT NULL,
  `old_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`old_json`)),
  `new_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`new_json`)),
  `amount` decimal(12,2) DEFAULT NULL,
  `actor` varchar(120) NOT NULL DEFAULT 'system',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_faudit_entity` (`tenant_id`,`entity_type`,`entity_id`),
  KEY `idx_faudit_created` (`created_at`),
  KEY `idx_fin_audit_entity_created` (`entity_type`,`entity_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `forum_posts` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `author_id` varchar(36) NOT NULL COMMENT 'subscriber.id',
  `author_name` varchar(200) DEFAULT NULL,
  `course_id` varchar(36) DEFAULT NULL COMMENT 'NULL = general community, set = course-specific',
  `parent_id` varchar(36) DEFAULT NULL COMMENT 'NULL = top-level post, set = reply',
  `title` varchar(300) DEFAULT NULL COMMENT 'only for top-level posts',
  `body` text NOT NULL,
  `upvotes` int(10) unsigned NOT NULL DEFAULT 0,
  `is_pinned` tinyint(1) NOT NULL DEFAULT 0,
  `is_hidden` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_fp_course` (`course_id`),
  KEY `idx_fp_parent` (`parent_id`),
  KEY `idx_fp_author` (`author_id`),
  KEY `idx_fp_pinned` (`is_pinned`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `forum_upvotes` (
  `post_id` varchar(36) NOT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`post_id`,`subscriber_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `hr_audit_logs` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `action` varchar(100) NOT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` varchar(36) DEFAULT NULL,
  `old_value` longtext DEFAULT NULL CHECK (json_valid(`old_value`)),
  `new_value` longtext DEFAULT NULL CHECK (json_valid(`new_value`)),
  `performed_by` varchar(36) DEFAULT NULL,
  `performed_at` datetime NOT NULL DEFAULT current_timestamp(),
  `ip_address` varchar(45) DEFAULT NULL,
  `note` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_hral_entity` (`entity_type`,`entity_id`),
  KEY `idx_hral_date` (`performed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `hr_departments` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(255) NOT NULL,
  `branch` enum('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','ALL') NOT NULL DEFAULT 'ALL',
  `manager_id` varchar(36) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_dept_branch` (`branch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `inbox_conversations` (
  `id` varchar(100) NOT NULL,
  `channel` varchar(50) DEFAULT NULL,
  `contact_name` varchar(200) DEFAULT NULL,
  `contact_id` varchar(200) DEFAULT NULL,
  `contact_avatar` text DEFAULT NULL,
  `last_message` text DEFAULT NULL,
  `last_message_at` varchar(50) DEFAULT NULL,
  `unread_count` int(11) DEFAULT 0,
  `status` varchar(50) DEFAULT 'open',
  `assigned_to_staff_id` varchar(100) DEFAULT NULL,
  `assigned_to_staff_name` varchar(200) DEFAULT NULL,
  `tags` text DEFAULT NULL,
  `messages` longtext DEFAULT NULL,
  `linked_lead_id` varchar(100) DEFAULT NULL,
  `linked_subscriber_id` varchar(100) DEFAULT NULL,
  `created_at` varchar(50) DEFAULT NULL,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `installment_entries` (
  `id` varchar(64) NOT NULL,
  `plan_id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'mahad',
  `seq` int(11) NOT NULL DEFAULT 0,
  `due_date` date DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `paid` tinyint(1) NOT NULL DEFAULT 0,
  `paid_at` date DEFAULT NULL,
  `payment_id` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_entry_plan_seq` (`plan_id`,`seq`),
  KEY `idx_entry_plan` (`plan_id`),
  KEY `idx_entry_due` (`tenant_id`,`due_date`,`paid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `installment_plans` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `subscriber_id` varchar(100) NOT NULL,
  `payment_id` varchar(100) DEFAULT NULL,
  `title` varchar(200) DEFAULT NULL,
  `total_amount` decimal(12,2) NOT NULL,
  `currency` varchar(10) DEFAULT 'EGP',
  `installments_count` int(11) NOT NULL DEFAULT 3,
  `paid_count` int(11) DEFAULT 0,
  `installment_amounts` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`installment_amounts`)),
  `due_dates` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`due_dates`)),
  `paid_dates` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`paid_dates`)),
  `status` enum('active','completed','overdue','cancelled') DEFAULT 'active',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `created_by` varchar(200) DEFAULT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  PRIMARY KEY (`id`),
  KEY `idx_inst_sub` (`subscriber_id`),
  KEY `idx_inst_status` (`status`),
  KEY `idx_inst_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `instructor_fees` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `daqqi_round_id` varchar(36) DEFAULT NULL,
  `fee_type` enum('lecture','training','consultation','fixed') NOT NULL DEFAULT 'lecture',
  `hours` decimal(5,2) DEFAULT NULL,
  `rate_per_hour` decimal(10,2) DEFAULT NULL,
  `fixed_amount` decimal(10,2) DEFAULT NULL,
  `total_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `period_month` tinyint(3) unsigned DEFAULT NULL,
  `period_year` smallint(5) unsigned DEFAULT NULL,
  `status` enum('pending','approved','paid') NOT NULL DEFAULT 'pending',
  `note` text DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_if_staff` (`staff_id`),
  KEY `idx_if_course` (`course_id`),
  KEY `idx_if_period` (`period_year`,`period_month`),
  KEY `idx_if_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `instructor_rates` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `consultation_rate_type` enum('per_session','percentage','per_hour') DEFAULT 'per_session',
  `consultation_rate_value` decimal(12,2) DEFAULT 0.00,
  `lecture_rate_per_hour` decimal(12,2) DEFAULT 0.00,
  `training_rate_per_hour` decimal(12,2) DEFAULT 0.00,
  `currency` enum('EGP','SAR','USD') DEFAULT 'EGP',
  `notes` text DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `revenue_share_pct` decimal(5,2) DEFAULT 0.00,
  PRIMARY KEY (`id`),
  UNIQUE KEY `staff_id` (`staff_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_items` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `sku` varchar(100) DEFAULT NULL,
  `stock_quantity` int(11) NOT NULL DEFAULT 0,
  `unit` varchar(40) DEFAULT NULL,
  `branch_id` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_inventory_items_sku` (`sku`),
  KEY `idx_inventory_items_branch` (`branch_id`),
  KEY `idx_inventory_items_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_transactions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `item_id` varchar(36) NOT NULL,
  `type` enum('IN','OUT','ADJUST') NOT NULL,
  `quantity` int(11) NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `performed_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_inventory_transactions_item` (`item_id`,`created_at`),
  KEY `idx_inventory_transactions_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ip_whitelist` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `ip` varchar(64) NOT NULL,
  `label` varchar(255) DEFAULT NULL,
  `added_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ip` (`ip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `issued_certificates` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `subscriber_id` varchar(36) NOT NULL,
  `course_id` varchar(36) NOT NULL,
  `certificate_number` varchar(100) NOT NULL,
  `issued_at` datetime NOT NULL DEFAULT current_timestamp(),
  `note` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_issued_cert_number` (`certificate_number`),
  KEY `idx_issued_cert_subscriber` (`subscriber_id`),
  KEY `idx_issued_cert_course` (`course_id`),
  CONSTRAINT `fk_issued_cert_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_issued_cert_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_applicants` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `job_id` varchar(36) NOT NULL,
  `name` varchar(200) NOT NULL,
  `email` varchar(200) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `cv_url` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `stage` enum('applied','screening','interview','offer','hired','rejected') DEFAULT 'applied',
  `stage_notes` text DEFAULT NULL,
  `updated_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  `source` varchar(30) NOT NULL DEFAULT 'manual' COMMENT 'manual|website',
  `source_id` varchar(36) DEFAULT NULL COMMENT 'join_us_applications.id when source=website',
  `specialty` varchar(255) DEFAULT NULL,
  `applicant_type` varchar(30) DEFAULT NULL COMMENT 'INSTRUCTOR|CONSULTANT|EMPLOYEE',
  `linkedin` varchar(300) DEFAULT NULL,
  `hired_staff_id` varchar(36) DEFAULT NULL COMMENT 'staff.id created when applicant is hired',
  PRIMARY KEY (`id`),
  KEY `idx_applicants_source` (`source`,`source_id`),
  KEY `idx_applicants_stage` (`stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_postings` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `title` varchar(200) NOT NULL,
  `department_id` varchar(36) DEFAULT NULL,
  `employment_type` enum('full_time','part_time','contract','intern') DEFAULT 'full_time',
  `description` text DEFAULT NULL,
  `requirements` text DEFAULT NULL,
  `salary_min` decimal(10,2) DEFAULT NULL,
  `salary_max` decimal(10,2) DEFAULT NULL,
  `status` enum('draft','open','closed','filled') DEFAULT 'open',
  `posted_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_queue` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'mahad',
  `job_type` varchar(80) NOT NULL,
  `payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload_json`)),
  `status` enum('pending','running','done','failed','dead') NOT NULL DEFAULT 'pending',
  `attempts` int(11) NOT NULL DEFAULT 0,
  `max_attempts` int(11) NOT NULL DEFAULT 5,
  `run_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `locked_at` timestamp NULL DEFAULT NULL,
  `locked_by` varchar(80) DEFAULT NULL,
  `last_error` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `done_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_job_claim` (`status`,`run_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `join_us_applications` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `specialty` varchar(255) NOT NULL,
  `experience` text NOT NULL,
  `type` enum('INSTRUCTOR','CONSULTANT','EMPLOYEE') NOT NULL,
  `linkedin` text DEFAULT NULL,
  `message` text DEFAULT NULL,
  `status` enum('NEW','REVIEWED','ACCEPTED','REJECTED') NOT NULL DEFAULT 'NEW',
  `admin_note` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  `branch_id` varchar(36) DEFAULT NULL,
  `converted_applicant_id` varchar(36) DEFAULT NULL,
  `assigned_to` varchar(36) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_joinus_status` (`status`),
  KEY `idx_joinus_converted` (`converted_applicant_id`),
  KEY `idx_join_us_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_join_us_tenant_type_status` (`tenant_id`,`type`,`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `journal_entries` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `ref_type` varchar(50) NOT NULL COMMENT 'payment | refund | payroll | adjustment',
  `ref_id` varchar(191) DEFAULT NULL,
  `entry_date` date NOT NULL,
  `description` text DEFAULT NULL,
  `total_debit` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_credit` decimal(12,2) NOT NULL DEFAULT 0.00,
  `posted_by` varchar(200) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_je_ref` (`ref_type`,`ref_id`),
  KEY `idx_je_date` (`entry_date`),
  KEY `idx_journal_ref` (`ref_type`,`ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `journal_entry_lines` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `entry_id` varchar(36) NOT NULL,
  `account_code` varchar(20) NOT NULL,
  `account_name` varchar(200) NOT NULL,
  `debit` decimal(12,2) NOT NULL DEFAULT 0.00,
  `credit` decimal(12,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `idx_jel_entry` (`entry_id`),
  CONSTRAINT `fk_jel_entry` FOREIGN KEY (`entry_id`) REFERENCES `journal_entries` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_actuals` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `metric` varchar(100) NOT NULL,
  `actual_value` decimal(12,2) NOT NULL DEFAULT 0.00,
  `period` enum('MONTHLY','QUARTERLY','YEARLY') NOT NULL DEFAULT 'MONTHLY',
  `period_start` date NOT NULL,
  `period_end` date NOT NULL,
  `source` enum('CRM_AUTO','ATTENDANCE_AUTO','MANUAL') NOT NULL DEFAULT 'CRM_AUTO',
  `breakdown_json` longtext DEFAULT NULL CHECK (json_valid(`breakdown_json`)),
  `calculated_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_kpi_actual` (`staff_id`,`metric`,`period`,`period_start`),
  KEY `idx_kpia_staff` (`staff_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kpi_targets` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `metric` varchar(100) NOT NULL,
  `target_value` decimal(12,2) NOT NULL,
  `period` enum('MONTHLY','QUARTERLY','YEARLY') NOT NULL DEFAULT 'MONTHLY',
  `from_date` date NOT NULL,
  `to_date` date NOT NULL,
  `notes` text DEFAULT NULL,
  `set_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_kpit_staff` (`staff_id`),
  KEY `idx_kpit_period` (`staff_id`,`metric`,`from_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lead_timeline` (
  `id` varchar(100) NOT NULL,
  `lead_id` varchar(100) NOT NULL,
  `event_type` varchar(80) NOT NULL,
  `description` text DEFAULT NULL,
  `meta_json` text DEFAULT NULL,
  `at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_lt_lead` (`lead_id`),
  KEY `idx_lt_at` (`at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `leads` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `client_code` varchar(50) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `source` varchar(255) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'new',
  `lead_type` enum('COURSE','CONSULTATION','GENERAL') NOT NULL DEFAULT 'GENERAL',
  `branch` enum('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT NULL,
  `interest_level` enum('LOW','MEDIUM','HIGH') DEFAULT NULL,
  `lead_score` smallint(6) DEFAULT 0,
  `enrolled_course_id` varchar(36) DEFAULT NULL,
  `interested_course_ids_json` text DEFAULT NULL,
  `assigned_sales_id` varchar(36) DEFAULT NULL,
  `assigned_sales_name` varchar(255) DEFAULT NULL,
  `assigned_cs_id` varchar(36) DEFAULT NULL,
  `assigned_cs_name` varchar(255) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `last_follow_up` datetime DEFAULT NULL,
  `last_contact_note` text DEFAULT NULL,
  `next_follow_up_date` datetime DEFAULT NULL,
  `retargeting_sent_at` datetime DEFAULT NULL,
  `promo_code` varchar(100) DEFAULT NULL,
  `login_email` varchar(255) DEFAULT NULL,
  `fb_lead_id` varchar(255) DEFAULT NULL,
  `fb_form_id` varchar(255) DEFAULT NULL,
  `fb_form_name` varchar(255) DEFAULT NULL,
  `hidden` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `branch_id` varchar(36) DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `utm_source` varchar(200) DEFAULT NULL,
  `utm_medium` varchar(200) DEFAULT NULL,
  `score` int(11) NOT NULL DEFAULT 0,
  `crm_json` longtext DEFAULT NULL,
  `utm_campaign` varchar(200) DEFAULT NULL,
  `deal_value` decimal(10,2) DEFAULT NULL,
  `utm_content` varchar(200) DEFAULT NULL,
  `utm_term` varchar(200) DEFAULT NULL,
  `referral_url` text DEFAULT NULL,
  `client_type` varchar(50) DEFAULT NULL,
  `is_unsubscribed` tinyint(1) NOT NULL DEFAULT 0,
  `unsubscribed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_leads_client_code` (`client_code`),
  UNIQUE KEY `idx_leads_fb_lead_id` (`fb_lead_id`),
  KEY `idx_leads_status` (`status`),
  KEY `idx_leads_email` (`email`),
  KEY `idx_leads_created_at` (`created_at`),
  KEY `idx_leads_retargeting_sent_at` (`retargeting_sent_at`),
  KEY `idx_leads_tenant` (`tenant_id`),
  KEY `idx_leads_deleted` (`deleted_at`),
  KEY `idx_leads_hidden_created` (`hidden`,`created_at`),
  KEY `idx_leads_assigned_sales` (`assigned_sales_id`),
  KEY `idx_leads_next_followup` (`next_follow_up_date`),
  KEY `idx_leads_score` (`score`),
  KEY `idx_leads_assigned_cs` (`assigned_cs_id`),
  KEY `idx_leads_phone` (`phone`(20)),
  KEY `idx_source` (`source`),
  KEY `idx_status_created` (`status`,`created_at`),
  KEY `idx_leads_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_leads_tenant_status_created` (`tenant_id`,`status`,`created_at`),
  KEY `idx_leads_unsubscribed` (`is_unsubscribed`),
  KEY `idx_leads_tenant_hidden_created_id` (`tenant_id`,`hidden`,`created_at`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `leave_requests` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `type` enum('ANNUAL','SICK','EMERGENCY','UNPAID','OTHER') NOT NULL DEFAULT 'ANNUAL',
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `days` smallint(6) NOT NULL DEFAULT 1,
  `reason` text DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `approved_by` varchar(36) DEFAULT NULL,
  `admin_note` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_leave_staff` (`staff_id`),
  KEY `idx_leave_dates` (`start_date`,`end_date`),
  KEY `idx_leave_status` (`status`),
  CONSTRAINT `fk_leave_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `leaves` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `type` enum('ANNUAL','SICK','UNPAID','MATERNITY','EMERGENCY','PERMISSION','OTHER') NOT NULL DEFAULT 'ANNUAL',
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `total_days` decimal(4,1) NOT NULL DEFAULT 1.0,
  `reason` text DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `approved_by` varchar(36) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `admin_note` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_leaves_staff` (`staff_id`),
  KEY `idx_leaves_dates` (`start_date`,`end_date`),
  KEY `idx_leaves_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lecture_completions` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `subscriber_id` varchar(36) NOT NULL,
  `lecture_id` varchar(36) NOT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `progress_pct` double NOT NULL DEFAULT 0,
  `watch_seconds` int(11) NOT NULL DEFAULT 0,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_completion` (`subscriber_id`,`lecture_id`),
  KEY `idx_comp_sub` (`subscriber_id`),
  KEY `idx_comp_course` (`subscriber_id`,`course_id`),
  CONSTRAINT `fk_comp_sub` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lecture_progress` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `subscriber_id` varchar(36) NOT NULL,
  `lecture_id` varchar(36) NOT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `progress_pct` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `completed_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lp` (`subscriber_id`,`lecture_id`),
  KEY `idx_lp_sub` (`subscriber_id`),
  KEY `idx_lp_course` (`course_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `live_sessions` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `course_id` varchar(36) DEFAULT NULL,
  `title` varchar(255) NOT NULL DEFAULT '',
  `platform` enum('zoom','google_meet','youtube','other') NOT NULL DEFAULT 'zoom',
  `meeting_url` text NOT NULL,
  `meeting_id` varchar(200) DEFAULT NULL,
  `meeting_pass` varchar(100) DEFAULT NULL,
  `starts_at` datetime NOT NULL,
  `duration_min` smallint(5) unsigned NOT NULL DEFAULT 60,
  `status` enum('scheduled','live','ended','cancelled') NOT NULL DEFAULT 'scheduled',
  `recording_url` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_by` varchar(200) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_ls_course` (`course_id`),
  KEY `idx_ls_starts` (`starts_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `live_streams` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `title` varchar(500) NOT NULL,
  `instructor_id` varchar(36) DEFAULT NULL,
  `instructor_name` varchar(255) NOT NULL,
  `scheduled_at` datetime NOT NULL,
  `duration_minutes` int(11) DEFAULT NULL,
  `stream_url` text NOT NULL,
  `platform` enum('ZOOM','YOUTUBE','MEET','OTHER') DEFAULT NULL,
  `visibility` enum('ALL_SUBSCRIBERS','COURSE_SUBSCRIBERS','COMMUNITY_ALL','COMMUNITY_AND_SUBSCRIBERS') NOT NULL DEFAULT 'ALL_SUBSCRIBERS',
  `target_course_ids_json` text DEFAULT NULL,
  `status` enum('UPCOMING','LIVE','ENDED') NOT NULL DEFAULT 'UPCOMING',
  `recording_url` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_streams_scheduled` (`scheduled_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `ip` varchar(64) DEFAULT NULL,
  `user_agent` varchar(512) DEFAULT NULL,
  `status` enum('success','failed','2fa_pending','2fa_success') DEFAULT 'success',
  `failure_reason` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_email` (`email`),
  KEY `idx_created` (`created_at`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `loyalty_ledger` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `points` int(11) NOT NULL,
  `balance_after` int(11) NOT NULL,
  `reason` varchar(120) NOT NULL DEFAULT 'manual',
  `reference_type` varchar(80) DEFAULT NULL,
  `reference_id` varchar(100) DEFAULT NULL,
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_loyalty_subscriber_reference` (`subscriber_id`,`reference_type`,`reference_id`),
  KEY `idx_loyalty_subscriber` (`subscriber_id`,`created_at`),
  KEY `idx_loyalty_reference` (`reference_type`,`reference_id`),
  KEY `idx_loyalty_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `message_outbox` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'mahad',
  `channel` enum('email','whatsapp') NOT NULL,
  `recipient` varchar(255) NOT NULL,
  `subject` varchar(500) DEFAULT NULL,
  `payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload_json`)),
  `status` enum('pending','sent','failed','dead') NOT NULL DEFAULT 'pending',
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_error` text DEFAULT NULL,
  `next_attempt_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `sent_at` timestamp NULL DEFAULT NULL,
  `dedupe_key` varchar(150) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_outbox_dedupe` (`dedupe_key`),
  KEY `idx_outbox_due` (`status`,`next_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_broadcasts` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `title` varchar(500) NOT NULL,
  `body` text NOT NULL,
  `type` varchar(20) NOT NULL DEFAULT 'info',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notifications_active` (`is_active`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` varchar(36) NOT NULL,
  `subscriber_id` varchar(100) DEFAULT NULL,
  `type` varchar(50) NOT NULL DEFAULT 'info',
  `title` varchar(255) DEFAULT NULL,
  `message` text DEFAULT NULL,
  `data_json` text DEFAULT NULL,
  `read_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notifications_created` (`created_at`),
  KEY `idx_notifications_read` (`read_at`),
  KEY `idx_notifications_subscriber` (`subscriber_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `nps_responses` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `subscriber_id` varchar(36) DEFAULT NULL,
  `subscriber_email` varchar(255) DEFAULT NULL,
  `score` tinyint(3) unsigned NOT NULL COMMENT '0-10',
  `comment` text DEFAULT NULL,
  `payment_id` varchar(100) DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `responded_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  `branch_id` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_nps_sub` (`subscriber_id`),
  KEY `idx_nps_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_nps_tenant_responded` (`tenant_id`,`responded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `onboarding_tasks` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `template_id` varchar(36) NOT NULL,
  `title` varchar(300) NOT NULL,
  `description` text DEFAULT NULL,
  `due_days` int(11) DEFAULT 7,
  `category` enum('documents','training','setup','meeting','other') DEFAULT 'other',
  `sort_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `onboarding_templates` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(200) NOT NULL,
  `role` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `type` enum('COURSE','BUNDLE','CONSULTATION') NOT NULL,
  `item_id` varchar(36) NOT NULL,
  `item_title` varchar(500) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `payment_method` varchar(50) NOT NULL DEFAULT 'CARD',
  `customer_name` varchar(255) NOT NULL,
  `customer_email` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(50) DEFAULT NULL,
  `status` enum('PAID','FAILED','REFUNDED','PENDING') NOT NULL DEFAULT 'PENDING',
  `transaction_id` varchar(255) DEFAULT NULL,
  `coupon_code` varchar(100) DEFAULT NULL,
  `subscriber_id` varchar(36) DEFAULT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `bundle_id` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `paid_at` datetime DEFAULT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `branch_id` varchar(36) NOT NULL DEFAULT 'branch-other',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `linked_transfer_id` varchar(36) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `staff_id` varchar(36) DEFAULT NULL,
  `staff_name` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_orders_status` (`status`),
  KEY `idx_orders_created_at` (`created_at`),
  KEY `idx_orders_tenant` (`tenant_id`),
  KEY `idx_orders_deleted` (`deleted_at`),
  KEY `idx_orders_status_created` (`status`,`created_at`),
  KEY `idx_orders_tenant_branch` (`tenant_id`,`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `otp_codes` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `email` varchar(255) NOT NULL,
  `code` varchar(10) NOT NULL,
  `type` enum('password_reset','2fa') NOT NULL DEFAULT 'password_reset',
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_otp_user` (`user_id`),
  KEY `idx_otp_email` (`email`),
  KEY `idx_otp_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_audit_log` (
  `id` varchar(36) NOT NULL,
  `payment_id` varchar(100) NOT NULL,
  `action` enum('create','update','delete') NOT NULL,
  `old_status` varchar(50) DEFAULT NULL,
  `new_status` varchar(50) DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `subscriber_id` varchar(36) DEFAULT NULL,
  `actor` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_payment` (`payment_id`),
  KEY `idx_audit_subscriber` (`subscriber_id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_payment_audit_payment_action` (`payment_id`,`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_links` (
  `id` varchar(36) NOT NULL,
  `token` varchar(128) NOT NULL,
  `item_type` enum('course','bundle','consultation') NOT NULL,
  `item_id` varchar(36) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `currency` varchar(10) DEFAULT 'EGP',
  `subscriber_id` varchar(36) DEFAULT NULL,
  `description` varchar(500) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_by` varchar(100) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_expires` (`expires_at`),
  KEY `idx_payment_links_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_proofs` (
  `id` varchar(100) NOT NULL,
  `subscriber_id` varchar(100) NOT NULL,
  `course_id` varchar(100) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `payment_method` varchar(50) NOT NULL DEFAULT 'instapay',
  `proof_image` mediumtext DEFAULT NULL,
  `note` text DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `reviewer_id` varchar(100) DEFAULT NULL,
  `reviewer_note` text DEFAULT NULL,
  `submitted_at` datetime NOT NULL DEFAULT current_timestamp(),
  `reviewed_at` datetime DEFAULT NULL,
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  `branch_id` varchar(36) NOT NULL DEFAULT 'branch-other',
  PRIMARY KEY (`id`),
  KEY `idx_pp_subscriber` (`subscriber_id`),
  KEY `idx_pp_status` (`status`),
  KEY `idx_proofs_tenant_branch` (`tenant_id`,`branch_id`),
  CONSTRAINT `fk_pp_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments` (
  `id` varchar(100) NOT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `branch` enum('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `bundle_id` varchar(36) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `payment_type` enum('COURSE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER') DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `transaction_id` varchar(255) DEFAULT NULL,
  `is_installment` tinyint(1) NOT NULL DEFAULT 0,
  `course_expected` decimal(12,2) DEFAULT NULL,
  `discount` decimal(12,2) DEFAULT NULL,
  `date` datetime NOT NULL,
  `note` text DEFAULT NULL,
  `staff_id` varchar(36) DEFAULT NULL,
  `status` enum('pending','paid','failed','refunded') NOT NULL DEFAULT 'paid',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `branch_id` varchar(36) DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `staff_name` varchar(255) DEFAULT NULL,
  `from_account` varchar(255) DEFAULT NULL,
  `source` varchar(50) DEFAULT NULL,
  `item_title` varchar(255) DEFAULT NULL,
  `cert_type` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_payments_txn` (`transaction_id`),
  KEY `idx_payments_subscriber` (`subscriber_id`),
  KEY `idx_payments_date` (`date`),
  KEY `fk_payments_bundle` (`bundle_id`),
  KEY `idx_payments_tenant` (`tenant_id`),
  KEY `idx_payments_deleted` (`deleted_at`),
  KEY `idx_payments_status_date` (`status`,`date`),
  KEY `idx_payments_staff` (`staff_id`),
  KEY `idx_payments_course_id` (`course_id`),
  KEY `idx_payments_branch` (`branch`),
  KEY `idx_pay_staff_date` (`staff_id`,`date`,`status`),
  KEY `idx_status_branch` (`status`,`branch`),
  KEY `idx_payments_tenant_date` (`tenant_id`,`date`),
  KEY `idx_payments_tenant_status_date` (`tenant_id`,`status`,`date`),
  KEY `idx_payments_txn_id` (`transaction_id`(191)),
  CONSTRAINT `fk_payments_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payments_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payments_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_items` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `payroll_run_id` varchar(36) NOT NULL,
  `staff_id` varchar(36) NOT NULL,
  `base_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `allowances_json` longtext DEFAULT NULL CHECK (json_valid(`allowances_json`)),
  `total_allowances` decimal(10,2) NOT NULL DEFAULT 0.00,
  `commission` decimal(10,2) NOT NULL DEFAULT 0.00,
  `bonus` decimal(10,2) NOT NULL DEFAULT 0.00,
  `bonus_note` text DEFAULT NULL,
  `late_deductions` decimal(10,2) NOT NULL DEFAULT 0.00,
  `absence_deductions` decimal(10,2) NOT NULL DEFAULT 0.00,
  `advance_deductions` decimal(10,2) NOT NULL DEFAULT 0.00,
  `other_deductions` decimal(10,2) NOT NULL DEFAULT 0.00,
  `deductions_note` text DEFAULT NULL,
  `net_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `attendance_days` int(11) DEFAULT NULL,
  `absent_days` int(11) DEFAULT NULL,
  `late_minutes` int(11) DEFAULT NULL,
  `commission_count` int(11) DEFAULT NULL,
  `calculation_details` longtext DEFAULT NULL CHECK (json_valid(`calculation_details`)),
  `is_manual_override` tinyint(1) NOT NULL DEFAULT 0,
  `override_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  `branch_id` varchar(36) NOT NULL DEFAULT 'branch-other',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_payroll_item` (`payroll_run_id`,`staff_id`),
  KEY `idx_pi_staff` (`staff_id`),
  KEY `idx_payroll_items_tenant_branch` (`tenant_id`,`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_runs` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `month` tinyint(3) unsigned NOT NULL,
  `year` smallint(5) unsigned NOT NULL,
  `status` enum('DRAFT','CALCULATED','APPROVED','PAID','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `total_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `employee_count` int(11) NOT NULL DEFAULT 0,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `notes` text DEFAULT NULL,
  `calculated_by` varchar(36) DEFAULT NULL,
  `approved_by` varchar(36) DEFAULT NULL,
  `paid_by` varchar(36) DEFAULT NULL,
  `calculated_at` datetime DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  `branch_id` varchar(36) NOT NULL DEFAULT 'branch-other',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_payroll_run` (`month`,`year`),
  KEY `idx_pr_status` (`status`),
  KEY `idx_payroll_runs_tenant_branch` (`tenant_id`,`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `performance_appraisals` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `reviewer_email` varchar(200) DEFAULT NULL,
  `period_month` tinyint(4) NOT NULL COMMENT '1-12',
  `period_year` smallint(6) NOT NULL,
  `kpi_scores` longtext DEFAULT NULL COMMENT 'array of {kpi,target,achieved,score}' CHECK (json_valid(`kpi_scores`)),
  `overall_score` decimal(5,2) DEFAULT NULL COMMENT '0-100',
  `grade` varchar(10) DEFAULT NULL COMMENT 'A/B/C/D',
  `notes` text DEFAULT NULL,
  `status` enum('draft','submitted','approved') NOT NULL DEFAULT 'draft',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_pa_staff` (`staff_id`),
  KEY `idx_pa_period` (`period_year`,`period_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `physical_checkins` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `branch_id` varchar(100) DEFAULT NULL,
  `source` varchar(60) NOT NULL DEFAULT 'manual',
  `checked_in_at` datetime NOT NULL DEFAULT current_timestamp(),
  `checked_in_by` varchar(255) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_physical_checkins_subscriber` (`subscriber_id`,`checked_in_at`),
  KEY `idx_physical_checkins_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `physical_classrooms` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `branch_id` varchar(100) DEFAULT NULL,
  `name` varchar(200) NOT NULL,
  `capacity` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_physical_classrooms_branch` (`branch_id`),
  KEY `idx_physical_classrooms_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `promo_codes` (
  `id` varchar(36) NOT NULL,
  `code` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `discount_type` enum('percent','fixed') NOT NULL DEFAULT 'percent',
  `discount_value` decimal(10,2) NOT NULL DEFAULT 0.00,
  `min_order_amount` decimal(10,2) DEFAULT 0.00,
  `max_uses` int(11) DEFAULT NULL,
  `used_count` int(11) NOT NULL DEFAULT 0,
  `expires_at` datetime DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `idx_promo_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `push_subscriptions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `user_uid` varchar(100) DEFAULT NULL,
  `subscriber_id` varchar(36) DEFAULT NULL,
  `endpoint_hash` char(64) NOT NULL,
  `subscription_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`subscription_json`)),
  `user_agent` varchar(500) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `last_sent_at` datetime DEFAULT NULL,
  `last_error` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_push_endpoint_hash` (`endpoint_hash`),
  KEY `idx_push_subscriber` (`subscriber_id`),
  KEY `idx_push_uid` (`user_uid`),
  KEY `idx_push_active` (`is_active`),
  KEY `idx_push_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `queue_jobs` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `queue_name` varchar(120) NOT NULL,
  `job_name` varchar(160) NOT NULL,
  `status` enum('pending','processing','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  `priority` int(11) NOT NULL DEFAULT 0,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `max_attempts` int(11) NOT NULL DEFAULT 3,
  `payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload_json`)),
  `error_message` text DEFAULT NULL,
  `run_after` datetime DEFAULT NULL,
  `locked_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_queue_jobs_pickup` (`queue_name`,`status`,`priority`,`run_after`,`created_at`),
  KEY `idx_queue_jobs_tenant_status` (`tenant_id`,`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `quiz_attempts` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `subscriber_id` varchar(36) NOT NULL,
  `course_id` varchar(36) NOT NULL,
  `quiz_id` varchar(36) NOT NULL,
  `answers_json` text NOT NULL,
  `score` double NOT NULL,
  `passed` tinyint(1) NOT NULL,
  `taken_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_qa_subscriber` (`subscriber_id`),
  KEY `idx_qa_quiz` (`quiz_id`),
  KEY `fk_qa_course` (`course_id`),
  CONSTRAINT `fk_qa_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qa_quiz` FOREIGN KEY (`quiz_id`) REFERENCES `course_quizzes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qa_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `recurring_expenses` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `title` varchar(200) NOT NULL,
  `amount_egp` decimal(12,2) NOT NULL,
  `category` varchar(100) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `frequency` enum('monthly','quarterly','yearly') DEFAULT 'monthly',
  `day_of_month` tinyint(4) DEFAULT 1,
  `is_active` tinyint(1) DEFAULT 1,
  `last_run` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `created_by` varchar(200) DEFAULT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  PRIMARY KEY (`id`),
  KEY `idx_recurring_expenses_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `referral_codes` (
  `id` varchar(36) NOT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `code` varchar(20) NOT NULL,
  `uses` int(11) NOT NULL DEFAULT 0,
  `earnings` decimal(10,2) NOT NULL DEFAULT 0.00,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `subscriber_id` (`subscriber_id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `refund_requests` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
  `branch_id` varchar(36) DEFAULT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `payment_id` varchar(100) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `currency` varchar(10) DEFAULT 'EGP',
  `reason` text DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  `admin_note` text DEFAULT NULL,
  `refund_method` varchar(100) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `resolved_at` datetime DEFAULT NULL,
  `resolved_by` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_subscriber` (`subscriber_id`),
  KEY `idx_status` (`status`),
  KEY `idx_refunds_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_refund_status_created` (`status`,`created_at`),
  KEY `idx_refund_payment` (`payment_id`),
  KEY `idx_refund_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `refunds` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'mahad',
  `payment_id` varchar(100) DEFAULT NULL,
  `subscriber_id` varchar(64) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'EGP',
  `reason` varchar(500) DEFAULT NULL,
  `status` enum('requested','approved','rejected','done') NOT NULL DEFAULT 'requested',
  `requested_by` varchar(120) DEFAULT NULL,
  `approved_by` varchar(120) DEFAULT NULL,
  `journal_posted` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `resolved_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_refund_payment` (`payment_id`),
  KEY `idx_refund_status` (`tenant_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reminder_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` enum('followup','payment_due') NOT NULL,
  `ref_id` varchar(64) NOT NULL,
  `sent_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_type_ref_day` (`type`,`ref_id`,`sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `retargeting_log` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `lead_id` varchar(36) NOT NULL,
  `channel` enum('WHATSAPP','EMAIL') NOT NULL,
  `template` varchar(100) NOT NULL,
  `status` enum('SENT','FAILED') NOT NULL DEFAULT 'SENT',
  `error` text DEFAULT NULL,
  `sent_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_retarget_lead` (`lead_id`),
  CONSTRAINT `fk_retarget_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_plans` (
  `id` varchar(36) NOT NULL,
  `plan_key` varchar(120) NOT NULL,
  `name` varchar(255) NOT NULL,
  `billing_cycle` enum('monthly','quarterly','yearly','custom') NOT NULL DEFAULT 'monthly',
  `base_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `currency` varchar(10) NOT NULL DEFAULT 'EGP',
  `feature_limits_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`feature_limits_json`)),
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_saas_plans_key` (`plan_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_advances` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `reason` text DEFAULT NULL,
  `status` enum('PENDING','APPROVED','DEDUCTED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `deduct_month` tinyint(3) unsigned DEFAULT NULL,
  `deduct_year` smallint(5) unsigned DEFAULT NULL,
  `approved_by` varchar(36) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_advances_staff` (`staff_id`),
  KEY `idx_adv_staff_month` (`staff_id`,`deduct_month`,`deduct_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `salary_structures` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `base_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `housing_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `transport_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `other_allowances_json` longtext DEFAULT NULL CHECK (json_valid(`other_allowances_json`)),
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `food_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `other_fixed` decimal(10,2) NOT NULL DEFAULT 0.00,
  `deduction_social_insurance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `deduction_tax` decimal(10,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `idx_salary_staff` (`staff_id`),
  KEY `idx_salary_effective` (`staff_id`,`effective_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_goals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period` varchar(7) NOT NULL COMMENT 'YYYY-MM',
  `revenue_target` decimal(12,2) DEFAULT 0.00,
  `leads_target` int(11) DEFAULT 0,
  `conversions_target` int(11) DEFAULT 0,
  `new_clients_target` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_period` (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_targets` (
  `staff_id` varchar(64) NOT NULL,
  `period` varchar(7) NOT NULL COMMENT 'YYYY-MM',
  `revenue_target` decimal(12,2) DEFAULT 0.00,
  `leads_target` int(11) DEFAULT 0,
  `updated_by` varchar(64) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`staff_id`,`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `version` varchar(255) NOT NULL,
  `checksum` varchar(32) DEFAULT NULL,
  `status` varchar(16) DEFAULT 'applied',
  `applied_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `site_config` (
  `key` varchar(100) NOT NULL,
  `value` longtext DEFAULT NULL,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sla_rules` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `priority` enum('LOW','MEDIUM','HIGH','URGENT') NOT NULL,
  `first_response_hours` smallint(6) NOT NULL DEFAULT 24,
  `resolution_hours` smallint(6) NOT NULL DEFAULT 72,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sla_priority` (`priority`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sms_campaigns` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `title` varchar(500) NOT NULL,
  `message` text NOT NULL,
  `audience` enum('all','subscribers','leads','manual') NOT NULL DEFAULT 'all',
  `audience_filter` longtext DEFAULT NULL CHECK (json_valid(`audience_filter`)),
  `status` enum('draft','sending','sent','failed') NOT NULL DEFAULT 'draft',
  `sent_count` int(11) NOT NULL DEFAULT 0,
  `fail_count` int(11) NOT NULL DEFAULT 0,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `created_by` varchar(36) DEFAULT NULL,
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sms_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `provider` varchar(50) DEFAULT 'vonage' COMMENT 'vonage|infobip|custom',
  `api_key` varchar(255) DEFAULT '',
  `api_secret` varchar(255) DEFAULT '',
  `sender_id` varchar(50) DEFAULT 'MAHAD',
  `is_active` tinyint(4) DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `firebase_uid` varchar(128) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `role` enum('INSTRUCTOR','TRAINER','EXPERT','SALES','MANAGER','ADMIN','SUPPORT','RECEPTION_DAQQI','COLLECTION','ACCOUNTANT','CONSULTANT','OTHER','ONLINE_MANAGER','DAQQI_MANAGER','SALES_COLLECTION_MANAGER','HR') NOT NULL,
  `image` text DEFAULT NULL,
  `specialization` varchar(255) DEFAULT NULL,
  `joined_at` datetime NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `notes` text DEFAULT NULL,
  `commission_rate` decimal(5,2) DEFAULT NULL,
  `permissions_json` text DEFAULT NULL,
  `totp_secret` varchar(64) DEFAULT NULL,
  `totp_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `monthly_target` decimal(12,2) DEFAULT NULL,
  `monthly_target_type` varchar(10) DEFAULT NULL,
  `monthly_leads_target` int(11) DEFAULT NULL,
  `monthly_bonus` decimal(12,2) DEFAULT NULL,
  `preferences_json` text DEFAULT NULL,
  `department_id` varchar(36) DEFAULT NULL,
  `manager_id` varchar(36) DEFAULT NULL,
  `employment_type` enum('FULL_TIME','PART_TIME','CONTRACT','FREELANCE') NOT NULL DEFAULT 'FULL_TIME',
  `hire_date` date DEFAULT NULL,
  `birth_date` date DEFAULT NULL,
  `bank_name` varchar(255) DEFAULT NULL,
  `termination_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_staff_email` (`email`),
  UNIQUE KEY `idx_staff_firebase_uid` (`firebase_uid`),
  KEY `idx_staff_tenant` (`tenant_id`),
  KEY `idx_staff_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_kpis` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `period` varchar(7) NOT NULL COMMENT 'YYYY-MM',
  `metric` varchar(100) NOT NULL COMMENT 'e.g. leads_converted, calls_made, nps_score',
  `value` double NOT NULL DEFAULT 0,
  `target` double DEFAULT NULL,
  `note` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kpi` (`staff_id`,`period`,`metric`),
  KEY `idx_kpi_staff` (`staff_id`),
  KEY `idx_kpi_period` (`period`),
  CONSTRAINT `fk_kpi_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscriber_subscriptions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `subscriber_id` varchar(36) NOT NULL,
  `plan_id` int(11) NOT NULL,
  `status` enum('active','paused','cancelled','expired') DEFAULT 'active',
  `start_date` date NOT NULL,
  `next_billing_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `auto_renew` tinyint(4) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_next_billing` (`next_billing_date`),
  KEY `idx_subscriber` (`subscriber_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscribers` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `firebase_uid` varchar(128) DEFAULT NULL,
  `client_code` varchar(50) DEFAULT NULL,
  `lead_id` varchar(100) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `name_en` varchar(255) DEFAULT NULL,
  `name_ar` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `national_id` varchar(50) DEFAULT NULL,
  `whatsapp` varchar(50) DEFAULT NULL,
  `nationality` enum('EGYPTIAN','NON_EGYPTIAN_EGYPT','SAUDI_RESIDENT','INTERNATIONAL') DEFAULT NULL,
  `branch` enum('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT 'ONLINE_EGYPT',
  `assigned_sales_id` varchar(36) DEFAULT NULL,
  `assigned_sales_name` varchar(255) DEFAULT NULL,
  `assigned_cs_id` varchar(36) DEFAULT NULL,
  `assigned_cs_name` varchar(255) DEFAULT NULL,
  `discount` decimal(12,2) DEFAULT NULL,
  `loyalty_points` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `notes` text DEFAULT NULL,
  `course_access_json` longtext DEFAULT NULL,
  `lecture_progress_json` longtext DEFAULT NULL,
  `expected_totals_json` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `branch_id` varchar(36) DEFAULT 'branch-online-egypt',
  `deleted_at` timestamp NULL DEFAULT NULL,
  `crm_json` longtext DEFAULT NULL,
  `referred_by` varchar(20) DEFAULT NULL,
  `client_type` varchar(50) DEFAULT NULL,
  `is_unsubscribed` tinyint(1) NOT NULL DEFAULT 0,
  `unsubscribed_at` timestamp NULL DEFAULT NULL,
  `source` varchar(120) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_subscribers_firebase_uid` (`firebase_uid`),
  UNIQUE KEY `uq_subs_code` (`client_code`),
  UNIQUE KEY `uq_subs_phone` (`phone`),
  UNIQUE KEY `uq_subs_email` (`email`(191)),
  KEY `idx_subscribers_created_at` (`created_at`),
  KEY `idx_subscribers_tenant` (`tenant_id`),
  KEY `idx_subscribers_deleted` (`deleted_at`),
  KEY `idx_subscribers_assigned_sales` (`assigned_sales_id`),
  KEY `idx_subscribers_assigned_cs` (`assigned_cs_id`),
  KEY `idx_branch` (`branch`),
  KEY `idx_subscribers_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_subscribers_unsubscribed` (`is_unsubscribed`),
  KEY `idx_subs_active` (`is_active`),
  KEY `idx_subs_sales` (`assigned_sales_id`),
  KEY `idx_subs_phone` (`phone`(20)),
  KEY `idx_subs_cs_id` (`assigned_cs_id`),
  KEY `idx_subscribers_source` (`source`),
  KEY `idx_subscribers_tenant_created_id` (`tenant_id`,`created_at`,`id`),
  KEY `idx_subscribers_tenant_branch_created` (`tenant_id`,`branch_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscription_plans` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `billing_cycle` enum('monthly','quarterly','yearly') DEFAULT 'monthly',
  `description` text DEFAULT NULL,
  `is_active` tinyint(4) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscriptions` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'mahad',
  `subscriber_id` varchar(64) NOT NULL,
  `course_id` varchar(64) DEFAULT NULL,
  `bundle_id` varchar(64) DEFAULT NULL,
  `status` enum('active','suspended','completed','cancelled') NOT NULL DEFAULT 'active',
  `total_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `currency` varchar(8) NOT NULL DEFAULT 'EGP',
  `started_at` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_sub_tenant` (`tenant_id`),
  KEY `idx_sub_subscriber` (`subscriber_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `support_messages` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `ticket_id` varchar(36) NOT NULL,
  `author_type` enum('subscriber','staff','system') NOT NULL DEFAULT 'staff',
  `author_name` varchar(255) DEFAULT NULL,
  `body` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_sm_ticket` (`ticket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `support_tickets` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `ticket_code` varchar(20) DEFAULT NULL,
  `subscriber_id` varchar(36) DEFAULT NULL,
  `subscriber_email` varchar(255) DEFAULT NULL,
  `subscriber_name` varchar(255) DEFAULT NULL,
  `lead_id` varchar(36) DEFAULT NULL,
  `subject` varchar(500) NOT NULL,
  `body` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `channel` varchar(50) DEFAULT 'system',
  `priority` varchar(50) NOT NULL DEFAULT 'medium',
  `status` varchar(50) NOT NULL DEFAULT 'open',
  `assigned_to_id` varchar(36) DEFAULT NULL,
  `assigned_to_name` varchar(255) DEFAULT NULL,
  `assigned_to` varchar(36) DEFAULT NULL,
  `sla_due_at` datetime DEFAULT NULL,
  `first_response_at` datetime DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `resolution_note` text DEFAULT NULL,
  `tags_json` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  `branch_id` varchar(36) DEFAULT NULL,
  `category` varchar(40) NOT NULL DEFAULT 'general' COMMENT 'billing|technical|complaint|refund|course_access|sales_inquiry|consultation|certificate|general',
  `department` varchar(40) DEFAULT NULL COMMENT 'resolved routing dept: support|collection|accounting|sales|instruction|management|daqqi',
  `source_type` varchar(30) DEFAULT NULL COMMENT 'origin entity: contact_message|payment|enrollment|lead|subscriber',
  `source_id` varchar(100) DEFAULT NULL,
  `first_response_by` varchar(36) DEFAULT NULL,
  `escalated_at` datetime DEFAULT NULL,
  `closed_reason` varchar(255) DEFAULT NULL,
  `responded_at` datetime DEFAULT NULL,
  `sla_breached` tinyint(1) DEFAULT 0,
  `escalated_to` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_code` (`ticket_code`),
  KEY `idx_ticket_status` (`status`),
  KEY `idx_ticket_sla` (`sla_due_at`),
  KEY `idx_ticket_assignee` (`assigned_to_id`),
  KEY `fk_ticket_sub` (`subscriber_id`),
  KEY `fk_ticket_lead` (`lead_id`),
  KEY `idx_support_tickets_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_support_tickets_tenant_status` (`tenant_id`,`status`,`created_at`),
  KEY `idx_support_email_created` (`subscriber_email`,`created_at`),
  CONSTRAINT `fk_ticket_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ticket_sub` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tasks` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `title` varchar(500) NOT NULL,
  `description` text DEFAULT NULL,
  `assigned_to` varchar(36) DEFAULT NULL,
  `assigned_name` varchar(255) DEFAULT NULL,
  `related_sub_id` varchar(36) DEFAULT NULL,
  `related_lead_id` varchar(36) DEFAULT NULL,
  `priority` enum('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  `status` enum('todo','in_progress','done','cancelled') NOT NULL DEFAULT 'todo',
  `due_date` date DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_tasks_assigned` (`assigned_to`),
  KEY `idx_tasks_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_feature_flags` (
  `tenant_id` varchar(64) NOT NULL,
  `flag_key` varchar(100) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`tenant_id`,`flag_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_plans` (
  `tenant_id` varchar(64) NOT NULL,
  `plan_name` varchar(64) NOT NULL DEFAULT 'standard',
  `max_staff` int(11) NOT NULL DEFAULT 1000,
  `max_students` int(11) NOT NULL DEFAULT 1000000,
  `max_courses` int(11) NOT NULL DEFAULT 100000,
  `max_storage_mb` int(11) NOT NULL DEFAULT 1000000,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_settings` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `section` varchar(120) NOT NULL,
  `config_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`config_json`)),
  `is_secret` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_settings_section` (`tenant_id`,`section`),
  CONSTRAINT `fk_tenant_settings_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_subscriptions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `plan_id` varchar(36) DEFAULT NULL,
  `status` enum('trialing','active','past_due','cancelled','expired') NOT NULL DEFAULT 'trialing',
  `starts_at` datetime DEFAULT NULL,
  `ends_at` datetime DEFAULT NULL,
  `trial_ends_at` datetime DEFAULT NULL,
  `metadata_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata_json`)),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_tenant_subscriptions_tenant` (`tenant_id`),
  KEY `idx_tenant_subscriptions_plan` (`plan_id`),
  CONSTRAINT `fk_tenant_subscriptions_plan` FOREIGN KEY (`plan_id`) REFERENCES `saas_plans` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tenant_subscriptions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_usage` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(64) NOT NULL,
  `metric` varchar(100) NOT NULL,
  `amount` bigint(20) NOT NULL DEFAULT 1,
  `occurred_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_usage_tenant_metric` (`tenant_id`,`metric`,`occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenants` (
  `id` varchar(36) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `name` varchar(255) NOT NULL,
  `status` enum('active','suspended','archived') NOT NULL DEFAULT 'active',
  `plan_key` varchar(120) DEFAULT NULL,
  `default_locale` varchar(20) NOT NULL DEFAULT 'ar-EG',
  `default_timezone` varchar(80) NOT NULL DEFAULT 'Africa/Cairo',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenants_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `testimonials` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(255) NOT NULL,
  `role` varchar(255) NOT NULL,
  `text` text NOT NULL,
  `image` text NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `therapist_slots` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `therapist_id` varchar(36) NOT NULL,
  `day` varchar(20) NOT NULL,
  `start_time` varchar(10) NOT NULL,
  `end_time` varchar(10) NOT NULL,
  `timezone` varchar(100) NOT NULL,
  `label` varchar(255) DEFAULT NULL,
  `meeting_link` text DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_slots_therapist` (`therapist_id`),
  CONSTRAINT `fk_slots_therapist` FOREIGN KEY (`therapist_id`) REFERENCES `therapists` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `therapists` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(255) NOT NULL,
  `specialty` varchar(255) NOT NULL,
  `image` text NOT NULL,
  `experience` int(11) NOT NULL DEFAULT 0,
  `rating` double NOT NULL DEFAULT 5,
  `title` varchar(255) DEFAULT NULL,
  `bio` text DEFAULT NULL,
  `price_egp` decimal(12,2) NOT NULL DEFAULT 0.00,
  `price_sar` decimal(12,2) NOT NULL DEFAULT 0.00,
  `price_usd` decimal(12,2) NOT NULL DEFAULT 0.00,
  `is_consultation_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `session_duration_minutes` int(11) DEFAULT 60,
  `meeting_provider` enum('ZOOM','GOOGLE_MEET','CUSTOM') DEFAULT NULL,
  `provider_base_url` text DEFAULT NULL,
  `featured` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `show_on_home` tinyint(1) NOT NULL DEFAULT 0,
  `show_on_about` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `languages_json` text DEFAULT NULL,
  `focus_areas_json` text DEFAULT NULL,
  `qualifications_json` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ticket_events` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
  `ticket_id` varchar(36) NOT NULL,
  `event_type` varchar(50) NOT NULL,
  `actor_id` varchar(36) DEFAULT NULL,
  `actor_name` varchar(255) DEFAULT NULL,
  `from_value` varchar(255) DEFAULT NULL,
  `to_value` varchar(255) DEFAULT NULL,
  `detail` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_te_ticket` (`ticket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ticket_replies` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `ticket_id` varchar(36) NOT NULL,
  `author_id` varchar(36) DEFAULT NULL,
  `author_name` varchar(255) NOT NULL,
  `author_type` enum('STAFF','CLIENT') NOT NULL DEFAULT 'STAFF',
  `body` text NOT NULL,
  `is_internal` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_replies_ticket` (`ticket_id`),
  CONSTRAINT `fk_reply_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `token_blacklist` (
  `jti` varchar(36) NOT NULL,
  `expires_at` datetime NOT NULL,
  `revoked_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`jti`),
  KEY `idx_tbl_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` varchar(100) NOT NULL,
  `firebase_uid` varchar(128) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `role` varchar(50) DEFAULT 'user',
  `is_active` tinyint(4) DEFAULT 1,
  `created_at` datetime DEFAULT current_timestamp(),
  `login_count` int(11) DEFAULT 0,
  `last_login` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`(191)),
  KEY `idx_users_firebase` (`firebase_uid`),
  KEY `idx_users_last_login` (`last_login`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `webhooks` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `name` varchar(255) NOT NULL,
  `url` varchar(1000) NOT NULL,
  `secret` varchar(255) DEFAULT NULL,
  `events` longtext NOT NULL DEFAULT '[]' CHECK (json_valid(`events`)),
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `last_triggered_at` datetime DEFAULT NULL,
  `last_status` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `work_schedules` (
  `id` varchar(36) NOT NULL DEFAULT uuid(),
  `staff_id` varchar(36) NOT NULL,
  `day_of_week` tinyint(4) NOT NULL COMMENT '0=Sun 6=Sat',
  `start_time` time NOT NULL DEFAULT '09:00:00',
  `end_time` time NOT NULL DEFAULT '17:00:00',
  `grace_minutes` int(11) NOT NULL DEFAULT 15,
  `is_off_day` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_schedule` (`staff_id`,`day_of_week`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

