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
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `period_label` varchar(20) NOT NULL,
  `opened_at` datetime DEFAULT current_timestamp(),
  `closed_at` datetime DEFAULT NULL,
  `closed_by` varchar(100) DEFAULT NULL,
  `summary_json` text DEFAULT NULL,
  `status` enum('open','closed') DEFAULT 'open',
  `open_guard` tinyint GENERATED ALWAYS AS (case when `status` = 'open' then 1 else NULL end) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_period_tenant_label` (`tenant_id`,`period_label`),
  UNIQUE KEY `uq_period_single_open` (`tenant_id`,`open_guard`),
  KEY `idx_period_tenant_status` (`tenant_id`,`status`,`opened_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_logs` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `action` varchar(50) NOT NULL,
  `entity` varchar(100) NOT NULL,
  `entity_id` varchar(36) DEFAULT NULL,
  `label` text NOT NULL,
  `actor` varchar(255) DEFAULT NULL,
  `at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_activity_logs_tenant_at` (`tenant_id`,`at`),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `leave_id` varchar(36) DEFAULT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_attendance` (`staff_id`,`date`),
  KEY `idx_att_staff` (`staff_id`),
  KEY `idx_att_date` (`date`),
  KEY `idx_att_staff_date` (`staff_id`,`date`)
  ,KEY `idx_attendance_leave` (`tenant_id`,`leave_id`)
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
  `previous_hash` char(64) DEFAULT NULL,
  `event_hash` char(64) DEFAULT NULL,
  `hash_version` tinyint unsigned NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_audit_logs_entity` (`entity_type`,`entity_id`),
  KEY `idx_audit_logs_action` (`action`),
  UNIQUE KEY `uq_audit_logs_tenant_hash` (`tenant_id`,`event_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `audit_chain_heads` (
  `tenant_id` varchar(64) NOT NULL,
  `last_hash` char(64) NOT NULL,
  `event_count` bigint unsigned NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `audit_logs_archive` LIKE `audit_logs`;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `automation_log` (
  `id` varchar(100) NOT NULL,
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
  `workflow_id` varchar(100) DEFAULT NULL,
  `lead_id` varchar(100) DEFAULT NULL,
  `subscriber_id` varchar(100) DEFAULT NULL,
  `action` varchar(100) DEFAULT NULL,
  `triggered_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_al_wf` (`workflow_id`),
  KEY `idx_al_lead` (`lead_id`),
  KEY `idx_automation_log_tenant_triggered` (`tenant_id`,`triggered_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `automation_workflows` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `internal_only` tinyint(1) NOT NULL DEFAULT 0,
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
  `branch` varchar(30) DEFAULT NULL,
  `branch_id` varchar(36) NOT NULL DEFAULT 'branch-all',
  `month` char(7) NOT NULL COMMENT 'YYYY-MM',
  `category` varchar(255) NOT NULL,
  `budgeted_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `currency` char(3) NOT NULL DEFAULT 'EGP',
  `notes` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_budget_tenant_branch` (`tenant_id`,`branch_id`,`month`,`category`),
  KEY `idx_budgets_tenant_branch_month` (`tenant_id`,`branch_id`,`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `bundle_courses` (
  `bundle_id` varchar(36) NOT NULL,
  `course_id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `sort_order` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`bundle_id`,`course_id`),
  KEY `idx_bundle_courses_tenant` (`tenant_id`,`bundle_id`,`sort_order`),
  KEY `fk_bc_course` (`course_id`),
  CONSTRAINT `fk_bc_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bc_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `bundles` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  UNIQUE KEY `uq_bundles_tenant_slug` (`tenant_id`,`slug`),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `subscriber_id` varchar(36) DEFAULT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `type` enum('SOCIAL_SOLIDARITY','AIN_SHAMS','EXPERIENCE_EXTERNAL','PRACTICE_EXTERNAL','NATIONAL_COUNCIL','AMERICAN_BOARD','INSTITUTE','OTHER') NOT NULL,
  `custom_name` varchar(255) DEFAULT NULL,
  `name_ar` varchar(255) DEFAULT NULL,
  `name_en` varchar(255) DEFAULT NULL,
  `nationality` enum('EGYPTIAN','NON_EGYPTIAN_EGYPT','SAUDI_RESIDENT','INTERNATIONAL') DEFAULT NULL,
  `id_number` varchar(50) DEFAULT NULL,
  `status` enum('PENDING','PRICED','PAID','IN_PROGRESS','NOT_SENT','ISSUED','SHIPPED','AT_BRANCH','DELIVERED') NOT NULL DEFAULT 'PENDING',
  `price` decimal(12,2) DEFAULT NULL,
  `paid_amount` decimal(12,2) DEFAULT NULL,
  `currency` enum('EGP','SAR','USD') DEFAULT NULL,
  `note` text DEFAULT NULL,
  `admin_note` text DEFAULT NULL,
  `requested_at` datetime NOT NULL DEFAULT current_timestamp(),
  `issued_at` datetime DEFAULT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `active_request_marker` tinyint(4) GENERATED ALWAYS AS (case when `status` <> 'DELIVERED' then 1 else NULL end) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_certificate_active_request` (`tenant_id`,`subscriber_id`,`course_id`,`type`,`active_request_marker`),
  KEY `idx_cert_subscriber` (`subscriber_id`),
  KEY `fk_cert_course` (`course_id`),
  KEY `idx_cert_req_tenant` (`tenant_id`),
  KEY `idx_certificate_tenant_status_requested` (`tenant_id`,`status`,`requested_at`),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `effective_from` date NOT NULL DEFAULT (curdate()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `lead_id` varchar(36) DEFAULT NULL,
  `subscriber_id` varchar(36) DEFAULT NULL,
  `type` enum('CALL','WHATSAPP','EMAIL','MEETING','NOTE','PAYMENT_FOLLOWUP','NEW_COURSE_SALE','CERTIFICATE','MESSENGER') NOT NULL,
  `direction` enum('OUT','IN') NOT NULL DEFAULT 'OUT' COMMENT 'IN = received from the customer via the WhatsApp webhook',
  `provider_message_id` varchar(128) DEFAULT NULL COMMENT 'Provider id of the inbound message — the idempotency key',
  `channel_id` varchar(36) DEFAULT NULL COMMENT 'messaging_channels.id the message arrived on or was sent from',
  `date` datetime NOT NULL,
  `notes` text NOT NULL,
  `outcome` text DEFAULT NULL,
  `next_follow_up` datetime DEFAULT NULL,
  `staff_id` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comm_tenant_provider_msg` (`tenant_id`,`provider_message_id`),
  KEY `idx_comm_lead` (`lead_id`),
  KEY `idx_comm_subscriber` (`subscriber_id`),
  KEY `idx_comm_tenant_lead_date` (`tenant_id`,`lead_id`,`date`),
  KEY `idx_comm_tenant_subscriber_date` (`tenant_id`,`subscriber_id`,`date`),
  KEY `idx_comm_tenant_direction_date` (`tenant_id`,`direction`,`date`),
  KEY `idx_comm_tenant_staff_date` (`tenant_id`,`staff_id`,`date`),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `client_name` varchar(255) NOT NULL,
  `client_email` varchar(255) DEFAULT NULL,
  `client_phone` varchar(50) DEFAULT NULL,
  `therapist_id` varchar(36) NOT NULL,
  `session_type` enum('INDIVIDUAL','COUPLE','FAMILY') NOT NULL DEFAULT 'INDIVIDUAL',
  `session_date` datetime NOT NULL,
  `slot_id` varchar(36) DEFAULT NULL,
  `timezone` varchar(100) DEFAULT NULL,
  `status` enum('PENDING','CONFIRMED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `notes` text NOT NULL DEFAULT (''),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `subscriber_id` varchar(36) NOT NULL,
  `course_id` varchar(36) NOT NULL,
  `certificate_code` varchar(50) NOT NULL,
  `completed_at` datetime NOT NULL DEFAULT current_timestamp(),
  `status` varchar(24) NOT NULL DEFAULT 'active',
  `version` int(11) NOT NULL DEFAULT 1,
  `revoked_at` datetime DEFAULT NULL,
  `revoked_by` varchar(255) DEFAULT NULL,
  `revoke_reason` varchar(500) DEFAULT NULL,
  `reissued_at` datetime DEFAULT NULL,
  `reissued_by` varchar(255) DEFAULT NULL,
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_comp` (`subscriber_id`,`course_id`),
  UNIQUE KEY `uq_cert_code` (`certificate_code`),
  KEY `idx_coursecomp_sub` (`subscriber_id`),
  KEY `fk_coursecomp_crs` (`course_id`),
  KEY `idx_completions_subscriber` (`subscriber_id`),
  KEY `idx_course_completions_tenant` (`tenant_id`,`subscriber_id`),
  KEY `idx_course_completions_tenant_status` (`tenant_id`,`status`,`completed_at`),
  CONSTRAINT `fk_coursecomp_crs` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_coursecomp_sub` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `community_post_likes` (
  `tenant_id` varchar(64) NOT NULL,
  `post_id` varchar(100) NOT NULL,
  `subscriber_id` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`tenant_id`,`post_id`,`subscriber_id`),
  KEY `idx_community_likes_post` (`tenant_id`,`post_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `community_post_comments` (
  `id` varchar(100) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `post_id` varchar(100) NOT NULL,
  `subscriber_id` varchar(100) NOT NULL,
  `author` varchar(200) NOT NULL,
  `body` varchar(2000) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_community_comments_post` (`tenant_id`,`post_id`,`created_at`),
  KEY `idx_community_comments_subscriber` (`tenant_id`,`subscriber_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `certificate_lifecycle_events` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `completion_id` varchar(36) NOT NULL,
  `event_type` varchar(24) NOT NULL,
  `old_code` varchar(50) DEFAULT NULL,
  `new_code` varchar(50) DEFAULT NULL,
  `actor` varchar(255) DEFAULT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `meta_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`meta_json`)),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_certificate_events_completion` (`tenant_id`,`completion_id`,`created_at`),
  KEY `idx_certificate_events_code` (`tenant_id`,`new_code`),
  CONSTRAINT `fk_certificate_event_completion` FOREIGN KEY (`completion_id`) REFERENCES `course_completions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_lectures` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `course_id` varchar(36) NOT NULL,
  `title` varchar(500) NOT NULL,
  `questions_json` longtext NOT NULL,
  `passing_score` double NOT NULL DEFAULT 70,
  `required_for_completion` tinyint(1) NOT NULL DEFAULT 1,
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `course_code` varchar(50) DEFAULT NULL,
  `slug` varchar(255) DEFAULT NULL,
  `title` varchar(500) NOT NULL,
  `title_en` varchar(500) DEFAULT NULL,
  `title_ar` varchar(500) DEFAULT NULL,
  `description` text NOT NULL,
  `short_description` text NOT NULL,
  `instructor` varchar(255) NOT NULL,
  `instructor_id` varchar(36) DEFAULT NULL,
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
  UNIQUE KEY `uq_courses_tenant_slug` (`tenant_id`,`slug`),
  KEY `idx_courses_published` (`is_published`,`sort_order`),
  KEY `idx_courses_tenant` (`tenant_id`),
  KEY `idx_courses_instructor` (`tenant_id`,`instructor_id`,`deleted_at`),
  KEY `idx_courses_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_cohorts` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `course_id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `starts_at` datetime DEFAULT NULL,
  `ends_at` datetime DEFAULT NULL,
  `max_students` int(10) unsigned DEFAULT NULL,
  `status` varchar(24) NOT NULL DEFAULT 'draft',
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_course_cohorts_course` (`tenant_id`,`course_id`,`status`,`starts_at`),
  CONSTRAINT `fk_course_cohort_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `cohort_members` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `cohort_id` varchar(36) NOT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `status` varchar(24) NOT NULL DEFAULT 'active',
  `enrolled_at` datetime NOT NULL DEFAULT current_timestamp(),
  `removed_at` datetime DEFAULT NULL,
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cohort_member` (`tenant_id`,`cohort_id`,`subscriber_id`),
  KEY `idx_cohort_members_subscriber` (`tenant_id`,`subscriber_id`,`status`),
  CONSTRAINT `fk_cohort_member_cohort` FOREIGN KEY (`cohort_id`) REFERENCES `course_cohorts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cohort_member_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_commissions` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  UNIQUE KEY `uq_commission_payment_staff` (`tenant_id`,`payment_id`,`staff_id`),
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
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `name` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `booked_at` datetime NOT NULL,
  `amount_paid` decimal(12,2) NOT NULL DEFAULT 0.00,
  `attended_lectures` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`round_id`,`subscriber_id`),
  KEY `idx_daqqi_attendees_round` (`round_id`),
  KEY `idx_daqqi_attendees_subscriber` (`subscriber_id`),
  KEY `idx_daqqi_attendees_tenant_round` (`tenant_id`,`round_id`),
  CONSTRAINT `fk_att_round` FOREIGN KEY (`round_id`) REFERENCES `daqqi_rounds` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_att_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `daqqi_rounds` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  UNIQUE KEY `uq_daqqi_rounds_tenant_code` (`tenant_id`,`code`),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `name` varchar(500) NOT NULL,
  `trigger_event` varchar(255) NOT NULL DEFAULT 'subscription_created' COMMENT 'subscription_created|lead_status:interested|consultation_completed|payment_received',
  `audience` enum('subscribers','leads','all') NOT NULL DEFAULT 'subscribers',
  `status` enum('active','paused','draft') NOT NULL DEFAULT 'draft',
  `enrolled_count` int(11) NOT NULL DEFAULT 0,
  `completed_count` int(11) NOT NULL DEFAULT 0,
  `steps` longtext NOT NULL DEFAULT ('[]') CHECK (json_valid(`steps`)),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
  `sequence_id` varchar(36) NOT NULL,
  `lead_id` varchar(36) DEFAULT NULL,
  `subscriber_id` varchar(100) DEFAULT NULL,
  `email` varchar(200) NOT NULL,
  `status` enum('active','paused','completed','unenrolled','failed','unsubscribed') NOT NULL DEFAULT 'active',
  `sequence_version` int(11) NOT NULL DEFAULT 1,
  `steps_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`steps_snapshot`)),
  `enrolled_by` varchar(200) DEFAULT NULL,
  `current_step` int(11) DEFAULT 0,
  `started_at` timestamp NULL DEFAULT current_timestamp(),
  `next_send_at` timestamp NULL DEFAULT NULL,
  `paused_at` datetime DEFAULT NULL,
  `pause_reason` varchar(500) DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `unsubscribed_at` timestamp NULL DEFAULT NULL,
  `unenrolled_at` datetime DEFAULT NULL,
  `exit_reason` varchar(100) DEFAULT NULL,
  `last_activity_at` datetime DEFAULT NULL,
  `retry_count` int(11) NOT NULL DEFAULT 0,
  `last_error` varchar(500) DEFAULT NULL,
  `failed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_drip_next` (`next_send_at`),
  KEY `idx_drip_seq` (`sequence_id`),
  KEY `idx_drip_enrollments_tenant_due` (`tenant_id`,`next_send_at`,`failed_at`),
  KEY `idx_drip_enrollments_tenant_status_due` (`tenant_id`,`status`,`next_send_at`),
  KEY `idx_drip_enrollments_tenant_lead_status` (`tenant_id`,`lead_id`,`status`),
  KEY `idx_drip_enrollments_tenant_subscriber_status` (`tenant_id`,`subscriber_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `drip_sequences` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
  `name` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `trigger_status` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `steps` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Array of {delay_days, subject, body_html}' CHECK (json_valid(`steps`)),
  `version` int(11) NOT NULL DEFAULT 1,
  `timezone` varchar(64) NOT NULL DEFAULT 'Africa/Cairo',
  `exit_on_reply` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `created_by` varchar(200) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `updated_by` varchar(200) DEFAULT NULL,
  `archived_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_drip_sequences_tenant` (`tenant_id`,`created_at`),
  KEY `idx_drip_sequences_tenant_active` (`tenant_id`,`archived_at`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_sequence_step_executions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `enrollment_id` varchar(36) NOT NULL,
  `sequence_id` varchar(36) NOT NULL,
  `sequence_version` int(11) NOT NULL,
  `step_index` int(11) NOT NULL,
  `channel` enum('email','whatsapp','task') NOT NULL DEFAULT 'email',
  `status` enum('queued','sent','delivered','failed','skipped') NOT NULL DEFAULT 'queued',
  `due_at` datetime DEFAULT NULL,
  `dedupe_key` varchar(191) NOT NULL,
  `provider_message_id` varchar(191) DEFAULT NULL,
  `last_error` varchar(1000) DEFAULT NULL,
  `queued_at` datetime DEFAULT current_timestamp(),
  `sent_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_sequence_step` (`tenant_id`,`enrollment_id`,`step_index`),
  UNIQUE KEY `uq_crm_sequence_dedupe` (`dedupe_key`),
  KEY `idx_crm_sequence_execution_status` (`tenant_id`,`status`,`due_at`),
  CONSTRAINT `fk_crm_sequence_execution_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `drip_enrollments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_quotes` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `quote_number` varchar(40) NOT NULL,
  `lead_id` varchar(36) NOT NULL,
  `subscriber_id` varchar(36) DEFAULT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `status` enum('draft','pending_approval','approved','sent','accepted','rejected','expired','converted','cancelled') NOT NULL DEFAULT 'draft',
  `valid_until` date NOT NULL,
  `subtotal` decimal(14,2) NOT NULL DEFAULT 0.00,
  `discount_percent` decimal(5,2) NOT NULL DEFAULT 0.00,
  `discount_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `tax_percent` decimal(5,2) NOT NULL DEFAULT 0.00,
  `tax_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `total` decimal(14,2) NOT NULL DEFAULT 0.00,
  `approval_required` tinyint(1) NOT NULL DEFAULT 0,
  `approval_level` enum('none','manager','executive') NOT NULL DEFAULT 'none',
  `approval_policy_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`approval_policy_snapshot`)),
  `notes` text DEFAULT NULL,
  `terms` text DEFAULT NULL,
  `created_by` varchar(200) NOT NULL,
  `updated_by` varchar(200) DEFAULT NULL,
  `approved_by` varchar(200) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `accepted_at` datetime DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `converted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_quote_number` (`tenant_id`,`quote_number`),
  KEY `idx_crm_quotes_lead` (`tenant_id`,`lead_id`,`created_at`),
  KEY `idx_crm_quotes_status_validity` (`tenant_id`,`status`,`valid_until`),
  KEY `idx_crm_quotes_approval_queue` (`tenant_id`,`status`,`approval_level`,`created_at`),
  CONSTRAINT `chk_crm_quote_totals` CHECK (`subtotal` >= 0 and `discount_percent` between 0 and 100 and `discount_amount` >= 0 and `tax_percent` between 0 and 100 and `tax_amount` >= 0 and `total` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_quote_items` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `quote_id` varchar(36) NOT NULL,
  `item_type` enum('course','bundle') NOT NULL,
  `item_id` varchar(36) NOT NULL,
  `description` varchar(500) NOT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT 1.00,
  `unit_price` decimal(14,2) NOT NULL,
  `line_subtotal` decimal(14,2) NOT NULL,
  `catalog_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`catalog_snapshot`)),
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_quote_item` (`tenant_id`,`quote_id`,`item_type`,`item_id`),
  KEY `idx_crm_quote_items_quote` (`tenant_id`,`quote_id`,`sort_order`),
  CONSTRAINT `fk_crm_quote_item_quote` FOREIGN KEY (`quote_id`) REFERENCES `crm_quotes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_crm_quote_item_amounts` CHECK (`quantity` > 0 and `unit_price` >= 0 and `line_subtotal` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_quote_approvals` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `quote_id` varchar(36) NOT NULL,
  `decision` enum('requested','approved','rejected') NOT NULL,
  `actor_id` varchar(200) NOT NULL,
  `note` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_crm_quote_approvals` (`tenant_id`,`quote_id`,`created_at`),
  CONSTRAINT `fk_crm_quote_approval_quote` FOREIGN KEY (`quote_id`) REFERENCES `crm_quotes` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_quote_orders` (
  `tenant_id` varchar(64) NOT NULL,
  `quote_id` varchar(36) NOT NULL,
  `quote_item_id` varchar(36) NOT NULL,
  `order_id` varchar(36) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`tenant_id`,`quote_id`,`quote_item_id`),
  UNIQUE KEY `uq_crm_quote_order` (`tenant_id`,`order_id`),
  CONSTRAINT `fk_crm_quote_order_quote` FOREIGN KEY (`quote_id`) REFERENCES `crm_quotes` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_crm_quote_order_item` FOREIGN KEY (`quote_item_id`) REFERENCES `crm_quote_items` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `connector_events` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `provider` varchar(40) NOT NULL,
  `external_event_id` varchar(191) NOT NULL,
  `payload_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload_json`)),
  `status` enum('pending','processing','processed','failed','dead') NOT NULL DEFAULT 'pending',
  `attempts` int(11) NOT NULL DEFAULT 0,
  `next_attempt_at` datetime NOT NULL DEFAULT current_timestamp(),
  `locked_at` datetime DEFAULT NULL,
  `locked_by` varchar(100) DEFAULT NULL,
  `last_error` varchar(2000) DEFAULT NULL,
  `received_at` datetime NOT NULL DEFAULT current_timestamp(),
  `processed_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_connector_external_event` (`tenant_id`,`provider`,`external_event_id`),
  KEY `idx_connector_event_due` (`status`,`next_attempt_at`),
  KEY `idx_connector_event_health` (`tenant_id`,`provider`,`status`,`received_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_communication_evidence` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `communication_id` varchar(36) NOT NULL,
  `evidence_type` enum('recording','transcript','email','whatsapp','note') NOT NULL,
  `evidence_url` varchar(2000) DEFAULT NULL,
  `content_text` mediumtext DEFAULT NULL,
  `content_sha256` char(64) NOT NULL,
  `captured_by` varchar(200) NOT NULL,
  `captured_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_communication_evidence_hash` (`tenant_id`,`communication_id`,`content_sha256`),
  KEY `idx_crm_communication_evidence` (`tenant_id`,`communication_id`,`captured_at`),
  CONSTRAINT `fk_crm_evidence_communication` FOREIGN KEY (`communication_id`) REFERENCES `communications` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_crm_evidence_content` CHECK (`evidence_url` is not null or `content_text` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_coaching_reviews` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `communication_id` varchar(36) NOT NULL,
  `evidence_id` varchar(36) NOT NULL,
  `staff_id` varchar(36) NOT NULL,
  `reviewer_id` varchar(200) NOT NULL,
  `discovery_score` tinyint unsigned NOT NULL,
  `empathy_score` tinyint unsigned NOT NULL,
  `accuracy_score` tinyint unsigned NOT NULL,
  `next_step_score` tinyint unsigned NOT NULL,
  `total_score` decimal(5,2) NOT NULL,
  `comments` varchar(2000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_coaching_review` (`tenant_id`,`communication_id`,`reviewer_id`),
  KEY `idx_crm_coaching_staff` (`tenant_id`,`staff_id`,`created_at`),
  CONSTRAINT `fk_crm_coaching_communication` FOREIGN KEY (`communication_id`) REFERENCES `communications` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_crm_coaching_evidence` FOREIGN KEY (`evidence_id`) REFERENCES `crm_communication_evidence` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_crm_coaching_scores` CHECK (`discovery_score` between 0 and 5 and `empathy_score` between 0 and 5 and `accuracy_score` between 0 and 5 and `next_step_score` between 0 and 5 and `total_score` between 0 and 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_campaigns` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `staff_id` varchar(36) NOT NULL,
  `type` enum('bonus','deduction') DEFAULT 'bonus',
  `amount` decimal(12,2) NOT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `currency` enum('EGP','SAR','USD') DEFAULT 'EGP',
  `reason` text DEFAULT NULL,
  `for_month` tinyint(3) unsigned DEFAULT NULL,
  `for_year` smallint(5) unsigned DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `approved_by` varchar(100) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_bonuses_staff` (`staff_id`),
  KEY `idx_bonuses_period` (`for_year`,`for_month`)
  ,KEY `idx_bonuses_status` (`tenant_id`,`status`,`for_year`,`for_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_documents` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `staff_id` varchar(36) NOT NULL,
  `template_id` varchar(36) DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT current_timestamp(),
  `completed_at` timestamp NULL DEFAULT NULL,
  `status` enum('in_progress','completed','cancelled') DEFAULT 'in_progress',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee_onboarding_tenant_id` (`tenant_id`,`id`),
  KEY `idx_employee_onboarding_tenant` (`tenant_id`,`staff_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_onboarding_items` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `onboarding_id` varchar(36) NOT NULL,
  `task_title` varchar(300) NOT NULL,
  `category` varchar(50) DEFAULT 'other',
  `due_date` date DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `completed_by` varchar(36) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `sort_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_onboarding_items_tenant` (`tenant_id`,`onboarding_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `enrollments` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `subscriber_id` varchar(36) NOT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `bundle_id` varchar(36) DEFAULT NULL,
  `enrolled_at` datetime NOT NULL,
  `expiry_date` datetime DEFAULT NULL,
  `access_type` varchar(20) NOT NULL DEFAULT 'full',
  `status` varchar(24) NOT NULL DEFAULT 'active',
  `entitlement_source` varchar(64) DEFAULT NULL,
  `granted_by` varchar(255) DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `revoked_by` varchar(255) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
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
  KEY `idx_enrollments_tenant_status` (`tenant_id`,`status`,`subscriber_id`,`course_id`),
  CONSTRAINT `fk_enroll_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_enroll_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_enroll_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `expenses` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `scope_tenant_key` varchar(36) NOT NULL DEFAULT '__global__',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_feature_flags_tenant_key` (`tenant_id`,`flag_key`),
  UNIQUE KEY `uq_feature_flags_scope_key` (`scope_tenant_key`,`flag_key`),
  KEY `idx_feature_flags_key` (`flag_key`),
  CONSTRAINT `chk_feature_flags_scope` CHECK (((`tenant_id` is null) and (`scope_tenant_key` = '__global__')) or ((`tenant_id` is not null) and (`scope_tenant_key` = `tenant_id`))),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `payment_ids` json DEFAULT NULL COMMENT 'parallel array to installment_amounts — payments.id created for each paid entry, null if unpaid',
  `paid_amounts` json DEFAULT NULL COMMENT 'parallel array to installment_amounts — actual amount collected per entry, may differ from scheduled amount',
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `staff_id` varchar(36) NOT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `source_payment_id` varchar(100) DEFAULT NULL,
  `daqqi_round_id` varchar(36) DEFAULT NULL,
  `fee_type` enum('lecture','training','consultation','fixed') NOT NULL DEFAULT 'lecture',
  `hours` decimal(5,2) DEFAULT NULL,
  `rate_per_hour` decimal(10,2) DEFAULT NULL,
  `fixed_amount` decimal(10,2) DEFAULT NULL,
  `total_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `period_month` tinyint(3) unsigned DEFAULT NULL,
  `period_year` smallint(5) unsigned DEFAULT NULL,
  `status` enum('pending','approved','rejected','included_in_payroll','paid') NOT NULL DEFAULT 'pending',
  `note` text DEFAULT NULL,
  `created_by` varchar(36) DEFAULT NULL,
  `approved_by` varchar(100) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `paid_by` varchar(100) DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `payroll_run_id` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_if_staff` (`staff_id`),
  KEY `idx_if_course` (`course_id`),
  UNIQUE KEY `uq_instructor_fee_payment` (`tenant_id`,`source_payment_id`),
  KEY `idx_if_period` (`period_year`,`period_month`),
  KEY `idx_if_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `instructor_rates` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `source` varchar(30) NOT NULL DEFAULT 'manual' COMMENT 'manual|website',
  `source_id` varchar(36) DEFAULT NULL COMMENT 'join_us_applications.id when source=website',
  `specialty` varchar(255) DEFAULT NULL,
  `applicant_type` varchar(30) DEFAULT NULL COMMENT 'INSTRUCTOR|CONSULTANT|EMPLOYEE',
  `linkedin` varchar(300) DEFAULT NULL,
  `hired_staff_id` varchar(36) DEFAULT NULL COMMENT 'staff.id created when applicant is hired',
  `interview_rating` tinyint(4) DEFAULT NULL COMMENT '1-5, set at or after the interview stage',
  PRIMARY KEY (`id`),
  KEY `idx_applicants_source` (`source`,`source_id`),
  UNIQUE KEY `uq_job_applicants_tenant_id` (`tenant_id`,`id`),
  KEY `idx_applicants_stage` (`stage`),
  KEY `idx_job_applicants_tenant_stage` (`tenant_id`,`stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_postings` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `title` varchar(200) NOT NULL,
  `department_id` varchar(36) DEFAULT NULL,
  `branch` varchar(30) DEFAULT NULL,
  `employment_type` enum('full_time','part_time','contract','intern') DEFAULT 'full_time',
  `description` text DEFAULT NULL,
  `requirements` text DEFAULT NULL,
  `salary_min` decimal(10,2) DEFAULT NULL,
  `salary_max` decimal(10,2) DEFAULT NULL,
  `status` enum('draft','open','closed','filled') DEFAULT 'open',
  `posted_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job_postings_tenant_id` (`tenant_id`,`id`),
  KEY `idx_job_postings_tenant` (`tenant_id`,`status`)
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `branch` varchar(30) DEFAULT NULL,
  `branch_id` varchar(36) DEFAULT NULL,
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
  KEY `idx_journal_ref` (`ref_type`,`ref_id`),
  KEY `idx_journal_tenant_date` (`tenant_id`,`entry_date`),
  KEY `idx_journal_tenant_branch_date` (`tenant_id`,`branch_id`,`entry_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `daqqi_attendance_events` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `round_id` varchar(36) NOT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `session_number` int(11) NOT NULL,
  `status` enum('PRESENT','ABSENT','EXCUSED') NOT NULL DEFAULT 'PRESENT',
  `source` enum('MANUAL','QR','IMPORT') NOT NULL DEFAULT 'MANUAL',
  `marked_by` varchar(36) DEFAULT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `marked_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_daqqi_attendance_event` (`tenant_id`,`round_id`,`subscriber_id`,`session_number`),
  KEY `idx_daqqi_attendance_round_session` (`tenant_id`,`round_id`,`session_number`,`status`),
  KEY `idx_daqqi_attendance_subscriber` (`tenant_id`,`subscriber_id`,`marked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `hr_policy_versions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `version` int unsigned NOT NULL,
  `annual_leave_days` decimal(5,1) NOT NULL DEFAULT 21,
  `sick_leave_days` decimal(5,1) NOT NULL DEFAULT 14,
  `work_days_per_month` decimal(5,2) NOT NULL DEFAULT 26,
  `workday_minutes` smallint unsigned NOT NULL DEFAULT 480,
  `grace_minutes` smallint unsigned NOT NULL DEFAULT 15,
  `overtime_multiplier` decimal(4,2) NOT NULL DEFAULT 1.50,
  `audit_retention_days` int unsigned NOT NULL DEFAULT 2555,
  `weekend_days_json` json NOT NULL,
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `created_by` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hr_policy_version` (`tenant_id`,`version`),
  KEY `idx_hr_policy_effective` (`tenant_id`,`effective_from`,`effective_to`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `journal_entry_lines` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
  `lead_id` varchar(100) NOT NULL,
  `event_type` varchar(80) NOT NULL,
  `description` text DEFAULT NULL,
  `meta_json` text DEFAULT NULL,
  `at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_lt_lead` (`lead_id`),
  KEY `idx_lt_at` (`at`),
  KEY `idx_lead_timeline_tenant_lead_at` (`tenant_id`,`lead_id`,`at`),
  KEY `idx_lead_timeline_tenant_event_at` (`tenant_id`,`event_type`,`at`,`lead_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `leads` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `client_code` varchar(50) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `messenger_psid` varchar(64) DEFAULT NULL COMMENT 'Page-scoped id — the only identifier Messenger gives us',
  `messenger_last_inbound_at` datetime DEFAULT NULL COMMENT 'Drives the 24h reply window: outside it Meta rejects plain text',
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
  `forecast_category` enum('pipeline','best_case','commit') DEFAULT NULL,
  `expected_close_date` date DEFAULT NULL,
  `forecast_probability` decimal(5,2) DEFAULT NULL,
  `forecast_updated_by` varchar(64) DEFAULT NULL,
  `forecast_updated_at` datetime DEFAULT NULL,
  `utm_content` varchar(200) DEFAULT NULL,
  `utm_term` varchar(200) DEFAULT NULL,
  `referral_url` text DEFAULT NULL,
  `client_type` varchar(50) DEFAULT NULL,
  `is_unsubscribed` tinyint(1) NOT NULL DEFAULT 0,
  `unsubscribed_at` timestamp NULL DEFAULT NULL,
  `merged_into_lead_id` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_leads_tenant_client_code` (`tenant_id`,`client_code`),
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
  KEY `idx_leads_tenant_branch_created` (`tenant_id`,`branch_id`,`created_at`),
  KEY `idx_leads_unsubscribed` (`is_unsubscribed`),
  KEY `idx_leads_tenant_hidden_created_id` (`tenant_id`,`hidden`,`created_at`,`id`),
  KEY `idx_leads_tenant_merged` (`tenant_id`,`merged_into_lead_id`),
  KEY `idx_leads_tenant_forecast_close` (`tenant_id`,`expected_close_date`,`forecast_category`,`assigned_sales_id`,`hidden`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `leave_requests` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `policy_id` varchar(36) DEFAULT NULL,
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
  ,KEY `idx_leaves_policy` (`tenant_id`,`policy_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lecture_completions` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `subscriber_id` varchar(36) NOT NULL,
  `lecture_id` varchar(36) NOT NULL,
  `course_id` varchar(36) DEFAULT NULL,
  `progress_pct` double NOT NULL DEFAULT 0,
  `watch_seconds` int(11) NOT NULL DEFAULT 0,
  `note_text` text DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_completion` (`subscriber_id`,`lecture_id`),
  KEY `idx_comp_sub` (`subscriber_id`),
  KEY `idx_comp_course` (`subscriber_id`,`course_id`),
  KEY `idx_lecture_completions_tenant` (`tenant_id`,`subscriber_id`),
  CONSTRAINT `fk_comp_sub` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lecture_progress` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `channel` enum('email','whatsapp','messenger') NOT NULL,
  `channel_id` varchar(36) DEFAULT NULL COMMENT 'messaging_channels.id this was sent from — NULL means the tenant default',
  `provider` varchar(24) DEFAULT NULL,
  `provider_message_id` varchar(191) DEFAULT NULL,
  `delivery_status` varchar(24) DEFAULT NULL,
  `provider_status_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `read_at` datetime DEFAULT NULL,
  `delivery_failed_at` datetime DEFAULT NULL,
  `provider_error` varchar(1000) DEFAULT NULL,
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
  UNIQUE KEY `uq_outbox_provider_message` (`provider`,`provider_message_id`),
  KEY `idx_outbox_due` (`status`,`next_attempt_at`),
  KEY `idx_outbox_delivery_status` (`tenant_id`,`channel`,`delivery_status`,`provider_status_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_broadcasts` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
  `subscriber_id` varchar(100) DEFAULT NULL,
  `recipient_staff_id` varchar(36) DEFAULT NULL,
  `type` varchar(50) NOT NULL DEFAULT 'info',
  `title` varchar(255) DEFAULT NULL,
  `message` text DEFAULT NULL,
  `data_json` text DEFAULT NULL,
  `read_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notifications_created` (`created_at`),
  KEY `idx_notifications_read` (`read_at`),
  KEY `idx_notifications_subscriber` (`subscriber_id`),
  KEY `idx_notifications_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_notifications_tenant_read` (`tenant_id`,`read_at`),
  KEY `idx_notifications_recipient` (`tenant_id`,`recipient_staff_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_reads` (
  `notification_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `viewer_key` varchar(160) NOT NULL,
  `read_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`notification_id`,`tenant_id`,`viewer_key`),
  KEY `idx_notification_reads_viewer` (`tenant_id`,`viewer_key`,`read_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `nps_responses` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `template_id` varchar(36) NOT NULL,
  `title` varchar(300) NOT NULL,
  `description` text DEFAULT NULL,
  `due_days` int(11) DEFAULT 7,
  `category` enum('documents','training','setup','meeting','other') DEFAULT 'other',
  `sort_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_onboarding_tasks_tenant` (`tenant_id`,`template_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `onboarding_templates` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `name` varchar(200) NOT NULL,
  `role` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_onboarding_templates_tenant_id` (`tenant_id`,`id`),
  KEY `idx_onboarding_templates_tenant` (`tenant_id`,`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  KEY `idx_orders_tenant_branch` (`tenant_id`,`branch_id`),
  KEY `idx_orders_tenant_status_created` (`tenant_id`,`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `otp_codes` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `user_id` varchar(36) DEFAULT NULL COMMENT 'NULL until the account exists — a WhatsApp signup code precedes its user',
  `email` varchar(255) NOT NULL,
  `code` char(64) NOT NULL,
  `type` enum('password_reset','2fa','login') NOT NULL DEFAULT 'password_reset',
  `expires_at` datetime NOT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `used` tinyint(1) NOT NULL DEFAULT 0,
  `delivery_status` enum('pending','accepted','failed') NOT NULL DEFAULT 'pending',
  `provider_message_id` varchar(255) DEFAULT NULL,
  `delivery_error_code` varchar(80) DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_otp_user` (`user_id`),
  KEY `idx_otp_email` (`email`),
  KEY `idx_otp_expires` (`expires_at`),
  KEY `idx_otp_tenant_delivery` (`tenant_id`,`type`,`delivery_status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_audit_log` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `payment_id` varchar(100) NOT NULL,
  `action` varchar(80) NOT NULL,
  `old_status` varchar(50) DEFAULT NULL,
  `new_status` varchar(50) DEFAULT NULL,
  `amount` decimal(12,2) DEFAULT NULL,
  `subscriber_id` varchar(64) DEFAULT NULL,
  `actor` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_payment` (`payment_id`),
  KEY `idx_audit_subscriber` (`subscriber_id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_payment_audit_payment_action` (`payment_id`,`action`),
  KEY `idx_payment_audit_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_payment_audit_tenant_payment` (`tenant_id`,`payment_id`)
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
  `used_by_order_id` varchar(36) DEFAULT NULL,
  `created_by` varchar(100) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `branch` varchar(30) DEFAULT NULL,
  `branch_id` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_expires` (`expires_at`),
  KEY `idx_payment_links_tenant` (`tenant_id`),
  KEY `idx_payment_links_tenant_branch_created` (`tenant_id`,`branch_id`,`created_at`),
  KEY `idx_payment_link_redemption` (`tenant_id`,`used_by_order_id`),
  CONSTRAINT `fk_payment_link_order` FOREIGN KEY (`used_by_order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_intents` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `order_id` varchar(36) NOT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `provider` enum('manual','paymob') NOT NULL DEFAULT 'manual',
  `amount` decimal(12,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL,
  `status` enum('created','under_review','paid','failed','cancelled','expired') NOT NULL DEFAULT 'created',
  `idempotency_hash` char(64) NOT NULL,
  `active_order_guard` varchar(36) GENERATED ALWAYS AS (case when `status` in ('created','under_review') then `order_id` else NULL end) STORED,
  `payment_id` varchar(100) DEFAULT NULL,
  `failure_code` varchar(80) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `created_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payment_intent_idempotency` (`tenant_id`,`idempotency_hash`),
  UNIQUE KEY `uq_payment_intent_active_order` (`tenant_id`,`active_order_guard`),
  KEY `idx_payment_intent_subscriber` (`tenant_id`,`subscriber_id`,`created_at`),
  KEY `idx_payment_intent_status` (`tenant_id`,`status`,`expires_at`),
  KEY `fk_payment_intent_order` (`order_id`),
  CONSTRAINT `fk_payment_intent_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_payment_intent_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_attempts` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `intent_id` varchar(36) NOT NULL,
  `attempt_no` smallint(5) unsigned NOT NULL,
  `provider` enum('manual','paymob') NOT NULL DEFAULT 'manual',
  `status` enum('initialized','proof_submitted','succeeded','failed','cancelled','expired') NOT NULL,
  `proof_id` varchar(100) DEFAULT NULL,
  `payment_id` varchar(100) DEFAULT NULL,
  `safe_reference` varchar(191) DEFAULT NULL,
  `error_code` varchar(80) DEFAULT NULL,
  `metadata_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata_json`)),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payment_attempt_number` (`tenant_id`,`intent_id`,`attempt_no`),
  UNIQUE KEY `uq_payment_attempt_proof` (`tenant_id`,`proof_id`),
  KEY `idx_payment_attempt_status` (`tenant_id`,`status`,`created_at`),
  KEY `fk_payment_attempt_intent` (`intent_id`),
  CONSTRAINT `fk_payment_attempt_intent` FOREIGN KEY (`intent_id`) REFERENCES `payment_intents` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_proofs` (
  `id` varchar(100) NOT NULL,
  `order_id` varchar(36) DEFAULT NULL,
  `payment_intent_id` varchar(36) DEFAULT NULL,
  `payment_attempt_id` varchar(36) DEFAULT NULL,
  `subscriber_id` varchar(100) NOT NULL,
  `course_id` varchar(100) DEFAULT NULL,
  `bundle_id` varchar(100) DEFAULT NULL,
  `item_type` enum('course','bundle','consultation','certificate','other') NOT NULL DEFAULT 'course',
  `amount` decimal(12,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `payment_method` varchar(50) NOT NULL DEFAULT 'instapay',
  `proof_image` mediumtext DEFAULT NULL,
  `note` text DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `reviewer_id` varchar(100) DEFAULT NULL,
  `reviewer_note` text DEFAULT NULL,
  `submitted_at` datetime NOT NULL DEFAULT current_timestamp(),
  `review_due_at` datetime DEFAULT NULL,
  `risk_level` enum('standard','high') NOT NULL DEFAULT 'standard',
  `second_review_required` tinyint(1) NOT NULL DEFAULT 0,
  `first_reviewer_id` varchar(100) DEFAULT NULL,
  `first_review_note` text DEFAULT NULL,
  `first_reviewed_at` datetime DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `tenant_id` varchar(36) DEFAULT 'tenant-default',
  `branch_id` varchar(36) NOT NULL DEFAULT 'branch-other',
  PRIMARY KEY (`id`),
  KEY `idx_pp_subscriber` (`subscriber_id`),
  KEY `idx_pp_status` (`status`),
  KEY `idx_proofs_tenant_branch` (`tenant_id`,`branch_id`),
  KEY `idx_pp_order` (`order_id`),
  KEY `idx_pp_tenant_status` (`tenant_id`,`status`,`submitted_at`),
  KEY `idx_payment_proof_intent` (`tenant_id`,`payment_intent_id`),
  KEY `idx_payment_proof_sla` (`tenant_id`,`status`,`review_due_at`),
  KEY `idx_payment_proof_second_review` (`tenant_id`,`second_review_required`,`first_reviewed_at`,`status`),
  UNIQUE KEY `uq_payment_proof_attempt` (`tenant_id`,`payment_attempt_id`),
  CONSTRAINT `fk_payment_proof_intent` FOREIGN KEY (`payment_intent_id`) REFERENCES `payment_intents` (`id`) ON DELETE RESTRICT,
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
  `certificate_request_id` varchar(36) DEFAULT NULL,
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
  KEY `idx_payments_tenant_branch_date_status` (`tenant_id`,`branch_id`,`date`,`status`,`deleted_at`),
  KEY `idx_payments_certificate_request` (`tenant_id`,`certificate_request_id`),
  KEY `idx_payments_txn_id` (`transaction_id`(191)),
  CONSTRAINT `fk_payments_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payments_certificate_request` FOREIGN KEY (`certificate_request_id`) REFERENCES `certificate_requests` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payments_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payments_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_items` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `staff_id` varchar(36) NOT NULL,
  `reviewer_email` varchar(200) DEFAULT NULL,
  `reviewer_id` varchar(100) DEFAULT NULL,
  `period_month` tinyint(4) NOT NULL COMMENT '1-12',
  `period_year` smallint(6) NOT NULL,
  `kpi_scores` longtext DEFAULT NULL COMMENT 'array of {kpi,target,achieved,score}' CHECK (json_valid(`kpi_scores`)),
  `evidence_json` json DEFAULT NULL,
  `overall_score` decimal(5,2) DEFAULT NULL COMMENT '0-100',
  `grade` varchar(10) DEFAULT NULL COMMENT 'A/B/C/D',
  `notes` text DEFAULT NULL,
  `status` enum('draft','submitted','approved') NOT NULL DEFAULT 'draft',
  `submitted_at` datetime DEFAULT NULL,
  `approved_by` varchar(100) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
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
  KEY `idx_physical_checkins_tenant` (`tenant_id`),
  KEY `idx_checkins_dedupe` (`tenant_id`,`subscriber_id`,`branch_id`,`checked_in_at`)
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
  UNIQUE KEY `uq_push_tenant_endpoint` (`tenant_id`,`endpoint_hash`),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(36) NOT NULL DEFAULT 'tenant-default',
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
  KEY `idx_quiz_attempts_daily_limit` (`tenant_id`,`subscriber_id`,`quiz_id`,`taken_at`),
  KEY `fk_qa_course` (`course_id`),
  CONSTRAINT `fk_qa_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qa_quiz` FOREIGN KEY (`quiz_id`) REFERENCES `course_quizzes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qa_subscriber` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `recurring_expenses` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `title` varchar(200) NOT NULL,
  `amount_egp` decimal(12,2) NOT NULL,
  `category` varchar(100) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `frequency` enum('monthly','weekly','quarterly','yearly') NOT NULL DEFAULT 'monthly',
  `day_of_month` tinyint(4) DEFAULT 1,
  `is_active` tinyint(1) DEFAULT 1,
  `last_run` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `created_by` varchar(200) DEFAULT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `branch` varchar(50) DEFAULT NULL,
  `branch_id` varchar(36) DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_recurring_expenses_tenant` (`tenant_id`),
  KEY `idx_recurring_expenses_tenant_branch_active` (`tenant_id`,`branch_id`,`deleted_at`,`is_active`),
  KEY `idx_recurring_schedule` (`is_active`,`frequency`,`day_of_month`,`deleted_at`,`last_run`)
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `staff_id` varchar(36) NOT NULL,
  `base_salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `housing_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `transport_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `other_allowances_json` longtext DEFAULT NULL CHECK (json_valid(`other_allowances_json`)),
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `created_by` varchar(36) DEFAULT NULL,
  `approved_by` varchar(100) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `food_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `other_fixed` decimal(10,2) NOT NULL DEFAULT 0.00,
  `deduction_social_insurance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `deduction_tax` decimal(10,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `idx_salary_staff` (`staff_id`),
  KEY `idx_salary_effective` (`staff_id`,`effective_from`)
  ,KEY `idx_salary_status` (`tenant_id`,`staff_id`,`status`,`effective_from`)
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `branch_id` varchar(36) NOT NULL DEFAULT 'branch-other',
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
  `national_id` varchar(50) DEFAULT NULL,
  `address` varchar(500) DEFAULT NULL,
  `hr_notes` text DEFAULT NULL,
  `termination_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_staff_email` (`email`),
  UNIQUE KEY `idx_staff_firebase_uid` (`firebase_uid`),
  UNIQUE KEY `uq_staff_tenant_id` (`tenant_id`,`id`),
  KEY `idx_staff_tenant` (`tenant_id`),
  KEY `idx_staff_tenant_branch_active` (`tenant_id`,`branch_id`,`is_active`,`deleted_at`),
  KEY `idx_staff_deleted` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_messages` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `staff_id` varchar(36) NOT NULL,
  `author_staff_id` varchar(36) DEFAULT NULL,
  `author_name` varchar(255) NOT NULL DEFAULT '',
  `direction` enum('to_staff','from_staff') NOT NULL DEFAULT 'to_staff',
  `body` text NOT NULL,
  `read_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_staff_messages_thread` (`tenant_id`,`staff_id`,`created_at`),
  KEY `idx_staff_messages_unread` (`tenant_id`,`staff_id`,`direction`,`read_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_kpis` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
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
  KEY `idx_subscriber` (`subscriber_id`),
  KEY `idx_subscriber_subscriptions_tenant_due` (`tenant_id`,`status`,`auto_renew`,`next_billing_date`),
  KEY `idx_subscriber_subscriptions_tenant_subscriber` (`tenant_id`,`subscriber_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscribers` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  UNIQUE KEY `uq_subscribers_tenant_firebase` (`tenant_id`,`firebase_uid`),
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
  KEY `idx_subscribers_tenant_branch_created` (`tenant_id`,`branch_id`,`created_at`),
  KEY `idx_subscribers_tenant_active_deleted` (`tenant_id`,`is_active`,`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscription_plans` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `name` varchar(255) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `billing_cycle` enum('monthly','quarterly','yearly') DEFAULT 'monthly',
  `description` text DEFAULT NULL,
  `is_active` tinyint(4) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_subscription_plans_tenant_active` (`tenant_id`,`is_active`)
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by` varchar(36) DEFAULT NULL,
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
  `csat_score` tinyint(3) unsigned DEFAULT NULL,
  `csat_comment` text DEFAULT NULL,
  `csat_requested_at` datetime DEFAULT NULL,
  `csat_responded_at` datetime DEFAULT NULL,
  `csat_token_hash` char(64) DEFAULT NULL,
  `csat_token_expires_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_code` (`ticket_code`),
  KEY `idx_ticket_status` (`status`),
  KEY `idx_ticket_sla` (`sla_due_at`),
  KEY `idx_ticket_assignee` (`assigned_to_id`),
  KEY `fk_ticket_sub` (`subscriber_id`),
  KEY `fk_ticket_lead` (`lead_id`),
  KEY `idx_support_tickets_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_support_tickets_tenant_status` (`tenant_id`,`status`,`created_at`),
  KEY `idx_support_tickets_tenant_active` (`tenant_id`,`deleted_at`,`status`,`created_at`),
  KEY `idx_support_email_created` (`subscriber_email`,`created_at`),
  UNIQUE KEY `uq_support_csat_token_hash` (`csat_token_hash`),
  CONSTRAINT `fk_ticket_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ticket_sub` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tasks` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
CREATE TABLE `tenant_domains` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `domain` varchar(253) NOT NULL,
  `status` enum('pending','verified') NOT NULL DEFAULT 'pending',
  `verification_token_hash` char(64) NOT NULL,
  `verified_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_domains_tenant` (`tenant_id`),
  UNIQUE KEY `uq_tenant_domains_domain` (`domain`),
  KEY `idx_tenant_domains_verified` (`status`,`domain`),
  CONSTRAINT `fk_tenant_domains_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `active_tenant_id` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_subscription_active` (`active_tenant_id`),
  KEY `idx_tenant_subscriptions_tenant` (`tenant_id`),
  KEY `idx_tenant_subscriptions_plan` (`plan_id`),
  CONSTRAINT `chk_tenant_subscription_active_scope` CHECK (((`status` in ('active','trialing','past_due')) and (`active_tenant_id` = `tenant_id`)) or ((`status` not in ('active','trialing','past_due')) and (`active_tenant_id` is null))),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `staff_id` varchar(36) DEFAULT NULL,
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
  PRIMARY KEY (`id`),
  KEY `idx_therapists_staff` (`tenant_id`,`staff_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ticket_events` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
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
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `firebase_uid` varchar(128) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `role` varchar(50) DEFAULT 'user',
  `is_active` tinyint(4) DEFAULT 1,
  `session_version` int(10) unsigned NOT NULL DEFAULT 1,
  `active_session_id` varchar(36) DEFAULT NULL,
  `active_session_ip_hash` char(64) DEFAULT NULL,
  `active_session_started_at` datetime DEFAULT NULL,
  `active_session_last_seen_at` datetime DEFAULT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `phone_verified_at` datetime DEFAULT NULL,
  `sharing_locked_until` datetime DEFAULT NULL,
  `sharing_lock_reason` varchar(160) DEFAULT NULL,
  `sharing_lock_count` int(11) NOT NULL DEFAULT 0,
  `last_country_code` char(2) DEFAULT NULL,
  `preferred_currency` char(3) DEFAULT NULL,
  `last_geo_at` datetime DEFAULT NULL,
  `totp_secret` varchar(64) DEFAULT NULL,
  `totp_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `login_count` int(11) DEFAULT 0,
  `last_login` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_tenant_email` (`tenant_id`,`email`(191)),
  KEY `idx_users_firebase` (`firebase_uid`),
  KEY `idx_users_last_login` (`last_login`),
  KEY `idx_users_tenant_active` (`tenant_id`,`is_active`),
  KEY `idx_users_tenant_firebase` (`tenant_id`,`firebase_uid`),
  KEY `idx_users_tenant_session` (`tenant_id`,`id`,`is_active`,`session_version`),
  UNIQUE KEY `uq_users_tenant_active_session` (`tenant_id`,`active_session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `webhooks` (
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `name` varchar(255) NOT NULL,
  `url` varchar(1000) NOT NULL,
  `secret` varchar(255) DEFAULT NULL,
  `events` longtext NOT NULL DEFAULT ('[]') CHECK (json_valid(`events`)),
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
  `id` varchar(36) NOT NULL DEFAULT (uuid()),
  `staff_id` varchar(36) NOT NULL,
  `day_of_week` tinyint(4) NOT NULL COMMENT '0=Sun 6=Sat',
  `start_time` time NOT NULL DEFAULT '09:00:00',
  `end_time` time NOT NULL DEFAULT '17:00:00',
  `grace_minutes` int(11) NOT NULL DEFAULT 15,
  `is_off_day` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_schedule` (`staff_id`,`day_of_week`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `crm_quote_orders`
  ADD CONSTRAINT `fk_crm_quote_order_order`
  FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT;
/*!40101 SET character_set_client = @saved_cs_client */;
CREATE TABLE `lead_merge_audit` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `target_lead_id` varchar(100) NOT NULL,
  `source_lead_id` varchar(100) NOT NULL,
  `actor` varchar(255) DEFAULT NULL,
  `snapshot_json` longtext DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `reverted_at` datetime DEFAULT NULL,
  `reverted_by` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lead_merge_source` (`tenant_id`,`source_lead_id`),
  KEY `idx_lead_merge_target` (`tenant_id`,`target_lead_id`,`created_at`),
  KEY `idx_lead_merge_active` (`tenant_id`,`source_lead_id`,`reverted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `entitlement_events` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `enrollment_id` varchar(36) NOT NULL,
  `subscriber_id` varchar(36) NOT NULL,
  `course_id` varchar(36) NOT NULL,
  `event_type` varchar(32) NOT NULL,
  `source` varchar(64) DEFAULT NULL,
  `actor` varchar(255) DEFAULT NULL,
  `meta_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_entitlement_events_subject` (`tenant_id`,`subscriber_id`,`course_id`,`created_at`),
  KEY `idx_entitlement_events_enrollment` (`tenant_id`,`enrollment_id`,`created_at`),
  CONSTRAINT `fk_entitlement_event_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `learning_prerequisites` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `subject_type` varchar(24) NOT NULL,
  `subject_id` varchar(100) NOT NULL,
  `prerequisite_course_id` varchar(36) NOT NULL,
  `requirement_type` varchar(24) NOT NULL DEFAULT 'completion',
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_learning_prerequisite` (`tenant_id`,`subject_type`,`subject_id`,`prerequisite_course_id`),
  KEY `idx_learning_prerequisite_subject` (`tenant_id`,`subject_type`,`subject_id`),
  CONSTRAINT `fk_learning_prerequisite_course` FOREIGN KEY (`prerequisite_course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_pipeline_stages` (
  `tenant_id` varchar(64) NOT NULL,
  `status_key` varchar(64) NOT NULL,
  `label` varchar(120) NOT NULL,
  `position` int NOT NULL DEFAULT 0,
  `show_in_pipeline` tinyint(1) NOT NULL DEFAULT 1,
  `is_terminal` tinyint(1) NOT NULL DEFAULT 0,
  `allowed_next_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`tenant_id`,`status_key`),
  KEY `idx_crm_pipeline_order` (`tenant_id`,`show_in_pipeline`,`position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_assignment_members` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `staff_id` varchar(36) NOT NULL,
  `branch_key` varchar(64) NOT NULL DEFAULT '*',
  `team_key` varchar(64) NOT NULL DEFAULT 'sales',
  `weight` decimal(8,2) NOT NULL DEFAULT 1,
  `max_open_leads` int DEFAULT NULL,
  `is_available` tinyint(1) NOT NULL DEFAULT 1,
  `last_assigned_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_assignment_scope` (`tenant_id`,`staff_id`,`branch_key`,`team_key`),
  KEY `idx_crm_assignment_pick` (`tenant_id`,`team_key`,`branch_key`,`is_available`,`last_assigned_at`),
  CONSTRAINT `fk_crm_assignment_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `crm_forecast_submissions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `period` char(7) NOT NULL,
  `staff_id` varchar(64) NOT NULL,
  `pipeline_egp` decimal(18,2) NOT NULL DEFAULT 0,
  `best_case_egp` decimal(18,2) NOT NULL DEFAULT 0,
  `commit_egp` decimal(18,2) NOT NULL DEFAULT 0,
  `note` varchar(1000) DEFAULT NULL,
  `submitted_by` varchar(64) DEFAULT NULL,
  `submitted_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_crm_forecast_submission_latest` (`tenant_id`,`period`,`staff_id`,`submitted_at`),
  CONSTRAINT `chk_crm_forecast_submission_amounts` CHECK ((`pipeline_egp` >= 0
    AND `best_case_egp` >= 0 AND `commit_egp` >= 0)
    AND `commit_egp` <= `best_case_egp` AND `best_case_egp` <= `pipeline_egp`
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

CREATE TABLE IF NOT EXISTS `tenant_privacy_policies` (
  `tenant_id` varchar(64) NOT NULL,
  `residency_region` varchar(40) NOT NULL DEFAULT 'not_configured',
  `export_sla_days` smallint unsigned NOT NULL DEFAULT 7,
  `erasure_sla_days` smallint unsigned NOT NULL DEFAULT 30,
  `financial_retention_days` smallint unsigned NOT NULL DEFAULT 2555,
  `allow_self_service` tinyint(1) NOT NULL DEFAULT 1,
  `updated_by` varchar(100) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `privacy_requests` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `subscriber_id` varchar(64) NOT NULL,
  `requester_user_id` varchar(100) DEFAULT NULL,
  `requester_type` enum('client','admin') NOT NULL DEFAULT 'client',
  `request_type` enum('export','erasure') NOT NULL,
  `status` enum('pending','processing','completed','rejected','blocked','failed') NOT NULL DEFAULT 'pending',
  `reason` varchar(1000) DEFAULT NULL,
  `decision_note` varchar(1000) DEFAULT NULL,
  `legal_hold_reason` varchar(1000) DEFAULT NULL,
  `due_at` datetime NOT NULL,
  `handled_by` varchar(100) DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `evidence_json` json DEFAULT NULL,
  `evidence_hash` char(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_privacy_requests_tenant_status_due` (`tenant_id`,`status`,`due_at`),
  KEY `idx_privacy_requests_subject` (`tenant_id`,`subscriber_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `finance_document_sequences` (
  `tenant_id` varchar(64) NOT NULL,
  `branch_scope` varchar(36) NOT NULL,
  `document_type` enum('invoice','credit_note') NOT NULL,
  `document_year` smallint unsigned NOT NULL,
  `next_number` int unsigned NOT NULL DEFAULT 1,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`tenant_id`,`branch_scope`,`document_type`,`document_year`),
  CONSTRAINT `chk_finance_document_next_number` CHECK (`next_number` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `financial_documents` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `branch_id` varchar(36) DEFAULT NULL,
  `branch_scope` varchar(36) GENERATED ALWAYS AS (coalesce(`branch_id`,'__CENTRAL__')) STORED,
  `document_type` enum('invoice','credit_note') NOT NULL,
  `document_number` varchar(80) NOT NULL,
  `source_type` varchar(40) NOT NULL,
  `source_id` varchar(100) NOT NULL,
  `related_document_id` varchar(36) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL,
  `issued_at` datetime NOT NULL,
  `issued_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_financial_document_number` (`tenant_id`,`branch_scope`,`document_type`,`document_number`),
  UNIQUE KEY `uq_financial_document_source` (`tenant_id`,`document_type`,`source_type`,`source_id`),
  KEY `idx_financial_document_issued` (`tenant_id`,`document_type`,`issued_at`),
  KEY `idx_financial_document_related` (`tenant_id`,`related_document_id`),
  KEY `fk_financial_document_related` (`related_document_id`),
  CONSTRAINT `fk_financial_document_related` FOREIGN KEY (`related_document_id`) REFERENCES `financial_documents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_financial_document_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `finance_vendors` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `tax_id` varchar(80) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  `payment_terms_days` smallint unsigned NOT NULL DEFAULT 30,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_finance_vendors_tenant_active` (`tenant_id`,`is_active`,`name`),
  CONSTRAINT `chk_finance_vendor_terms` CHECK (`payment_terms_days` <= 365)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounts_payable_invoices` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `vendor_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `invoice_number` varchar(120) NOT NULL,
  `invoice_date` date NOT NULL,
  `due_date` date NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL,
  `subtotal` decimal(18,2) NOT NULL,
  `tax_amount` decimal(18,2) NOT NULL DEFAULT 0,
  `total_amount` decimal(18,2) NOT NULL,
  `amount_egp` decimal(18,2) DEFAULT NULL,
  `fx_rate_to_egp` decimal(18,8) DEFAULT NULL,
  `expense_account_code` varchar(20) NOT NULL DEFAULT '5900',
  `liability_account_code` varchar(20) NOT NULL DEFAULT '2200',
  `description` varchar(1000) DEFAULT NULL,
  `status` enum('draft','approved','partially_paid','paid','void') NOT NULL DEFAULT 'draft',
  `created_by` varchar(100) NOT NULL,
  `approved_by` varchar(100) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `approval_journal_id` varchar(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ap_vendor_invoice` (`tenant_id`,`vendor_id`,`invoice_number`),
  KEY `idx_ap_due` (`tenant_id`,`status`,`due_date`),
  KEY `idx_ap_branch_date` (`tenant_id`,`branch_id`,`invoice_date`),
  CONSTRAINT `fk_ap_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `finance_vendors` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_ap_amounts` CHECK (`subtotal` >= 0 AND `tax_amount` >= 0 AND `total_amount` > 0 AND abs(((`total_amount` - `subtotal`) - `tax_amount`)) < 0.01),
  CONSTRAINT `chk_ap_dates` CHECK (`due_date` >= `invoice_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounts_payable_payments` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `payable_id` varchar(36) NOT NULL,
  `payment_date` date NOT NULL,
  `amount` decimal(18,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL,
  `amount_egp` decimal(18,2) NOT NULL,
  `bank_account_code` varchar(20) NOT NULL DEFAULT '1100',
  `reference` varchar(191) NOT NULL,
  `journal_entry_id` varchar(36) NOT NULL,
  `paid_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ap_payment_reference` (`tenant_id`,`reference`),
  KEY `idx_ap_payments_payable` (`tenant_id`,`payable_id`,`payment_date`),
  CONSTRAINT `fk_ap_payment_invoice` FOREIGN KEY (`payable_id`) REFERENCES `accounts_payable_invoices` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_ap_payment_amount` CHECK (`amount` > 0 AND `amount_egp` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bank_reconciliations` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `branch_id` varchar(36) DEFAULT NULL,
  `account_code` varchar(20) NOT NULL,
  `period_start` date NOT NULL,
  `period_end` date NOT NULL,
  `opening_balance` decimal(18,2) NOT NULL,
  `ledger_movement` decimal(18,2) NOT NULL,
  `ledger_closing_balance` decimal(18,2) NOT NULL,
  `statement_closing_balance` decimal(18,2) NOT NULL,
  `difference_amount` decimal(18,2) NOT NULL,
  `status` enum('draft','ready','approved','rejected') NOT NULL DEFAULT 'draft',
  `note` varchar(1000) DEFAULT NULL,
  `created_by` varchar(100) NOT NULL,
  `approved_by` varchar(100) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `branch_scope` varchar(36) GENERATED ALWAYS AS (coalesce(`branch_id`,'__CENTRAL__')) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bank_reconciliation_period` (`tenant_id`,`account_code`,`branch_scope`,`period_start`,`period_end`),
  KEY `idx_bank_reconciliation_status` (`tenant_id`,`status`,`period_end`),
  CONSTRAINT `chk_bank_reconciliation_dates` CHECK (`period_end` >= `period_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bank_reconciliation_items` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `reconciliation_id` varchar(36) NOT NULL,
  `item_date` date NOT NULL,
  `description` varchar(500) NOT NULL,
  `amount` decimal(18,2) NOT NULL,
  `item_type` enum('deposit_in_transit','outstanding_payment','bank_fee','interest','other') NOT NULL,
  `ledger_entry_id` varchar(36) DEFAULT NULL,
  `created_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_bank_reconciliation_items` (`tenant_id`,`reconciliation_id`,`item_date`),
  CONSTRAINT `fk_bank_reconciliation_item` FOREIGN KEY (`reconciliation_id`) REFERENCES `bank_reconciliations` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_bank_reconciliation_item_amount` CHECK (`amount` <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounting_close_requests` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `period_id` varchar(36) NOT NULL,
  `status` enum('pending','approved','rejected','consumed') NOT NULL DEFAULT 'pending',
  `checklist_snapshot` json NOT NULL,
  `checklist_sha256` char(64) NOT NULL,
  `requested_by` varchar(100) NOT NULL,
  `request_note` varchar(1000) DEFAULT NULL,
  `reviewed_by` varchar(100) DEFAULT NULL,
  `review_note` varchar(1000) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `consumed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `active_guard` tinyint GENERATED ALWAYS AS ((case when (`status` in ('pending','approved')) then 1 else NULL end)) STORED,
  PRIMARY KEY (`id`),
  KEY `idx_close_request_period` (`tenant_id`,`period_id`,`status`,`created_at`),
  UNIQUE KEY `uq_accounting_close_request_active` (`tenant_id`,`period_id`,`active_guard`),
  CONSTRAINT `fk_close_request_period` FOREIGN KEY (`period_id`) REFERENCES `accounting_periods` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cash_flow_forecast_assumptions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `branch_id` varchar(36) DEFAULT NULL,
  `direction` enum('inflow','outflow') NOT NULL,
  `category` varchar(80) NOT NULL,
  `label` varchar(255) NOT NULL,
  `amount` decimal(18,2) NOT NULL,
  `currency` enum('EGP','SAR','USD') NOT NULL,
  `amount_egp` decimal(18,2) NOT NULL,
  `fx_rate_to_egp` decimal(18,8) NOT NULL,
  `cadence` enum('one_time','weekly','monthly') NOT NULL DEFAULT 'one_time',
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `confidence_pct` decimal(5,2) NOT NULL DEFAULT 100,
  `notes` varchar(1000) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_cash_forecast_window` (`tenant_id`,`is_active`,`start_date`,`end_date`),
  KEY `idx_cash_forecast_branch` (`tenant_id`,`branch_id`,`start_date`),
  CONSTRAINT `chk_cash_forecast_amount` CHECK (`amount` > 0 AND `amount_egp` > 0 AND `fx_rate_to_egp` > 0),
  CONSTRAINT `chk_cash_forecast_confidence` CHECK (`confidence_pct` >= 0 AND `confidence_pct` <= 100),
  CONSTRAINT `chk_cash_forecast_dates` CHECK (`end_date` IS NULL OR `end_date` >= `start_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- staff_absences — from migrations/068_v25_hr_tenant_scope.sql
CREATE TABLE IF NOT EXISTS staff_absences (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  staff_id VARCHAR(100) NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'absence',
  date DATE NOT NULL,
  reason TEXT NULL,
  is_excused TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_absence_tenant (tenant_id, staff_id, date, type),
  INDEX idx_staff_absences_tenant (tenant_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- tenant_chart_of_accounts — from migrations/072_v25_accounting_tenant_scope.sql
CREATE TABLE IF NOT EXISTS tenant_chart_of_accounts (
  tenant_id VARCHAR(64) NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, code),
  KEY idx_tenant_chart_active (tenant_id, is_active, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- marketing_consent_audit — from migrations/082_v25_marketing_consent_outbox.sql
CREATE TABLE IF NOT EXISTS marketing_consent_audit (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  subject_type VARCHAR(20) NOT NULL,
  subject_id VARCHAR(100) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  action VARCHAR(30) NOT NULL,
  source VARCHAR(80) NOT NULL,
  actor VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_marketing_consent_subject (tenant_id, subject_type, subject_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- marketing_suppressions — from migrations/082_v25_marketing_consent_outbox.sql
CREATE TABLE IF NOT EXISTS marketing_suppressions (
  tenant_id VARCHAR(64) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  destination_hash CHAR(64) NOT NULL,
  subject_type VARCHAR(20) NOT NULL,
  subject_id VARCHAR(100) NOT NULL,
  suppressed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, channel, destination_hash),
  KEY idx_marketing_suppression_subject (tenant_id, subject_type, subject_id, channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- support_canned_responses — from migrations/090_support_canned_responses.sql
CREATE TABLE IF NOT EXISTS support_canned_responses (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'عام',
  created_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_canned_tenant (tenant_id, category)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- enps_responses — from migrations/091_enps_responses.sql
CREATE TABLE IF NOT EXISTS enps_responses (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  staff_id VARCHAR(36) NOT NULL,
  score TINYINT UNSIGNED NOT NULL COMMENT '0-10',
  comment TEXT DEFAULT NULL,
  period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_enps_tenant_staff_period (tenant_id, staff_id, period),
  INDEX idx_enps_tenant_period (tenant_id, period)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- staff_offboarding — from migrations/092_staff_offboarding.sql
CREATE TABLE IF NOT EXISTS staff_offboarding (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  staff_id VARCHAR(36) NOT NULL,
  staff_name VARCHAR(255) DEFAULT NULL,
  reason ENUM('resignation','termination','end_contract','other') NOT NULL DEFAULT 'resignation',
  last_working_day DATE DEFAULT NULL,
  status ENUM('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
  checklist JSON DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_offboarding_tenant_staff (tenant_id, staff_id),
  INDEX idx_offboarding_tenant_status (tenant_id, status)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- faq_entries — from migrations/093_faq_entries.sql
CREATE TABLE IF NOT EXISTS faq_entries (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  question VARCHAR(500) NOT NULL,
  answer TEXT NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'عام',
  sort_order INT NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_faq_tenant_pub (tenant_id, is_published, sort_order)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- payroll_period_locks — from migrations/151_v25_payroll_scope_integrity.sql
CREATE TABLE IF NOT EXISTS payroll_period_locks (
  tenant_id VARCHAR(64) NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,year,month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- instructor_rate_change_requests — from migrations/152_v25_instructor_rate_approval.sql
CREATE TABLE IF NOT EXISTS instructor_rate_change_requests (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  staff_id VARCHAR(36) NOT NULL,
  consultation_rate_type ENUM('per_session','percentage','per_hour') NOT NULL DEFAULT 'per_session',
  consultation_rate_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  lecture_rate_per_hour DECIMAL(12,2) NOT NULL DEFAULT 0,
  training_rate_per_hour DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  notes TEXT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  requested_by VARCHAR(36) NULL,
  reviewed_by VARCHAR(36) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_rate_request_pending (tenant_id,status,created_at),
  INDEX idx_rate_request_staff (tenant_id,staff_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `messaging_channels` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `kind` enum('whatsapp','messenger') NOT NULL,
  `provider` enum('meta','green-api','wapilot','messenger') NOT NULL,
  `owner_staff_id` varchar(36) DEFAULT NULL,
  `label` varchar(120) NOT NULL,
  `display_number` varchar(32) DEFAULT NULL,
  `credentials_sealed` text DEFAULT NULL COMMENT 'AES-256-GCM envelope from lib/secretBox.js',
  `status` enum('pending','connected','disconnected','error') NOT NULL DEFAULT 'pending',
  `last_verified_at` datetime DEFAULT NULL,
  `last_error` varchar(500) DEFAULT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `daily_send_limit` int(11) NOT NULL DEFAULT 1000,
  `sent_today` int(11) NOT NULL DEFAULT 0,
  `sent_today_date` date DEFAULT NULL,
  `created_by` varchar(190) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_channel_owner_kind` (`tenant_id`,`owner_staff_id`,`kind`),
  KEY `idx_channel_tenant_kind` (`tenant_id`,`kind`,`is_active`),
  KEY `idx_channel_owner` (`tenant_id`,`owner_staff_id`),
  CONSTRAINT `fk_channel_staff` FOREIGN KEY (`owner_staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `whatsapp_campaigns` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `name` varchar(200) NOT NULL,
  `message_template` text NOT NULL,
  `channel_id` varchar(36) DEFAULT NULL,
  `audience` enum('leads','subscribers','all','manual','segment') NOT NULL DEFAULT 'leads',
  `audience_filter` longtext DEFAULT NULL CHECK (`audience_filter` is null or json_valid(`audience_filter`)),
  `throttle_per_minute` int(11) NOT NULL DEFAULT 60,
  `status` enum('draft','scheduled','sending','sent','failed','cancelled') NOT NULL DEFAULT 'draft',
  `scheduled_at` datetime DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `recipient_count` int(11) NOT NULL DEFAULT 0,
  `sent_count` int(11) NOT NULL DEFAULT 0,
  `fail_count` int(11) NOT NULL DEFAULT 0,
  `skipped_count` int(11) NOT NULL DEFAULT 0,
  `created_by` varchar(190) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_wacamp_tenant_status` (`tenant_id`,`status`,`created_at`),
  KEY `idx_wacamp_channel` (`tenant_id`,`channel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `whatsapp_campaign_recipients` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'tenant-default',
  `campaign_id` varchar(36) NOT NULL,
  `subject_type` enum('lead','subscriber','manual') NOT NULL,
  `subject_id` varchar(36) DEFAULT NULL,
  `phone` varchar(32) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `status` enum('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  `skip_reason` varchar(120) DEFAULT NULL,
  `outbox_id` varchar(64) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wacamp_recipient` (`campaign_id`,`phone`),
  KEY `idx_wacamp_recipients` (`tenant_id`,`campaign_id`,`status`),
  CONSTRAINT `fk_wacamp_recipient_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `whatsapp_campaigns` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

