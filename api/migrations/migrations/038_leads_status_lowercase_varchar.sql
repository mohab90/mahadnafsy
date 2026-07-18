-- Leads status must stay lowercase/varchar because the Admin UI and filters use
-- business states beyond the old uppercase enum, such as no_answer_wa.

ALTER TABLE leads
  MODIFY status VARCHAR(50) NOT NULL DEFAULT 'new';

UPDATE leads
SET status = LOWER(status)
WHERE status <> LOWER(status);

ALTER TABLE leads
  ADD INDEX IF NOT EXISTS idx_leads_status_lower (status);
