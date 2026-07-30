-- Freeze the discount-approval rule used when each quote was created.
ALTER TABLE crm_quotes
  ADD COLUMN IF NOT EXISTS approval_level ENUM('none','manager','executive')
    NOT NULL DEFAULT 'none' AFTER approval_required,
  ADD COLUMN IF NOT EXISTS approval_policy_snapshot JSON DEFAULT NULL AFTER approval_level,
  ADD INDEX IF NOT EXISTS idx_crm_quotes_approval_queue
    (tenant_id, status, approval_level, created_at);
