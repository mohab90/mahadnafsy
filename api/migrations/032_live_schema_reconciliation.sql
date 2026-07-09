-- 032_live_schema_reconciliation.sql
-- Reconciles schema.sql with the ACTUAL shape of the live prod database
-- (verified 2026-07-09 against a full mysqldump). The live DB drifted from
-- schema.sql via direct hotfixes over time; this migration adopts the live,
-- battle-tested shape so importing real production data never fails or
-- silently truncates values.
--
-- leads.status: migration 006_normalize_lead_statuses.sql already normalized
-- the DATA to lowercase (matches admin frontend/analytics/automation), but the
-- COLUMN stayed an uppercase ENUM. Live widened it to VARCHAR(50) — adopt that.
ALTER TABLE IF EXISTS leads
  MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'new';

-- orders.payment_method: same pattern — live widened ENUM to VARCHAR to avoid
-- schema migrations every time a new payment method is added.
ALTER TABLE IF EXISTS orders
  MODIFY COLUMN payment_method VARCHAR(50) NOT NULL DEFAULT 'CARD';

-- staff.role: live has 4 roles added after schema.sql was written (HR dept +
-- branch/collection managers introduced later).
ALTER TABLE IF EXISTS staff
  MODIFY COLUMN role ENUM(
    'INSTRUCTOR','TRAINER','EXPERT','SALES','MANAGER','ADMIN','SUPPORT',
    'RECEPTION_DAQQI','COLLECTION','ACCOUNTANT','CONSULTANT','OTHER',
    'ONLINE_MANAGER','DAQQI_MANAGER','SALES_COLLECTION_MANAGER','HR'
  ) NOT NULL;

-- leads.phone / subscribers.email / subscribers.phone: live allows NULL (real
-- rows exist with no phone/email captured yet — e.g. partial lead-form
-- submissions). schema.sql's NOT NULL would reject importing those rows.
ALTER TABLE IF EXISTS leads
  MODIFY COLUMN phone VARCHAR(50) DEFAULT NULL;
ALTER TABLE IF EXISTS subscribers
  MODIFY COLUMN email VARCHAR(255) DEFAULT NULL,
  MODIFY COLUMN phone VARCHAR(50) DEFAULT NULL;
