ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS merged_into_lead_id VARCHAR(100) NULL,
  ADD INDEX IF NOT EXISTS idx_leads_tenant_merged (tenant_id, merged_into_lead_id);

CREATE TABLE IF NOT EXISTS lead_merge_audit (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  target_lead_id VARCHAR(100) NOT NULL,
  source_lead_id VARCHAR(100) NOT NULL,
  actor VARCHAR(255) NULL,
  snapshot_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_merge_source (tenant_id, source_lead_id),
  INDEX idx_lead_merge_target (tenant_id, target_lead_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
