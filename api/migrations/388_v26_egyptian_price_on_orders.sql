-- 12 Nov 2026, the owner on the Egypt site's two prices: «السعر هيكون 3400، ولو سجّل إنه مصري يظهرله سعر 2800». The prices are the tiers that already exist (lib/priceTiers.js);
-- what is missing is a record, on the order, of the tier it was priced at: the price the site showed (list_price), what «خصم المصريين» took off it, and what the discount rested on
-- ('national_id', or 'record' for a client already recorded as Egyptian). NULL on every order written before this and on every order made while the feature is off.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS price_tier VARCHAR(30) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS list_price DECIMAL(12,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS egyptian_discount DECIMAL(12,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS discount_basis VARCHAR(20) NULL DEFAULT NULL;

-- Every checkout that types a national ID asks whether another client already holds it (applyBookingIdentity and the certificate screen ask the same): by key, not by scanning the clients.
ALTER TABLE subscribers ADD KEY IF NOT EXISTS idx_subscribers_tenant_national_id (tenant_id, national_id);
