-- A promo code belongs to one tenant (HIGH-09 of the 7 Oct 2026 audit): the
-- table had no tenant_id, so every tenant listed, edited and redeemed every
-- other tenant's codes, and one tenant's code name blocked another's. Production
-- holds no codes yet; any there are belong to the one tenant there is.
--
-- The new key is added before the old one is dropped, so the code stays unique
-- throughout.
--
-- Rollback: ALTER TABLE promo_codes ADD UNIQUE KEY code (code), DROP INDEX uq_promo_tenant_code, DROP COLUMN tenant_id;

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER id;

ALTER TABLE promo_codes
  ADD UNIQUE INDEX IF NOT EXISTS uq_promo_tenant_code (tenant_id, code);

DROP INDEX IF EXISTS code ON promo_codes;
