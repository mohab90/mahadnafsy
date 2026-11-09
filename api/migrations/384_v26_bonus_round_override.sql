-- 9 Nov 2026, the owner's bonus screens on the half-month rounds:
--   ROUND_OVERRIDE  one round's bonus of a rep is this amount (staff_id, round_no 1|2, amount) — what the plan worked out stays beside it, a reason is required, revocable.
--   COUNT_IN_MONTH  a booking paid in the month after (or before) counts in THIS month for a rep (staff_id, payment_id): «الحجز اترفع متأخر». The payment itself,
--                   its date and every money record are untouched; only the month the bonus counts it in moves.
-- Both ride the same table as migration 383; the kind column (VARCHAR 24) already holds the new names, the round needs a column of its own.
ALTER TABLE bonus_adjustments ADD COLUMN IF NOT EXISTS round_no TINYINT NULL AFTER split_day;
