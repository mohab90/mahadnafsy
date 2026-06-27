-- 023_staff_sales_targets.sql
-- Persist per-staff sales targets + monthly bonus.
--
-- Before this, StaffMember.monthlyTarget / monthlyTargetType / monthlyBonus existed
-- in the type and were editable in the UI (SalesGoalsTab, HR, StaffSettings) but NO
-- backend route wrote them — saving silently dropped them, so goals never survived a
-- refresh. These columns close that round-trip; POST /api/admin/staff now persists
-- them and GET /api/admin/staff returns them (aliased to camelCase).
--
-- Idempotent: core.js also adds these at startup (ADD COLUMN IF NOT EXISTS); this file
-- is the migration-of-record. Safe on the live (small) staff table.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_target DECIMAL(12,2) DEFAULT NULL;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_target_type VARCHAR(10) DEFAULT NULL;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_leads_target INT DEFAULT NULL;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS monthly_bonus DECIMAL(12,2) DEFAULT NULL;
