-- Evidence-backed conversation coaching; reviews cannot exist without source evidence.
CREATE TABLE IF NOT EXISTS crm_communication_evidence (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  communication_id VARCHAR(36) NOT NULL,
  evidence_type ENUM('recording','transcript','email','whatsapp','note') NOT NULL,
  evidence_url VARCHAR(2000) DEFAULT NULL,
  content_text MEDIUMTEXT DEFAULT NULL,
  content_sha256 CHAR(64) NOT NULL,
  captured_by VARCHAR(200) NOT NULL,
  captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_communication_evidence_hash (tenant_id, communication_id, content_sha256),
  KEY idx_crm_communication_evidence (tenant_id, communication_id, captured_at),
  CONSTRAINT fk_crm_evidence_communication FOREIGN KEY (communication_id) REFERENCES communications(id) ON DELETE RESTRICT,
  CONSTRAINT chk_crm_evidence_content CHECK (evidence_url IS NOT NULL OR content_text IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_coaching_reviews (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  communication_id VARCHAR(36) NOT NULL,
  evidence_id VARCHAR(36) NOT NULL,
  staff_id VARCHAR(36) NOT NULL,
  reviewer_id VARCHAR(200) NOT NULL,
  discovery_score TINYINT UNSIGNED NOT NULL,
  empathy_score TINYINT UNSIGNED NOT NULL,
  accuracy_score TINYINT UNSIGNED NOT NULL,
  next_step_score TINYINT UNSIGNED NOT NULL,
  total_score DECIMAL(5,2) NOT NULL,
  comments VARCHAR(2000) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_coaching_review (tenant_id, communication_id, reviewer_id),
  KEY idx_crm_coaching_staff (tenant_id, staff_id, created_at),
  CONSTRAINT fk_crm_coaching_communication FOREIGN KEY (communication_id) REFERENCES communications(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_coaching_evidence FOREIGN KEY (evidence_id) REFERENCES crm_communication_evidence(id) ON DELETE RESTRICT,
  CONSTRAINT chk_crm_coaching_scores CHECK (
    discovery_score BETWEEN 0 AND 5 AND empathy_score BETWEEN 0 AND 5
    AND accuracy_score BETWEEN 0 AND 5 AND next_step_score BETWEEN 0 AND 5
    AND total_score BETWEEN 0 AND 100
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
