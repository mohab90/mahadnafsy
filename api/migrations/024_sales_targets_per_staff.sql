-- 024_sales_targets_per_staff.sql
-- Single source of truth for per-staff, per-month sales targets.
--
-- Before this, sales/collection targets lived in localStorage in three different
-- places (SalesGoalsTab, LeadsPerformancePanel crm.salesTargets, OverviewTab
-- coll.monthlyTarget) — per-browser, not shared, lost on device change. This table
-- replaces all three. staff_id '__collection__' holds the org-wide collection
-- monthly target.
--
-- Idempotent: analytics.js also creates this at startup (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS sales_targets (
  staff_id VARCHAR(64) NOT NULL,
  period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
  revenue_target DECIMAL(12,2) DEFAULT 0,
  leads_target INT DEFAULT 0,
  updated_by VARCHAR(64) DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (staff_id, period)
) COLLATE utf8mb4_unicode_ci;
