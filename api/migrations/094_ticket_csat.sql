-- Per-ticket CSAT (customer satisfaction rating on resolution).
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS csat_score TINYINT UNSIGNED DEFAULT NULL COMMENT '1-5',
  ADD COLUMN IF NOT EXISTS csat_comment TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS csat_requested_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS csat_responded_at DATETIME DEFAULT NULL;
