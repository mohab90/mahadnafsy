-- Asking to move a consultation (25 Oct 2026).
--
-- «طلب تأجيل من العميل أو المحاضر»: instead of cancelling, either side proposes another day and one of the lecturer's weekly hours
-- (lib/consultationReschedule.js). Nothing moves until the other side accepts; the proposal is checked again when it is accepted.
CREATE TABLE IF NOT EXISTS consultation_reschedules (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  consultation_id VARCHAR(36) NOT NULL,
  proposed_by ENUM('lecturer','client') NOT NULL,
  old_session_at DATETIME NOT NULL,
  new_session_at DATETIME NOT NULL,
  new_slot_id VARCHAR(36) NULL,
  reason VARCHAR(500) NULL,
  status ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
  decision_note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_consultation_reschedules (tenant_id, consultation_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
