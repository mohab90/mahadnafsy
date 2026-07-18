-- Consolidates columns that route code (api/routes/**) already references but
-- were never added to the schema — found by a static schema-drift scan.
-- Applied automatically at boot by api/lib/startupTasks.js (schema_version 51);
-- this file exists for history/documentation, matching the numbered-migration
-- convention used elsewhere in this directory.

ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS target_course_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS is_unsubscribed TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_unsubscribed TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS thumbnail TEXT DEFAULT NULL;
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS details_content_json TEXT DEFAULT NULL;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS params TEXT DEFAULT NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS certificate_template_name VARCHAR(255) DEFAULT NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS certificate_template_url TEXT DEFAULT NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(255) DEFAULT NULL;
