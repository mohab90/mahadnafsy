-- 097_installment_plans_payment_tracking.sql
-- installment_plans already tracked schedule (installment_amounts, due_dates,
-- paid_dates as parallel JSON arrays) but nothing ever wrote to it — the
-- admin UI (useInstallmentPlans.ts) only ever wrote installment plans into
-- subscribers.crm_json, so a confirmed installment payment never created a
-- payments row, never posted a journal entry, and was invisible to every
-- financial report (PAY-16). Adding two more parallel arrays so a confirmed
-- entry can be traced to the real payment it created and the amount actually
-- collected (which can differ from the originally scheduled amount).
ALTER TABLE installment_plans
  ADD COLUMN IF NOT EXISTS payment_ids JSON NULL COMMENT 'parallel array to installment_amounts — payments.id created for each paid entry, null if unpaid',
  ADD COLUMN IF NOT EXISTS paid_amounts JSON NULL COMMENT 'parallel array to installment_amounts — actual amount collected per entry, may differ from scheduled amount',
  ADD COLUMN IF NOT EXISTS course_id VARCHAR(100) NULL COMMENT 'the course this plan pays for, mutually exclusive with bundle_id',
  ADD COLUMN IF NOT EXISTS bundle_id VARCHAR(100) NULL COMMENT 'the bundle this plan pays for, mutually exclusive with course_id',
  ADD INDEX IF NOT EXISTS idx_inst_course (course_id),
  ADD INDEX IF NOT EXISTS idx_inst_bundle (bundle_id);
