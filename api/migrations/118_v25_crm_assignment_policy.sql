CREATE TABLE IF NOT EXISTS crm_assignment_members (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  staff_id VARCHAR(36) NOT NULL,
  branch_key VARCHAR(64) NOT NULL DEFAULT '*',
  team_key VARCHAR(64) NOT NULL DEFAULT 'sales',
  weight DECIMAL(8,2) NOT NULL DEFAULT 1,
  max_open_leads INT NULL,
  is_available TINYINT(1) NOT NULL DEFAULT 1,
  last_assigned_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_assignment_scope (tenant_id,staff_id,branch_key,team_key),
  INDEX idx_crm_assignment_pick (tenant_id,team_key,branch_key,is_available,last_assigned_at),
  CONSTRAINT fk_crm_assignment_staff FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO crm_assignment_members
  (id,tenant_id,staff_id,branch_key,team_key,weight,max_open_leads,is_available)
SELECT UUID(),tenant_id,id,'*','sales',1,NULL,1
FROM staff
WHERE UPPER(role)='SALES' AND is_active=1 AND deleted_at IS NULL;
