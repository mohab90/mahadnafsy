-- «خليه يتحول اتوماتك للجنيه».
--
-- Paymob Egypt charges in EGP. A SAR or USD order sent to it as-is never
-- reached Paymob's dashboard at all — the 95 SAR order of 6 September sat
-- pending with nothing on Paymob's side. The order keeps the customer's price
-- in its own currency; what was actually asked of Paymob, in EGP and at which
-- rate, is recorded here so the webhook checks the capture against it.
--
-- Rollback: ALTER TABLE orders DROP COLUMN charge_amount, DROP COLUMN charge_currency, DROP COLUMN charge_fx_rate.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS charge_amount DECIMAL(12,2) NULL,
  ADD COLUMN IF NOT EXISTS charge_currency CHAR(3) NULL,
  ADD COLUMN IF NOT EXISTS charge_fx_rate DECIMAL(12,6) NULL;
