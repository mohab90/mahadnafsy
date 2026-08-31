-- The FX backfill contradicted the ledger it was supposed to freeze.
--
-- Migration 085 wrote, for every payment with no amount_egp yet:
--
--     fx_rate_to_egp = CASE currency WHEN 'SAR' THEN 13 WHEN 'USD' THEN 48 ELSE 1 END
--
-- and called it "freeze legacy reporting behaviour once so historical totals
-- stop changing". For EGP that is exact — the rate is 1. For a foreign payment
-- that already had a journal entry it is not: the entry was posted at the rate
-- that was live on the day, and the backfill overwrote the payment row with a
-- flat constant instead of reading it back.
--
-- Production carries exactly one such row, and the reconciliation check named
-- it: pay-1778063424103, 250 SAR on 2026-05-03, amount_egp frozen at 3,250.00
-- (250 x 13) against a journal posting 3,328.05 (250 x 13.3122). Same payment,
-- two different amounts of money, 78.05 EGP apart — and every report reading
-- SUM(amount_egp) disagreed with the trial balance by that much.
--
-- The journal wins. It is the double-entry record, it balances, it was written
-- at the time, and the period it belongs to may well be closed; the payment
-- row's snapshot is a derived convenience that was filled in afterwards from a
-- constant. So the snapshot is re-derived from the posted entry rather than the
-- entry being adjusted to match a number invented by a later migration.
--
-- Scoped tightly on purpose: foreign currency only (EGP cannot drift at rate 1),
-- only rows the backfill itself wrote, only where a balanced payment journal
-- exists, and only where the two actually disagree by at least a piastre.
UPDATE payments p
JOIN (
  SELECT je.ref_id AS payment_id, SUM(jel.debit) AS posted_egp
    FROM journal_entries je
    JOIN journal_entry_lines jel ON jel.entry_id = je.id AND jel.account_code = '1100'
   WHERE je.ref_type = 'payment'
   GROUP BY je.ref_id
  HAVING SUM(jel.debit) > 0
) j ON j.payment_id = p.id
SET p.amount_egp     = ROUND(j.posted_egp, 2),
    p.fx_rate_to_egp = ROUND(j.posted_egp / NULLIF(p.amount, 0), 8),
    p.fx_source      = 'ledger-derived'
WHERE UPPER(COALESCE(p.currency, 'EGP')) <> 'EGP'
  AND p.deleted_at IS NULL
  AND p.amount > 0
  AND p.fx_source = 'legacy-backfill'
  AND ABS(COALESCE(p.amount_egp, 0) - j.posted_egp) >= 0.01;
