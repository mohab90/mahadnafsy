-- Marks a pending payment as already announced to the accountant, so the hourly
-- overdue sweep nudges once per payment instead of complaining about the same
-- row every hour until someone acts on it.
ALTER TABLE payments
  ADD COLUMN review_overdue_notified_at DATETIME NULL DEFAULT NULL
  COMMENT 'When the >24h pending-review alert was raised for this payment.';

CREATE INDEX idx_payments_pending_review
  ON payments (tenant_id, status, review_overdue_notified_at);
