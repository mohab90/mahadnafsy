ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS fx_rate_to_egp DECIMAL(18,8) NULL AFTER currency,
  ADD COLUMN IF NOT EXISTS amount_egp DECIMAL(18,2) NULL AFTER fx_rate_to_egp,
  ADD COLUMN IF NOT EXISTS fx_source VARCHAR(50) NULL AFTER amount_egp,
  ADD COLUMN IF NOT EXISTS fx_applied_at DATETIME NULL AFTER fx_source,
  ADD INDEX IF NOT EXISTS idx_payments_tenant_amount_egp (tenant_id, status, date, amount_egp);

-- Freeze legacy reporting behaviour once so historical totals stop changing.
UPDATE payments
SET fx_rate_to_egp = CASE UPPER(COALESCE(currency,'EGP')) WHEN 'SAR' THEN 13 WHEN 'USD' THEN 48 ELSE 1 END,
    amount_egp = ROUND(amount * CASE UPPER(COALESCE(currency,'EGP')) WHEN 'SAR' THEN 13 WHEN 'USD' THEN 48 ELSE 1 END, 2),
    fx_source = 'legacy-backfill',
    fx_applied_at = COALESCE(created_at, date, NOW())
WHERE amount_egp IS NULL;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS fx_rate_to_egp DECIMAL(18,8) NULL AFTER currency,
  ADD COLUMN IF NOT EXISTS amount_egp DECIMAL(18,2) NULL AFTER fx_rate_to_egp,
  ADD COLUMN IF NOT EXISTS fx_source VARCHAR(50) NULL AFTER amount_egp,
  ADD COLUMN IF NOT EXISTS fx_applied_at DATETIME NULL AFTER fx_source;

UPDATE expenses
SET fx_rate_to_egp = CASE UPPER(COALESCE(currency,'EGP')) WHEN 'SAR' THEN 13 WHEN 'USD' THEN 48 ELSE 1 END,
    amount_egp = ROUND(amount * CASE UPPER(COALESCE(currency,'EGP')) WHEN 'SAR' THEN 13 WHEN 'USD' THEN 48 ELSE 1 END, 2),
    fx_source = 'legacy-backfill',
    fx_applied_at = COALESCE(created_at, date, NOW())
WHERE amount_egp IS NULL;
