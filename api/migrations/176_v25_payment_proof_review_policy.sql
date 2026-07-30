ALTER TABLE payment_proofs
  ADD COLUMN review_due_at DATETIME NULL AFTER submitted_at,
  ADD COLUMN risk_level ENUM('standard','high') NOT NULL DEFAULT 'standard' AFTER review_due_at,
  ADD COLUMN second_review_required TINYINT(1) NOT NULL DEFAULT 0 AFTER risk_level,
  ADD COLUMN first_reviewer_id VARCHAR(100) NULL AFTER second_review_required,
  ADD COLUMN first_review_note TEXT NULL AFTER first_reviewer_id,
  ADD COLUMN first_reviewed_at DATETIME NULL AFTER first_review_note,
  ADD INDEX idx_payment_proof_sla (tenant_id,status,review_due_at),
  ADD INDEX idx_payment_proof_second_review (tenant_id,second_review_required,first_reviewed_at,status);

UPDATE payment_proofs
   SET review_due_at=DATE_ADD(submitted_at,INTERVAL 4 HOUR)
 WHERE review_due_at IS NULL;
