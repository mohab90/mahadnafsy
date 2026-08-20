-- Recruitment workflow + the HR gaps behind it.
--
-- طلبات الانضمام could only be marked NEW/REVIEWED/ACCEPTED/REJECTED, which
-- loses the step the desk actually works in: someone rings the applicant, and
-- the outcome of THAT call is what decides accept/reject. There was nowhere to
-- record that the call happened, when, or who made it — so a second person had
-- no way to know the applicant had already been contacted.
--
-- Everything here is additive. No column is dropped, no enum member is removed,
-- and every new column is NULL-able, so existing rows keep their exact current
-- meaning and any code that does not know about these columns is unaffected.

-- ── طلبات الانضمام: the contact step ─────────────────────────────────────────
-- 'CONTACTED' sits between REVIEWED and the accept/reject decision. Added to
-- the end of the enum: MySQL stores enums by ordinal, so appending is safe while
-- inserting in the middle would silently re-label existing rows.
ALTER TABLE IF EXISTS join_us_applications
  MODIFY COLUMN status ENUM('NEW','REVIEWED','ACCEPTED','REJECTED','CONTACTED')
    NOT NULL DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS contacted_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS contacted_by VARCHAR(36) NULL DEFAULT NULL,
  -- NULL against an ACCEPTED row is the meaningful "مقبول ولم يتحدد موعد" state,
  -- which is why acceptance is not modelled as two separate enum members.
  ADD COLUMN IF NOT EXISTS interview_at DATETIME NULL DEFAULT NULL;

-- ── الانترفيوهات: letter grades, and who gave them ───────────────────────────
-- job_applicants.interview_rating (tinyint 1-5) is deliberately left in place
-- and untouched — it holds real ratings. The desk grades A+..W, which is a
-- different scale rather than a wider one, so it gets its own column instead of
-- a lossy conversion of the old values.
ALTER TABLE IF EXISTS job_applicants
  ADD COLUMN IF NOT EXISTS interview_grade ENUM('A+','A','B+','B','C+','C','R','W') NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS interviewed_by VARCHAR(36) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS interviewed_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS second_interview_grade ENUM('A+','A','B+','B','C+','C','R','W') NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS second_interviewed_by VARCHAR(36) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS second_interviewed_at DATETIME NULL DEFAULT NULL;

ALTER TABLE IF EXISTS job_applicants
  ADD INDEX IF NOT EXISTS idx_applicants_grade (tenant_id, interview_grade);

-- ── Notes that keep their author ─────────────────────────────────────────────
-- Both screens need "who wrote this, and when". join_us_applications.admin_note
-- is a single overwritable text field, so the previous note and its author were
-- lost on every edit. Append-only, and shared by both screens so a candidate's
-- history survives the move from طلبات الانضمام to الانترفيوهات.
CREATE TABLE IF NOT EXISTS recruitment_notes (
  id VARCHAR(36) NOT NULL DEFAULT (uuid()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ref_type ENUM('join_us','applicant') NOT NULL,
  ref_id VARCHAR(36) NOT NULL,
  kind ENUM('note','contact','evaluation') NOT NULL DEFAULT 'note',
  body TEXT NOT NULL,
  author_id VARCHAR(36) NULL DEFAULT NULL,
  author_name VARCHAR(200) NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_recruitment_notes_ref (tenant_id, ref_type, ref_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Staff pay basis ──────────────────────────────────────────────────────────
-- staff already carries commission_rate and monthly_target but nothing that says
-- which of them applies, so a percentage earner and a target earner were
-- indistinguishable and payroll had to guess. base_salary had no column at all.
ALTER TABLE IF EXISTS staff
  ADD COLUMN IF NOT EXISTS base_salary DECIMAL(12,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS commission_type ENUM('NONE','PERCENT','TARGET') NOT NULL DEFAULT 'NONE';

-- ── Employee document file ───────────────────────────────────────────────────
-- What HR must physically hold for each employee. One row per required document
-- so "not recorded yet" (no row) stays distinct from "asked for and not
-- delivered" (received = 0).
CREATE TABLE IF NOT EXISTS staff_documents (
  id VARCHAR(36) NOT NULL DEFAULT (uuid()),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  staff_id VARCHAR(36) NOT NULL,
  doc_type ENUM(
    'NATIONAL_ID',      -- صورة بطاقة الرقم القومي
    'PHOTOS',           -- صورتان شخصيتان
    'QUALIFICATION',    -- صورة المؤهل
    'BIRTH_CERT',       -- شهادة الميلاد
    'WORK_STUB',        -- كعب العمل
    'INSURANCE_PRINT',  -- برنت التأمين
    'MILITARY'          -- الموقف من الخدمة العسكرية
  ) NOT NULL,
  received TINYINT(1) NOT NULL DEFAULT 0,
  note VARCHAR(500) NULL DEFAULT NULL,
  updated_by VARCHAR(36) NULL DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_doc (tenant_id, staff_id, doc_type),
  KEY idx_staff_documents_staff (tenant_id, staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── إذن تأخير / إذن انصراف مبكر ──────────────────────────────────────────────
-- On `leaves`, which is the table the self-service form writes to AND the one
-- routes/hr/attendance.js approves from. Not `leave_requests`: that table was
-- abandoned precisely because no approval screen ever read it (HR-02), so a
-- permission type added there would be un-approvable — the same bug again.
--
-- Appended to the existing enum so these ride the approval flow, notifications
-- and payroll handling that leave already has. `PERMISSION` is left in place;
-- it stays valid for a generic permission, while these two say which kind, which
-- is what the payroll deduction rules need to tell apart.
--
-- salary_advances and leave_requests are deliberately NOT touched here: both
-- already got tenant_id from migration 068, and the self-service advance request
-- endpoint already exists. api/schema.sql simply never declared those columns,
-- which is drift in the reference file rather than a missing constraint.
ALTER TABLE IF EXISTS leaves
  MODIFY COLUMN type ENUM('ANNUAL','SICK','UNPAID','MATERNITY','EMERGENCY','PERMISSION','OTHER','LATE_PERMIT','EARLY_LEAVE')
    NOT NULL DEFAULT 'ANNUAL';
