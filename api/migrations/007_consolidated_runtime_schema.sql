-- ══════════════════════════════════════════════════════════════
-- 008_consolidated_runtime_schema.sql
-- ══════════════════════════════════════════════════════════════
-- Generated from api/lib/startupTasks.js (tools/extract-runtime-ddl.cjs).
-- Consolidates ALL runtime DDL (tables + column additions) so that
-- schema.sql + migrations/ are the single source of truth for new
-- environments. Statements are idempotent (IF NOT EXISTS / ADD COLUMN
-- IF NOT EXISTS) and safe to run on an existing production database.
--
-- NOTE: startupTasks.js still runs the same DDL at boot for backwards
-- compatibility. New schema changes MUST be added here (as a new
-- numbered migration), NOT in startupTasks.js.
-- ══════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(100) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      is_active TINYINT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
      id VARCHAR(36) PRIMARY KEY,
      subscriber_id VARCHAR(100) DEFAULT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'info',
      title VARCHAR(255) DEFAULT NULL,
      message TEXT DEFAULT NULL,
      data_json TEXT DEFAULT NULL,
      read_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notifications_created (created_at),
      INDEX idx_notifications_read (read_at),
      INDEX idx_notifications_subscriber (subscriber_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_config (
        `key` VARCHAR(100) PRIMARY KEY,
        `value` LONGTEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4;

ALTER TABLE orders MODIFY COLUMN payment_method VARCHAR(50) NOT NULL DEFAULT 'CARD';

CREATE TABLE IF NOT EXISTS payment_audit_log (
            id VARCHAR(36) PRIMARY KEY,
            payment_id VARCHAR(36) NOT NULL,
            action ENUM('create','update','delete') NOT NULL,
            old_status VARCHAR(50) DEFAULT NULL,
            new_status VARCHAR(50) DEFAULT NULL,
            amount DECIMAL(10,2) DEFAULT NULL,
            subscriber_id VARCHAR(36) DEFAULT NULL,
            actor VARCHAR(255) DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_audit_payment (payment_id),
            INDEX idx_audit_subscriber (subscriber_id),
            INDEX idx_audit_created (created_at)
          ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS otp_codes (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,
            email VARCHAR(255) NOT NULL,
            code VARCHAR(10) NOT NULL,
            type ENUM('password_reset','2fa') NOT NULL DEFAULT 'password_reset',
            expires_at DATETIME NOT NULL,
            used TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_otp_user (user_id),
            INDEX idx_otp_email (email),
            INDEX idx_otp_expires (expires_at)
          ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS promo_codes (
            id VARCHAR(36) PRIMARY KEY,
            code VARCHAR(50) NOT NULL UNIQUE,
            description VARCHAR(255) DEFAULT NULL,
            discount_type ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
            discount_value DECIMAL(10,2) NOT NULL DEFAULT 0,
            min_order_amount DECIMAL(10,2) DEFAULT 0,
            max_uses INT DEFAULT NULL,
            used_count INT NOT NULL DEFAULT 0,
            expires_at DATETIME DEFAULT NULL,
            active TINYINT(1) NOT NULL DEFAULT 1,
            created_by VARCHAR(255) DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_promo_code (code),
            INDEX idx_promo_active (active)
          ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
            id VARCHAR(36) PRIMARY KEY,
            type VARCHAR(50) NOT NULL DEFAULT 'info',
            title VARCHAR(255) NOT NULL,
            message TEXT DEFAULT NULL,
            data_json TEXT DEFAULT NULL,
            read_at DATETIME DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_notif_created (created_at),
            INDEX idx_notif_read (read_at)
          ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS course_ratings (
            id VARCHAR(36) PRIMARY KEY,
            course_id VARCHAR(36) NOT NULL,
            subscriber_id VARCHAR(36) NOT NULL,
            rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
            comment TEXT DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_rating (course_id, subscriber_id),
            INDEX idx_cr_course (course_id),
            INDEX idx_cr_subscriber (subscriber_id)
          ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS course_completions (
            id VARCHAR(36) PRIMARY KEY,
            subscriber_id VARCHAR(36) NOT NULL,
            course_id VARCHAR(36) NOT NULL,
            completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            certificate_code VARCHAR(20) NOT NULL UNIQUE,
            email_sent TINYINT(1) NOT NULL DEFAULT 0,
            UNIQUE KEY uq_completion (subscriber_id, course_id),
            INDEX idx_comp_course (course_id),
            INDEX idx_comp_subscriber (subscriber_id)
          ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS referral_codes (
            id VARCHAR(36) PRIMARY KEY,
            subscriber_id VARCHAR(36) NOT NULL UNIQUE,
            code VARCHAR(20) NOT NULL UNIQUE,
            uses INT NOT NULL DEFAULT 0,
            earnings DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_ref_code (code)
          ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS token_blacklist (
            jti VARCHAR(36) PRIMARY KEY,
            expires_at DATETIME NOT NULL,
            revoked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_tbl_expires (expires_at)
          ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS lecture_progress (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          subscriber_id VARCHAR(36) NOT NULL,
          lecture_id VARCHAR(36) NOT NULL,
          course_id VARCHAR(36) DEFAULT NULL,
          progress_pct TINYINT UNSIGNED NOT NULL DEFAULT 0,
          completed_at DATETIME DEFAULT NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_lp (subscriber_id, lecture_id),
          KEY idx_lp_sub (subscriber_id),
          KEY idx_lp_course (course_id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS email_campaigns (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          title VARCHAR(500) NOT NULL,
          subject VARCHAR(500) NOT NULL,
          body_html TEXT NOT NULL,
          audience ENUM('all','subscribers','leads','manual') NOT NULL DEFAULT 'all',
          audience_filter JSON DEFAULT NULL,
          status ENUM('draft','sending','sent','failed') NOT NULL DEFAULT 'draft',
          sent_count INT NOT NULL DEFAULT 0,
          fail_count INT NOT NULL DEFAULT 0,
          scheduled_at DATETIME DEFAULT NULL,
          sent_at DATETIME DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(36) DEFAULT NULL,
          PRIMARY KEY (id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          title VARCHAR(500) NOT NULL,
          description TEXT DEFAULT NULL,
          assigned_to VARCHAR(36) DEFAULT NULL,
          assigned_name VARCHAR(255) DEFAULT NULL,
          related_sub_id VARCHAR(36) DEFAULT NULL,
          related_lead_id VARCHAR(36) DEFAULT NULL,
          priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
          status ENUM('todo','in_progress','done','cancelled') NOT NULL DEFAULT 'todo',
          due_date DATE DEFAULT NULL,
          completed_at DATETIME DEFAULT NULL,
          created_by VARCHAR(36) DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_tasks_assigned (assigned_to),
          KEY idx_tasks_status (status)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS support_tickets (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          subscriber_id VARCHAR(36) DEFAULT NULL,
          subscriber_email VARCHAR(255) DEFAULT NULL,
          subscriber_name VARCHAR(255) DEFAULT NULL,
          subject VARCHAR(500) NOT NULL,
          body TEXT NOT NULL,
          status ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
          priority ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
          assigned_to VARCHAR(36) DEFAULT NULL,
          resolved_at DATETIME DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_tickets_sub (subscriber_id),
          KEY idx_tickets_status (status)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS ticket_replies (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          ticket_id VARCHAR(36) NOT NULL,
          author_type ENUM('subscriber','staff','system') NOT NULL DEFAULT 'staff',
          author_name VARCHAR(255) DEFAULT NULL,
          body TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_tr_ticket (ticket_id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS webhooks (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          name VARCHAR(255) NOT NULL,
          url VARCHAR(1000) NOT NULL,
          secret VARCHAR(255) DEFAULT NULL,
          events JSON NOT NULL DEFAULT ('[]'),
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          last_triggered_at DATETIME DEFAULT NULL,
          last_status INT DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS budgets (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          month CHAR(7) NOT NULL COMMENT 'YYYY-MM',
          category VARCHAR(255) NOT NULL,
          budgeted_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          currency CHAR(3) NOT NULL DEFAULT 'EGP',
          notes VARCHAR(500) DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_budget (month, category)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS nps_responses (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          subscriber_id VARCHAR(36) DEFAULT NULL,
          subscriber_email VARCHAR(255) DEFAULT NULL,
          score TINYINT UNSIGNED NOT NULL COMMENT '0-10',
          comment TEXT DEFAULT NULL,
          payment_id VARCHAR(36) DEFAULT NULL,
          sent_at DATETIME DEFAULT NULL,
          responded_at DATETIME DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_nps_sub (subscriber_id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS sms_campaigns (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          title VARCHAR(500) NOT NULL,
          message TEXT NOT NULL,
          audience ENUM('all','subscribers','leads','manual') NOT NULL DEFAULT 'all',
          audience_filter JSON DEFAULT NULL,
          status ENUM('draft','sending','sent','failed') NOT NULL DEFAULT 'draft',
          sent_count INT NOT NULL DEFAULT 0,
          fail_count INT NOT NULL DEFAULT 0,
          sent_at DATETIME DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(36) DEFAULT NULL,
          PRIMARY KEY (id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS hr_departments (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          name VARCHAR(255) NOT NULL,
          branch ENUM('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','ALL') NOT NULL DEFAULT 'ALL',
          manager_id VARCHAR(36) DEFAULT NULL,
          description TEXT DEFAULT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_dept_branch (branch)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS salary_structures (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          base_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
          housing_allowance DECIMAL(10,2) NOT NULL DEFAULT 0,
          transport_allowance DECIMAL(10,2) NOT NULL DEFAULT 0,
          other_allowances_json JSON DEFAULT NULL,
          currency ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
          effective_from DATE NOT NULL,
          effective_to DATE DEFAULT NULL,
          created_by VARCHAR(36) DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_salary_staff (staff_id),
          KEY idx_salary_effective (staff_id, effective_from)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS commission_rules (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          name VARCHAR(255) NOT NULL,
          staff_id VARCHAR(36) DEFAULT NULL,
          apply_to_roles JSON DEFAULT NULL,
          calc_type ENUM('PERCENTAGE','FIXED_PER_SALE','TIERED','TARGET_BONUS') NOT NULL DEFAULT 'PERCENTAGE',
          percentage_value DECIMAL(5,2) DEFAULT NULL,
          tiers_json JSON DEFAULT NULL,
          target_amount DECIMAL(10,2) DEFAULT NULL,
          bonus_value DECIMAL(10,2) DEFAULT NULL,
          bonus_type ENUM('FIXED','PERCENTAGE') DEFAULT NULL,
          applies_to ENUM('PAYMENT','COURSE_ONLY','CONSULTATION_ONLY','ENROLLMENT') NOT NULL DEFAULT 'PAYMENT',
          min_payment DECIMAL(10,2) DEFAULT NULL,
          currency ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
          priority INT NOT NULL DEFAULT 1,
          stackable TINYINT(1) NOT NULL DEFAULT 0,
          effective_from DATE NOT NULL DEFAULT (CURRENT_DATE),
          effective_to DATE DEFAULT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_by VARCHAR(36) DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_crules_staff (staff_id),
          KEY idx_crules_active (is_active)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS crm_commissions (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          payment_id VARCHAR(36) DEFAULT NULL,
          rule_id VARCHAR(36) DEFAULT NULL,
          client_id VARCHAR(36) DEFAULT NULL,
          client_type ENUM('SUBSCRIBER','LEAD') DEFAULT 'SUBSCRIBER',
          payment_amount DECIMAL(10,2) NOT NULL,
          commission_amount DECIMAL(10,2) NOT NULL,
          calc_details JSON DEFAULT NULL,
          month TINYINT UNSIGNED NOT NULL,
          year SMALLINT UNSIGNED NOT NULL,
          status ENUM('PENDING','INCLUDED_IN_PAYROLL','PAID','CANCELLED') NOT NULL DEFAULT 'PENDING',
          payroll_run_id VARCHAR(36) DEFAULT NULL,
          note TEXT DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_comm_staff (staff_id),
          KEY idx_comm_month (staff_id, year, month),
          KEY idx_comm_payment (payment_id),
          KEY idx_comm_status (status),
          UNIQUE KEY uniq_comm_payment_staff (payment_id, staff_id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS kpi_targets (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          metric VARCHAR(100) NOT NULL,
          target_value DECIMAL(12,2) NOT NULL,
          period ENUM('MONTHLY','QUARTERLY','YEARLY') NOT NULL DEFAULT 'MONTHLY',
          from_date DATE NOT NULL,
          to_date DATE NOT NULL,
          notes TEXT DEFAULT NULL,
          set_by VARCHAR(36) DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_kpit_staff (staff_id),
          KEY idx_kpit_period (staff_id, metric, from_date)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS kpi_actuals (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          metric VARCHAR(100) NOT NULL,
          actual_value DECIMAL(12,2) NOT NULL DEFAULT 0,
          period ENUM('MONTHLY','QUARTERLY','YEARLY') NOT NULL DEFAULT 'MONTHLY',
          period_start DATE NOT NULL,
          period_end DATE NOT NULL,
          source ENUM('CRM_AUTO','ATTENDANCE_AUTO','MANUAL') NOT NULL DEFAULT 'CRM_AUTO',
          breakdown_json JSON DEFAULT NULL,
          calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uniq_kpi_actual (staff_id, metric, period, period_start),
          KEY idx_kpia_staff (staff_id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS payroll_runs (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          month TINYINT UNSIGNED NOT NULL,
          year SMALLINT UNSIGNED NOT NULL,
          status ENUM('DRAFT','CALCULATED','APPROVED','PAID','CANCELLED') NOT NULL DEFAULT 'DRAFT',
          total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          employee_count INT NOT NULL DEFAULT 0,
          currency ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
          notes TEXT DEFAULT NULL,
          calculated_by VARCHAR(36) DEFAULT NULL,
          approved_by VARCHAR(36) DEFAULT NULL,
          paid_by VARCHAR(36) DEFAULT NULL,
          calculated_at DATETIME DEFAULT NULL,
          approved_at DATETIME DEFAULT NULL,
          paid_at DATETIME DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uniq_payroll_run (month, year),
          KEY idx_pr_status (status)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS payroll_items (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          payroll_run_id VARCHAR(36) NOT NULL,
          staff_id VARCHAR(36) NOT NULL,
          base_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
          allowances_json JSON DEFAULT NULL,
          total_allowances DECIMAL(10,2) NOT NULL DEFAULT 0,
          commission DECIMAL(10,2) NOT NULL DEFAULT 0,
          bonus DECIMAL(10,2) NOT NULL DEFAULT 0,
          bonus_note TEXT DEFAULT NULL,
          late_deductions DECIMAL(10,2) NOT NULL DEFAULT 0,
          absence_deductions DECIMAL(10,2) NOT NULL DEFAULT 0,
          advance_deductions DECIMAL(10,2) NOT NULL DEFAULT 0,
          other_deductions DECIMAL(10,2) NOT NULL DEFAULT 0,
          deductions_note TEXT DEFAULT NULL,
          net_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
          attendance_days INT DEFAULT NULL,
          absent_days INT DEFAULT NULL,
          late_minutes INT DEFAULT NULL,
          commission_count INT DEFAULT NULL,
          calculation_details JSON DEFAULT NULL,
          is_manual_override TINYINT(1) NOT NULL DEFAULT 0,
          override_by VARCHAR(36) DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uniq_payroll_item (payroll_run_id, staff_id),
          KEY idx_pi_staff (staff_id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS work_schedules (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          day_of_week TINYINT NOT NULL COMMENT '0=Sun 6=Sat',
          start_time TIME NOT NULL DEFAULT '09:00:00',
          end_time TIME NOT NULL DEFAULT '17:00:00',
          grace_minutes INT NOT NULL DEFAULT 15,
          is_off_day TINYINT(1) NOT NULL DEFAULT 0,
          PRIMARY KEY (id),
          UNIQUE KEY uniq_schedule (staff_id, day_of_week)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS attendance_logs (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          branch ENUM('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT NULL,
          date DATE NOT NULL,
          check_in TIME DEFAULT NULL,
          check_out TIME DEFAULT NULL,
          total_hours DECIMAL(5,2) DEFAULT NULL,
          late_minutes INT NOT NULL DEFAULT 0,
          status ENUM('PRESENT','ABSENT','LATE','HALF_DAY','LEAVE','HOLIDAY','REMOTE') NOT NULL DEFAULT 'PRESENT',
          notes TEXT DEFAULT NULL,
          source ENUM('FINGERPRINT_IMPORT','MANUAL_ENTRY','APP') NOT NULL DEFAULT 'FINGERPRINT_IMPORT',
          import_batch_id VARCHAR(36) DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uniq_attendance (staff_id, date),
          KEY idx_att_staff (staff_id),
          KEY idx_att_date (date)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS attendance_import_batches (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          filename VARCHAR(255) NOT NULL,
          month TINYINT UNSIGNED NOT NULL,
          year SMALLINT UNSIGNED NOT NULL,
          branch ENUM('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT NULL,
          rows_total INT NOT NULL DEFAULT 0,
          rows_ok INT NOT NULL DEFAULT 0,
          rows_error INT NOT NULL DEFAULT 0,
          errors_json JSON DEFAULT NULL,
          imported_by VARCHAR(36) DEFAULT NULL,
          imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS leaves (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          type ENUM('ANNUAL','SICK','UNPAID','MATERNITY','EMERGENCY','PERMISSION','OTHER') NOT NULL DEFAULT 'ANNUAL',
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          total_days DECIMAL(4,1) NOT NULL DEFAULT 1,
          reason TEXT DEFAULT NULL,
          status ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
          approved_by VARCHAR(36) DEFAULT NULL,
          approved_at DATETIME DEFAULT NULL,
          admin_note TEXT DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_leaves_staff (staff_id),
          KEY idx_leaves_dates (start_date, end_date),
          KEY idx_leaves_status (status)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS salary_advances (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          amount DECIMAL(10,2) NOT NULL,
          currency ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
          reason TEXT DEFAULT NULL,
          status ENUM('PENDING','APPROVED','DEDUCTED','REJECTED') NOT NULL DEFAULT 'PENDING',
          deduct_month TINYINT UNSIGNED DEFAULT NULL,
          deduct_year SMALLINT UNSIGNED DEFAULT NULL,
          approved_by VARCHAR(36) DEFAULT NULL,
          approved_at DATETIME DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_advances_staff (staff_id)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS hr_audit_logs (
          id VARCHAR(36) NOT NULL DEFAULT (UUID()),
          action VARCHAR(100) NOT NULL,
          entity_type VARCHAR(50) NOT NULL,
          entity_id VARCHAR(36) DEFAULT NULL,
          old_value JSON DEFAULT NULL,
          new_value JSON DEFAULT NULL,
          performed_by VARCHAR(36) DEFAULT NULL,
          performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ip_address VARCHAR(45) DEFAULT NULL,
          note TEXT DEFAULT NULL,
          PRIMARY KEY (id),
          KEY idx_hral_entity (entity_type, entity_id),
          KEY idx_hral_date (performed_at)
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS job_postings (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          title VARCHAR(200) NOT NULL,
          department_id VARCHAR(36),
          employment_type ENUM('full_time','part_time','contract','intern') DEFAULT 'full_time',
          description TEXT,
          requirements TEXT,
          salary_min DECIMAL(10,2),
          salary_max DECIMAL(10,2),
          status ENUM('draft','open','closed','filled') DEFAULT 'open',
          posted_by VARCHAR(36),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS job_applicants (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          job_id VARCHAR(36) NOT NULL,
          name VARCHAR(200) NOT NULL,
          email VARCHAR(200),
          phone VARCHAR(50),
          cv_url TEXT,
          notes TEXT,
          stage ENUM('applied','screening','interview','offer','hired','rejected') DEFAULT 'applied',
          stage_notes TEXT,
          updated_by VARCHAR(36),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS onboarding_templates (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          name VARCHAR(200) NOT NULL,
          role VARCHAR(100),
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS onboarding_tasks (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          template_id VARCHAR(36) NOT NULL,
          title VARCHAR(300) NOT NULL,
          description TEXT,
          due_days INT DEFAULT 7,
          category ENUM('documents','training','setup','meeting','other') DEFAULT 'other',
          sort_order INT DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS employee_onboarding (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          template_id VARCHAR(36),
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP NULL,
          status ENUM('in_progress','completed','cancelled') DEFAULT 'in_progress'
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS employee_onboarding_items (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          onboarding_id VARCHAR(36) NOT NULL,
          task_title VARCHAR(300) NOT NULL,
          category VARCHAR(50) DEFAULT 'other',
          due_date DATE,
          completed_at TIMESTAMP NULL,
          completed_by VARCHAR(36),
          notes TEXT,
          sort_order INT DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS disciplinary_records (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          type ENUM('warning','verbal_warning','written_warning','suspension','termination','other') DEFAULT 'warning',
          severity ENUM('low','medium','high') DEFAULT 'medium',
          title VARCHAR(300) NOT NULL,
          description TEXT,
          incident_date DATE,
          action_taken TEXT,
          issued_by VARCHAR(36),
          acknowledged_at DATETIME NULL,
          acknowledged_by VARCHAR(36) NULL,
          status ENUM('open','acknowledged','resolved','appealed') DEFAULT 'open',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS employee_documents (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          title VARCHAR(300) NOT NULL,
          category ENUM('contract','id','certificate','medical','other') DEFAULT 'other',
          file_url TEXT,
          file_name VARCHAR(300),
          expiry_date DATE NULL,
          uploaded_by VARCHAR(36),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS instructor_rates (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL UNIQUE,
          consultation_rate_type ENUM('per_session','percentage','per_hour') DEFAULT 'per_session',
          consultation_rate_value DECIMAL(10,2) DEFAULT 0,
          lecture_rate_per_hour DECIMAL(10,2) DEFAULT 0,
          training_rate_per_hour DECIMAL(10,2) DEFAULT 0,
          currency ENUM('EGP','SAR','USD') DEFAULT 'EGP',
          notes TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS employee_bonuses (
          id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
          staff_id VARCHAR(36) NOT NULL,
          type ENUM('bonus','deduction') DEFAULT 'bonus',
          amount DECIMAL(10,2) NOT NULL,
          currency ENUM('EGP','SAR','USD') DEFAULT 'EGP',
          reason TEXT,
          for_month TINYINT UNSIGNED,
          for_year SMALLINT UNSIGNED,
          created_by VARCHAR(36),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          KEY idx_bonuses_staff (staff_id),
          KEY idx_bonuses_period (for_year, for_month)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS instructor_fees (
            id          VARCHAR(36)   NOT NULL DEFAULT (UUID()),
            staff_id    VARCHAR(36)   NOT NULL,
            course_id   VARCHAR(36)   NULL,
            daqqi_round_id VARCHAR(36) NULL,
            fee_type    ENUM('lecture','training','consultation','fixed') NOT NULL DEFAULT 'lecture',
            hours       DECIMAL(5,2)  NULL,
            rate_per_hour DECIMAL(10,2) NULL,
            fixed_amount  DECIMAL(10,2) NULL,
            total_amount  DECIMAL(10,2) NOT NULL DEFAULT 0,
            currency    ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
            period_month TINYINT UNSIGNED NULL,
            period_year  SMALLINT UNSIGNED NULL,
            status      ENUM('pending','approved','paid') NOT NULL DEFAULT 'pending',
            note        TEXT NULL,
            created_by  VARCHAR(36) NULL,
            created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_if_staff    (staff_id),
            KEY idx_if_course   (course_id),
            KEY idx_if_period   (period_year, period_month),
            KEY idx_if_status   (status)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS branch
          ENUM('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT NULL
          AFTER subscriber_id;

CREATE TABLE IF NOT EXISTS journal_entries (
            id           VARCHAR(36)    NOT NULL DEFAULT (UUID()),
            ref_type     VARCHAR(50)    NOT NULL COMMENT 'payment | refund | payroll | adjustment',
            ref_id       VARCHAR(36)    NULL,
            entry_date   DATE           NOT NULL,
            description  TEXT           NULL,
            total_debit  DECIMAL(12,2)  NOT NULL DEFAULT 0,
            total_credit DECIMAL(12,2)  NOT NULL DEFAULT 0,
            posted_by    VARCHAR(200)   NULL,
            created_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_je_ref  (ref_type, ref_id),
            KEY idx_je_date (entry_date)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS journal_entry_lines (
            id           VARCHAR(36)    NOT NULL DEFAULT (UUID()),
            entry_id     VARCHAR(36)    NOT NULL,
            account_code VARCHAR(20)    NOT NULL,
            account_name VARCHAR(200)   NOT NULL,
            debit        DECIMAL(12,2)  NOT NULL DEFAULT 0,
            credit       DECIMAL(12,2)  NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            KEY idx_jel_entry (entry_id),
            CONSTRAINT fk_jel_entry FOREIGN KEY (entry_id) REFERENCES journal_entries (id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE crm_commissions
          ADD CONSTRAINT fk_comm_client FOREIGN KEY (client_id) REFERENCES subscribers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS lecture_completions (
            id            VARCHAR(36) NOT NULL DEFAULT (UUID()),
            subscriber_id VARCHAR(36) NOT NULL,
            lecture_id    VARCHAR(36) NOT NULL,
            course_id     VARCHAR(36) NULL,
            progress_pct  TINYINT UNSIGNED NOT NULL DEFAULT 100,
            completed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            watch_seconds INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_lc (subscriber_id, lecture_id),
            KEY idx_lc_sub  (subscriber_id),
            KEY idx_lc_course (course_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS live_sessions (
            id            VARCHAR(36)  NOT NULL DEFAULT (UUID()),
            course_id     VARCHAR(36)  NULL,
            title         VARCHAR(255) NOT NULL DEFAULT '',
            platform      ENUM('zoom','google_meet','youtube','other') NOT NULL DEFAULT 'zoom',
            meeting_url   TEXT         NOT NULL,
            meeting_id    VARCHAR(200) NULL,
            meeting_pass  VARCHAR(100) NULL,
            starts_at     DATETIME     NOT NULL,
            duration_min  SMALLINT UNSIGNED NOT NULL DEFAULT 60,
            status        ENUM('scheduled','live','ended','cancelled') NOT NULL DEFAULT 'scheduled',
            recording_url TEXT         NULL,
            notes         TEXT         NULL,
            created_by    VARCHAR(200) NULL,
            created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_ls_course (course_id),
            KEY idx_ls_starts (starts_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_sequences (
            id           VARCHAR(36)  NOT NULL DEFAULT (UUID()),
            name         VARCHAR(200) NOT NULL,
            trigger_event ENUM('registration','enrollment','payment','lead_created') NOT NULL DEFAULT 'registration',
            is_active    TINYINT(1)   NOT NULL DEFAULT 1,
            created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_sequence_steps (
            id          VARCHAR(36)  NOT NULL DEFAULT (UUID()),
            sequence_id VARCHAR(36)  NOT NULL,
            step_order  TINYINT UNSIGNED NOT NULL DEFAULT 1,
            delay_hours INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'hours after trigger to send',
            subject     VARCHAR(500) NOT NULL DEFAULT '',
            body_html   LONGTEXT     NOT NULL,
            PRIMARY KEY (id),
            KEY idx_ess_seq (sequence_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_sequence_queue (
            id           VARCHAR(36)  NOT NULL DEFAULT (UUID()),
            step_id      VARCHAR(36)  NOT NULL,
            recipient_email VARCHAR(320) NOT NULL,
            recipient_name  VARCHAR(255) NULL,
            scheduled_at DATETIME     NOT NULL,
            sent_at      DATETIME     NULL,
            failed_at    DATETIME     NULL,
            error_msg    TEXT         NULL,
            PRIMARY KEY (id),
            KEY idx_esq_step      (step_id),
            KEY idx_esq_scheduled (scheduled_at),
            KEY idx_esq_email     (recipient_email)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE subscribers ADD CONSTRAINT uq_subs_phone UNIQUE (phone(50));

ALTER TABLE subscribers ADD CONSTRAINT uq_subs_email UNIQUE (email(191));

ALTER TABLE subscribers ADD CONSTRAINT uq_subs_code  UNIQUE (client_code(50));

CREATE TABLE IF NOT EXISTS daqqi_rounds (
            id                   VARCHAR(36)  NOT NULL DEFAULT (UUID()),
            code                 VARCHAR(50)  NOT NULL,
            course_id            VARCHAR(36)  NOT NULL,
            instructor_id        VARCHAR(36)  NOT NULL,
            instructor_name      VARCHAR(255) NOT NULL,
            reception_id         VARCHAR(36)  NOT NULL,
            reception_name       VARCHAR(255) NOT NULL,
            day_of_week          VARCHAR(20)  NOT NULL,
            start_date           DATETIME NOT NULL,
            time_slot            ENUM('MORNING','NOON','EVENING') NOT NULL,
            status               ENUM('NEW','ACTIVE','FINISHED') NOT NULL DEFAULT 'NEW',
            current_lecture      INT NOT NULL DEFAULT 0,
            postponed_weeks_json TEXT DEFAULT NULL,
            created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY idx_daqqi_code (code)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daqqi_attendees (
            round_id          VARCHAR(36)  NOT NULL,
            subscriber_id     VARCHAR(36)  NOT NULL,
            name              VARCHAR(255) NOT NULL,
            phone             VARCHAR(50)  NOT NULL,
            booked_at         DATETIME NOT NULL,
            amount_paid       DOUBLE NOT NULL DEFAULT 0,
            attended_lectures INT NOT NULL DEFAULT 0,
            PRIMARY KEY (round_id, subscriber_id),
            KEY idx_att_subscriber (subscriber_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canned_responses (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(200) NOT NULL,
          body TEXT NOT NULL,
          category VARCHAR(100),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS daqqi_waitlist (
            id VARCHAR(36) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(50) NOT NULL,
            email VARCHAR(255),
            course_id VARCHAR(36),
            course_name VARCHAR(255),
            notes TEXT,
            status ENUM('waiting','contacted','enrolled','cancelled') DEFAULT 'waiting',
            branch ENUM('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT 'DAQQI',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS accounting_periods (
            id VARCHAR(36) PRIMARY KEY,
            period_label VARCHAR(20) NOT NULL,
            opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            closed_at DATETIME NULL,
            closed_by VARCHAR(100) NULL,
            summary_json TEXT NULL,
            status ENUM('open','closed') DEFAULT 'open'
          ) CHARACTER SET utf8mb4;

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS client_type VARCHAR(50) DEFAULT NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS client_type VARCHAR(50) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS refund_requests (
    id VARCHAR(36) PRIMARY KEY,
    subscriber_id VARCHAR(36) NOT NULL,
    payment_id VARCHAR(36) DEFAULT NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'EGP',
    reason TEXT,
    status ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
    admin_note TEXT,
    refund_method VARCHAR(100) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME DEFAULT NULL,
    resolved_by VARCHAR(100) DEFAULT NULL,
    INDEX idx_subscriber (subscriber_id),
    INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recurring_expenses (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      title VARCHAR(200) NOT NULL,
      amount_egp DECIMAL(12,2) NOT NULL,
      category VARCHAR(100),
      notes TEXT,
      frequency ENUM('monthly','quarterly','yearly') DEFAULT 'monthly',
      day_of_month TINYINT DEFAULT 1,
      is_active TINYINT(1) DEFAULT 1,
      last_run DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(200)
    );

CREATE TABLE IF NOT EXISTS installment_plans (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      subscriber_id VARCHAR(100) NOT NULL,
      payment_id VARCHAR(100),
      title VARCHAR(200),
      total_amount DECIMAL(12,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'EGP',
      installments_count INT NOT NULL DEFAULT 3,
      paid_count INT DEFAULT 0,
      installment_amounts JSON,
      due_dates JSON,
      paid_dates JSON,
      status ENUM('active','completed','overdue','cancelled') DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(200),
      KEY idx_inst_sub (subscriber_id),
      KEY idx_inst_status (status)
    );

CREATE TABLE IF NOT EXISTS drip_sequences (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      name VARCHAR(200) NOT NULL,
      description TEXT,
      trigger_status VARCHAR(100),
      is_active TINYINT(1) DEFAULT 1,
      steps JSON COMMENT 'Array of {delay_days, subject, body_html}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(200)
    );

CREATE TABLE IF NOT EXISTS drip_enrollments (
      id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
      sequence_id VARCHAR(36) NOT NULL,
      lead_id VARCHAR(36),
      subscriber_id VARCHAR(100),
      email VARCHAR(200) NOT NULL,
      current_step INT DEFAULT 0,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      next_send_at TIMESTAMP NULL,
      completed_at TIMESTAMP NULL,
      unsubscribed_at TIMESTAMP NULL,
      KEY idx_drip_next (next_send_at),
      KEY idx_drip_seq (sequence_id)
    );

CREATE TABLE IF NOT EXISTS sales_goals (
      id INT PRIMARY KEY AUTO_INCREMENT,
      period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
      revenue_target DECIMAL(12,2) DEFAULT 0,
      leads_target INT DEFAULT 0,
      conversions_target INT DEFAULT 0,
      new_clients_target INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_period (period)
    );

ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INT DEFAULT 0, ADD COLUMN IF NOT EXISTS last_login DATETIME;

CREATE TABLE IF NOT EXISTS automation_log (
  id VARCHAR(100) PRIMARY KEY,
  workflow_id VARCHAR(100),
  lead_id VARCHAR(100),
  subscriber_id VARCHAR(100),
  action VARCHAR(100),
  triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_al_wf (workflow_id),
  INDEX idx_al_lead (lead_id)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS drip_campaigns (
      id VARCHAR(36) NOT NULL DEFAULT (UUID()),
      name VARCHAR(500) NOT NULL,
      trigger_event VARCHAR(255) NOT NULL DEFAULT 'subscription_created'
        COMMENT 'subscription_created|lead_status:interested|consultation_completed|payment_received',
      audience ENUM('subscribers','leads','all') NOT NULL DEFAULT 'subscribers',
      status ENUM('active','paused','draft') NOT NULL DEFAULT 'draft',
      enrolled_count INT NOT NULL DEFAULT 0,
      completed_count INT NOT NULL DEFAULT 0,
      steps JSON NOT NULL DEFAULT ('[]'),
      created_by VARCHAR(36) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) CHARACTER SET utf8mb4;

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS crm_json LONGTEXT;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_json LONGTEXT;

CREATE TABLE IF NOT EXISTS lead_timeline (
      id VARCHAR(100) PRIMARY KEY,
      lead_id VARCHAR(100) NOT NULL,
      event_type VARCHAR(80) NOT NULL,
      description TEXT,
      meta_json TEXT,
      at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_lt_lead (lead_id),
      INDEX idx_lt_at (at)
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS community_posts (
      id VARCHAR(100) PRIMARY KEY, title VARCHAR(500), category VARCHAR(100),
      body LONGTEXT, author VARCHAR(200), image_url TEXT, tags TEXT,
      featured TINYINT(1) DEFAULT 0, pinned TINYINT(1) DEFAULT 0, likes INT DEFAULT 0,
      created_at VARCHAR(50)
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS community_library (
      id VARCHAR(100) PRIMARY KEY, title VARCHAR(500), category VARCHAR(100),
      description TEXT, file_url TEXT, thumbnail TEXT, file_type VARCHAR(50),
      tags TEXT, created_at VARCHAR(50)
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS community_videos (
      id VARCHAR(100) PRIMARY KEY, title VARCHAR(500), category VARCHAR(100),
      description TEXT, video_url TEXT, thumbnail TEXT, duration VARCHAR(50),
      tags TEXT, created_at VARCHAR(50)
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS community_events (
      id VARCHAR(100) PRIMARY KEY, title VARCHAR(500), category VARCHAR(100),
      description TEXT, image_url TEXT, event_date VARCHAR(100),
      date_label VARCHAR(200), location_name VARCHAR(300),
      registration_url TEXT, is_online TINYINT(1) DEFAULT 0,
      tags TEXT, created_at VARCHAR(50)
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS inbox_conversations (
      id VARCHAR(100) PRIMARY KEY, channel VARCHAR(50),
      contact_name VARCHAR(200), contact_id VARCHAR(200), contact_avatar TEXT,
      last_message TEXT, last_message_at VARCHAR(50), unread_count INT DEFAULT 0,
      status VARCHAR(50) DEFAULT 'open', assigned_to_staff_id VARCHAR(100),
      assigned_to_staff_name VARCHAR(200), tags TEXT, messages LONGTEXT,
      linked_lead_id VARCHAR(100), linked_subscriber_id VARCHAR(100),
      created_at VARCHAR(50),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS client_code_counter (
      id INT PRIMARY KEY DEFAULT 1, next_value INT DEFAULT 10001
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS automation_workflows (
      id VARCHAR(100) PRIMARY KEY, name VARCHAR(300), `trigger` VARCHAR(100),
      action VARCHAR(100), enabled TINYINT(1) DEFAULT 1,
      conditions TEXT, action_config TEXT, last_triggered_at VARCHAR(50),
      trigger_count INT DEFAULT 0, created_at VARCHAR(50)
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS payment_proofs (
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
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS staff (
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
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(100) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      is_active TINYINT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4;

ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_staff (staff_id);

ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_txn_id (transaction_id(191));

ALTER TABLE staff ADD COLUMN IF NOT EXISTS permissions_json TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS daqqi_rounds (
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
    ) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS daqqi_attendees (
      round_id VARCHAR(36) NOT NULL,
      subscriber_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      phone VARCHAR(50) NOT NULL DEFAULT '',
      booked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      amount_paid DOUBLE NOT NULL DEFAULT 0,
      attended_lectures INT NOT NULL DEFAULT 0,
      PRIMARY KEY (round_id, subscriber_id)
    ) CHARACTER SET utf8mb4;

ALTER TABLE subscribers MODIFY COLUMN phone VARCHAR(50) NULL DEFAULT NULL;

ALTER TABLE leads MODIFY COLUMN phone VARCHAR(50) NULL DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (email(191));

CREATE TABLE IF NOT EXISTS payment_links (
    id VARCHAR(36) PRIMARY KEY,
    token VARCHAR(128) UNIQUE NOT NULL,
    item_type ENUM('course','bundle','consultation') NOT NULL,
    item_id VARCHAR(36) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'EGP',
    subscriber_id VARCHAR(36) DEFAULT NULL,
    description VARCHAR(500) DEFAULT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME DEFAULT NULL,
    created_by VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_token (token),
    INDEX idx_expires (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_appraisals (
    id              VARCHAR(36)  NOT NULL DEFAULT (UUID()),
    staff_id        VARCHAR(36)  NOT NULL,
    reviewer_email  VARCHAR(200) NULL,
    period_month    TINYINT      NOT NULL COMMENT '1-12',
    period_year     SMALLINT     NOT NULL,
    kpi_scores      JSON         NULL     COMMENT 'array of {kpi,target,achieved,score}',
    overall_score   DECIMAL(5,2) NULL     COMMENT '0-100',
    grade           VARCHAR(10)  NULL     COMMENT 'A/B/C/D',
    notes           TEXT         NULL,
    status          ENUM('draft','submitted','approved') NOT NULL DEFAULT 'draft',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_pa_staff  (staff_id),
    KEY idx_pa_period (period_year, period_month)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS course_waitlist (
        id            VARCHAR(36)  NOT NULL DEFAULT (UUID()),
        course_id     VARCHAR(36)  NOT NULL,
        subscriber_id VARCHAR(36)  NULL,
        name          VARCHAR(200) NULL,
        email         VARCHAR(200) NULL,
        phone         VARCHAR(50)  NULL,
        position      INT UNSIGNED NOT NULL DEFAULT 0,
        status        ENUM('waiting','notified','enrolled','cancelled') NOT NULL DEFAULT 'waiting',
        notified_at   DATETIME     NULL,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_wl_course (course_id, status),
        KEY idx_wl_sub    (subscriber_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS forum_posts (
    id            VARCHAR(36)  NOT NULL DEFAULT (UUID()),
    author_id     VARCHAR(36)  NOT NULL COMMENT 'subscriber.id',
    author_name   VARCHAR(200) NULL,
    course_id     VARCHAR(36)  NULL     COMMENT 'NULL = general community, set = course-specific',
    parent_id     VARCHAR(36)  NULL     COMMENT 'NULL = top-level post, set = reply',
    title         VARCHAR(300) NULL     COMMENT 'only for top-level posts',
    body          TEXT         NOT NULL,
    upvotes       INT UNSIGNED NOT NULL DEFAULT 0,
    is_pinned     TINYINT(1)   NOT NULL DEFAULT 0,
    is_hidden     TINYINT(1)   NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_fp_course  (course_id),
    KEY idx_fp_parent  (parent_id),
    KEY idx_fp_author  (author_id),
    KEY idx_fp_pinned  (is_pinned, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS forum_upvotes (
    post_id       VARCHAR(36)  NOT NULL,
    subscriber_id VARCHAR(36)  NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (post_id, subscriber_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sms_settings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      provider VARCHAR(50) DEFAULT 'vonage' COMMENT 'vonage|infobip|custom',
      api_key VARCHAR(255) DEFAULT '',
      api_secret VARCHAR(255) DEFAULT '',
      sender_id VARCHAR(50) DEFAULT 'MAHAD',
      is_active TINYINT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );

CREATE TABLE IF NOT EXISTS subscription_plans (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      billing_cycle ENUM('monthly','quarterly','yearly') DEFAULT 'monthly',
      description TEXT,
      is_active TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE IF NOT EXISTS subscriber_subscriptions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      subscriber_id INT NOT NULL,
      plan_id INT NOT NULL,
      status ENUM('active','paused','cancelled','expired') DEFAULT 'active',
      start_date DATE NOT NULL,
      next_billing_date DATE NOT NULL,
      end_date DATE,
      auto_renew TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_next_billing (next_billing_date),
      INDEX idx_subscriber (subscriber_id)
    );

CREATE TABLE IF NOT EXISTS login_history (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT,
      email VARCHAR(255),
      ip VARCHAR(64),
      user_agent VARCHAR(512),
      status ENUM('success','failed','2fa_pending','2fa_success') DEFAULT 'success',
      failure_reason VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_email (email),
      INDEX idx_created (created_at),
      INDEX idx_status (status)
    );

CREATE TABLE IF NOT EXISTS admin_notifications (
      id INT PRIMARY KEY AUTO_INCREMENT,
      type VARCHAR(50) NOT NULL COMMENT 'alert|info|warning|success',
      title VARCHAR(255) NOT NULL,
      message TEXT,
      link VARCHAR(512),
      is_read TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_read (is_read),
      INDEX idx_created (created_at)
    );

CREATE TABLE IF NOT EXISTS reminder_log (
      id INT PRIMARY KEY AUTO_INCREMENT,
      type ENUM('followup','payment_due') NOT NULL,
      ref_id VARCHAR(64) NOT NULL,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_type_ref_day (type, ref_id, sent_at)
    );

CREATE TABLE IF NOT EXISTS ip_whitelist (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ip VARCHAR(64) NOT NULL,
      label VARCHAR(255) DEFAULT NULL,
      added_by VARCHAR(36) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ip (ip)
    ) CHARACTER SET utf8mb4;

ALTER TABLE leads ADD COLUMN deal_value DECIMAL(10,2) DEFAULT NULL;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subscriber_id VARCHAR(100) DEFAULT NULL AFTER id;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data_json TEXT DEFAULT NULL AFTER message;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at DATETIME DEFAULT NULL AFTER data_json;

ALTER TABLE notifications MODIFY title VARCHAR(255) DEFAULT NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS score INT NOT NULL DEFAULT 0;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_value DECIMAL(10,2) DEFAULT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at DATETIME DEFAULT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS staff_id VARCHAR(36) DEFAULT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS staff_name VARCHAR(255) DEFAULT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS status ENUM('pending','paid','failed') NOT NULL DEFAULT 'paid';

ALTER TABLE payment_proofs CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE payments ADD INDEX idx_payments_course_id (course_id);

ALTER TABLE payments ADD UNIQUE INDEX idx_payments_txn (transaction_id);

ALTER TABLE leads ADD INDEX idx_leads_score (score);

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS assigned_sales_id VARCHAR(36) DEFAULT NULL;

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS assigned_sales_name VARCHAR(255) DEFAULT NULL;

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS branch ENUM('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT NULL;

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS assigned_cs_id VARCHAR(36) DEFAULT NULL;

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS assigned_cs_name VARCHAR(255) DEFAULT NULL;

ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subs_cs_id (assigned_cs_id);

ALTER TABLE course_completions MODIFY COLUMN subscriber_id VARCHAR(36) NOT NULL;

ALTER TABLE referral_codes MODIFY COLUMN subscriber_id VARCHAR(36) NOT NULL;

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS referred_by VARCHAR(20) DEFAULT NULL;

ALTER TABLE course_lectures ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS staff_name VARCHAR(255) DEFAULT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS from_account VARCHAR(255) DEFAULT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS source ENUM('web','staff','reception','daqqi','paymob','system') DEFAULT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS item_title VARCHAR(500) DEFAULT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS cert_type VARCHAR(255) DEFAULT NULL;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS department_id VARCHAR(36) DEFAULT NULL;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS manager_id VARCHAR(36) DEFAULT NULL;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS employment_type ENUM('FULL_TIME','PART_TIME','CONTRACT','FREELANCE') NOT NULL DEFAULT 'FULL_TIME';

ALTER TABLE staff ADD COLUMN IF NOT EXISTS hire_date DATE DEFAULT NULL;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS birth_date DATE DEFAULT NULL;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255) DEFAULT NULL;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS termination_date DATE DEFAULT NULL;

ALTER TABLE enrollments ADD UNIQUE KEY uniq_enroll_sub_course (subscriber_id, course_id);

ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_branch (branch);

ALTER TABLE enrollments ADD INDEX IF NOT EXISTS idx_enroll_sub_course (subscriber_id, course_id);

ALTER TABLE crm_commissions ADD INDEX IF NOT EXISTS idx_comm_year_month_status (year, month, status);

ALTER TABLE attendance_logs ADD INDEX IF NOT EXISTS idx_att_staff_date (staff_id, date);

ALTER TABLE salary_advances ADD INDEX IF NOT EXISTS idx_adv_staff_month (staff_id, deduct_month, deduct_year);

ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_pay_staff_date (staff_id, date, status);

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_assigned_sales (assigned_sales_id);

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_assigned_cs (assigned_cs_id);

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_hidden (hidden);

ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subs_sales (assigned_sales_id);

ALTER TABLE crm_commissions ADD INDEX IF NOT EXISTS idx_comm_client (client_id);

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_status (status);

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_phone (phone(20));

ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subs_phone (phone(20));

ALTER TABLE instructor_rates ADD COLUMN IF NOT EXISTS revenue_share_pct DECIMAL(5,2) DEFAULT 0 COMMENT \'% of course payment auto-credited as instructor fee\';

ALTER TABLE crm_commissions DROP FOREIGN KEY IF EXISTS fk_comm_client;

ALTER TABLE lectures ADD COLUMN IF NOT EXISTS drip_unlock_days SMALLINT UNSIGNED DEFAULT 0 COMMENT \'0=instant, N=unlock N days after enrollment\';

ALTER TABLE courses ADD COLUMN IF NOT EXISTS description TEXT NULL;

ALTER TABLE courses ADD COLUMN IF NOT EXISTS short_description TEXT NULL;

ALTER TABLE course_lectures ADD COLUMN IF NOT EXISTS description TEXT NULL;

ALTER TABLE course_lectures ADD COLUMN IF NOT EXISTS is_preview TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE course_lectures ADD COLUMN IF NOT EXISTS is_published TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE course_lectures ADD COLUMN IF NOT EXISTS drip_unlock_days INT NOT NULL DEFAULT 0;

ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS food_allowance DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS other_fixed DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS deduction_social_insurance DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE salary_structures ADD COLUMN IF NOT EXISTS deduction_tax DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE subscribers MODIFY COLUMN email VARCHAR(255) NULL DEFAULT NULL;

ALTER TABLE daqqi_rounds DROP FOREIGN KEY fk_daqqi_instructor;

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_source (source);

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_status_created (status, created_at);

ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_branch (branch);

ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_status_branch (status, branch);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority ENUM('low','medium','high','urgent') DEFAULT 'medium';

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_hours INT DEFAULT 24;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS responded_at DATETIME NULL;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_breached TINYINT(1) DEFAULT 0;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS escalated_to INT NULL;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS escalated_at DATETIME NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS retargeting_sent_at DATETIME NULL;

ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_retargeting_sent_at (retargeting_sent_at);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_source   VARCHAR(200) NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_medium   VARCHAR(200) NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(200) NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_content  VARCHAR(200) NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS utm_term     VARCHAR(200) NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_url TEXT NULL;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 0;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) DEFAULT 0;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount_before_vat DECIMAL(12,2) DEFAULT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS item_title VARCHAR(255) DEFAULT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS cert_type VARCHAR(100) DEFAULT NULL;

ALTER TABLE courses ADD COLUMN IF NOT EXISTS max_students INT UNSIGNED NULL COMMENT 'NULL = unlimited';

SET FOREIGN_KEY_CHECKS = 1;
-- 201 statements extracted.
