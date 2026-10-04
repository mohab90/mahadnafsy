-- «لازم يكون في رقم لكل عمليه داخل السيستم».
--
-- A payment's id is a UUID or a prefixed key («paymob-…») — nothing a person
-- can read out on the phone or write on a receipt. payment_no is a plain
-- running number, given by the database to every payment as it is inserted
-- (no write path has to remember it), and given to the existing ones in the
-- order they were recorded: the oldest payment is 1.
--
-- The renumbering goes through negatives so the unique key never sees two rows
-- with one number mid-statement, and ends on the same set of values the column
-- was filled with (1..N), so the next payment is N+1.
--
-- Rollback: ALTER TABLE payments DROP INDEX uq_payments_no, DROP COLUMN payment_no.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_no BIGINT NOT NULL AUTO_INCREMENT,
  ADD UNIQUE KEY IF NOT EXISTS uq_payments_no (payment_no);

UPDATE payments p
  JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, `date`, id) AS rn FROM payments) ordered ON ordered.id = p.id
   SET p.payment_no = -ordered.rn;

UPDATE payments SET payment_no = -payment_no WHERE payment_no < 0;
