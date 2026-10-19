-- The name of whoever the money was transferred FROM, kept on the payment (19 Oct 2026).
--
-- «الموظف بيضيف رقم العملية واسم المحول ورقم التليفون اللي حول منه … لازم يظهر كل التفاصيل دي في صفحة المدفوعات»:
-- the booking form carried the operation number and the number sent from (payments.transaction_id / from_account) but
-- had nowhere for the sender's NAME, so it was typed into the note or not at all, and the accounts desk could not match
-- a transfer to its payment (incoming_transfers has sender_name, sender_phone and reference to match against).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255) NULL AFTER from_account;
