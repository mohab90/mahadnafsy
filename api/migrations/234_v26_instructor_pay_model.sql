-- «لازم كل محاضرة ندخل احنا بنحاسبه ازاي — المحاضرين معانا يا بيشتغل بالمحاضرة يا
-- بيشتغل بالساعة … وفي حاجة اسمها مكافأة تدوير العملاء: كل عميل كمّل كورس جديد مع
-- نفس المحاضر بتنزل مكافأة».
--
-- One rate per instructor (instructor_rates), paid one of three ways:
--   per_lecture    lecture_rate for every lecture delivered
--   per_hour       lecture_rate_per_hour × the lecture's hours (the session's own
--                  length, else lecture_hours)
--   revenue_share  revenue_share_pct of every payment for their course — what the
--                  system did until now, kept as the default so no instructor's pay
--                  changes until someone chooses another basis for them
-- and, on top of any of them, a retention bonus when a client who studied with
-- them pays for another of their courses: a fixed amount or a percentage of that
-- payment (retention_bonus_type / retention_bonus_value).
--
-- Delivered lectures become instructor_fees rows on their own — a Dokki round's
-- week marked held, an online live session that ended — keyed by source_key so
-- the same lecture is never paid twice, and left pending for the accounts team to
-- approve or correct. Rate changes still go through instructor_rate_change_requests
-- and a second person's approval.
--
-- Every column is nullable or defaulted to today's behaviour; nothing is rewritten.
-- Rollback: drop the added columns and the uq_instructor_fee_source key, and
-- MODIFY fee_type back without 'retention' once no row holds it.

ALTER TABLE instructor_rates
  ADD COLUMN IF NOT EXISTS pay_basis enum('revenue_share','per_lecture','per_hour') NOT NULL DEFAULT 'revenue_share',
  ADD COLUMN IF NOT EXISTS lecture_rate decimal(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lecture_hours decimal(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS retention_bonus_type enum('fixed','percentage') DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS retention_bonus_value decimal(12,2) DEFAULT NULL;

ALTER TABLE instructor_rate_change_requests
  ADD COLUMN IF NOT EXISTS pay_basis enum('revenue_share','per_lecture','per_hour') DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lecture_rate decimal(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lecture_hours decimal(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS revenue_share_pct decimal(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS retention_bonus_type enum('fixed','percentage') DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS retention_bonus_value decimal(12,2) DEFAULT NULL;

ALTER TABLE instructor_fees
  MODIFY COLUMN fee_type enum('lecture','training','consultation','fixed','retention') NOT NULL DEFAULT 'lecture',
  ADD COLUMN IF NOT EXISTS source_key varchar(191) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lecture_date date DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subscriber_id varchar(36) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trigger_payment_id varchar(100) DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_instructor_fee_source ON instructor_fees (tenant_id, source_key);
CREATE INDEX IF NOT EXISTS idx_instructor_fees_trigger ON instructor_fees (tenant_id, trigger_payment_id);
CREATE INDEX IF NOT EXISTS idx_instructor_fees_period ON instructor_fees (tenant_id, period_year, period_month, staff_id);
