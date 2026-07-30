-- Link certificate payments to the exact certificate request they settle.
-- Required so pending approval can update the same request atomically later.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS certificate_request_id VARCHAR(36) DEFAULT NULL AFTER cert_type;

CREATE INDEX IF NOT EXISTS idx_payments_certificate_request
  ON payments (tenant_id, certificate_request_id);

ALTER TABLE payments
  ADD CONSTRAINT IF NOT EXISTS fk_payments_certificate_request
  FOREIGN KEY (certificate_request_id) REFERENCES certificate_requests(id)
  ON DELETE SET NULL;
