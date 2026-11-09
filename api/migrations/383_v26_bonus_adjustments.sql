-- 9 Nov 2026: the owner edits a month's bonus «علي مكافاه وحساب كل موظف» — what the system worked out (lib/monthlyBonuses.js) stays as it is, and what the owner
-- changes is kept beside it, each with who, when and why (a reason is required):
--   EXCLUDE_BOOKING   a booking leaves a rep's count               (staff_id = the rep, payment_id = the booking's first payment)
--   REASSIGN_BOOKING  a booking counts for another rep              (staff_id = who it counted for, to_staff_id = who it counts for now)
--   WEIGHT_BOOKING    a booking counts as this many bookings        (payment_id, weight)
--   TOTAL_OVERRIDE    the employee's month total is this amount     (staff_id, amount) — the computed figure is shown beside it
-- A change is taken back (revoked_at) and never deleted, so the month's history reads whole; a newer change to the same thing replaces the older one.
CREATE TABLE IF NOT EXISTS bonus_adjustments (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  for_year SMALLINT NOT NULL,
  for_month TINYINT NOT NULL,
  kind VARCHAR(24) NOT NULL,
  staff_id VARCHAR(36) NULL,
  payment_id VARCHAR(100) NULL,
  to_staff_id VARCHAR(36) NULL,
  weight DECIMAL(5,2) NULL,
  amount DECIMAL(12,2) NULL,
  reason VARCHAR(500) NOT NULL,
  created_by VARCHAR(36) NULL,
  created_by_name VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  revoked_by VARCHAR(36) NULL,
  revoked_by_name VARCHAR(255) NULL,
  revoked_reason VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY idx_bonus_adj_month (tenant_id, for_year, for_month, revoked_at),
  KEY idx_bonus_adj_payment (tenant_id, payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
