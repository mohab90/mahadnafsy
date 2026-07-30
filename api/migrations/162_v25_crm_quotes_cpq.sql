-- Auditable CRM quotes with immutable catalog snapshots and discount approval.
CREATE TABLE IF NOT EXISTS crm_quotes (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  quote_number VARCHAR(40) NOT NULL,
  lead_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) DEFAULT NULL,
  currency ENUM('EGP','SAR','USD') NOT NULL DEFAULT 'EGP',
  status ENUM('draft','pending_approval','approved','sent','accepted','rejected','expired','converted','cancelled')
    NOT NULL DEFAULT 'draft',
  valid_until DATE NOT NULL,
  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  approval_required TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT DEFAULT NULL,
  terms TEXT DEFAULT NULL,
  created_by VARCHAR(200) NOT NULL,
  updated_by VARCHAR(200) DEFAULT NULL,
  approved_by VARCHAR(200) DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  sent_at DATETIME DEFAULT NULL,
  accepted_at DATETIME DEFAULT NULL,
  rejected_at DATETIME DEFAULT NULL,
  converted_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_quote_number (tenant_id, quote_number),
  KEY idx_crm_quotes_lead (tenant_id, lead_id, created_at),
  KEY idx_crm_quotes_status_validity (tenant_id, status, valid_until),
  CONSTRAINT chk_crm_quote_totals CHECK (
    subtotal >= 0 AND discount_percent BETWEEN 0 AND 100
    AND discount_amount >= 0 AND tax_percent BETWEEN 0 AND 100
    AND tax_amount >= 0 AND total >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_quote_items (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  quote_id VARCHAR(36) NOT NULL,
  item_type ENUM('course','bundle') NOT NULL,
  item_id VARCHAR(36) NOT NULL,
  description VARCHAR(500) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(14,2) NOT NULL,
  line_subtotal DECIMAL(14,2) NOT NULL,
  catalog_snapshot JSON NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_quote_item (tenant_id, quote_id, item_type, item_id),
  KEY idx_crm_quote_items_quote (tenant_id, quote_id, sort_order),
  CONSTRAINT fk_crm_quote_item_quote FOREIGN KEY (quote_id) REFERENCES crm_quotes(id) ON DELETE RESTRICT,
  CONSTRAINT chk_crm_quote_item_amounts CHECK (quantity > 0 AND unit_price >= 0 AND line_subtotal >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_quote_approvals (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  quote_id VARCHAR(36) NOT NULL,
  decision ENUM('requested','approved','rejected') NOT NULL,
  actor_id VARCHAR(200) NOT NULL,
  note VARCHAR(1000) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_crm_quote_approvals (tenant_id, quote_id, created_at),
  CONSTRAINT fk_crm_quote_approval_quote FOREIGN KEY (quote_id) REFERENCES crm_quotes(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_quote_orders (
  tenant_id VARCHAR(64) NOT NULL,
  quote_id VARCHAR(36) NOT NULL,
  quote_item_id VARCHAR(36) NOT NULL,
  order_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, quote_id, quote_item_id),
  UNIQUE KEY uq_crm_quote_order (tenant_id, order_id),
  CONSTRAINT fk_crm_quote_order_quote FOREIGN KEY (quote_id) REFERENCES crm_quotes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_quote_order_item FOREIGN KEY (quote_item_id) REFERENCES crm_quote_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crm_quote_order_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
