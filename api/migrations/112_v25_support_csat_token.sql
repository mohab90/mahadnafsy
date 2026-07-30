-- Public CSAT links are bearer capabilities; ticket UUID alone is not enough.
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS csat_token_hash CHAR(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS csat_token_expires_at DATETIME DEFAULT NULL,
  ADD UNIQUE INDEX IF NOT EXISTS uq_support_csat_token_hash (csat_token_hash);
