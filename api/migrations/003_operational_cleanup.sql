-- Operational cleanup for lead retargeting and payment-sync stability.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS retargeting_sent_at DATETIME NULL;

ALTER TABLE leads
  ADD INDEX IF NOT EXISTS idx_leads_retargeting_sent_at (retargeting_sent_at);
