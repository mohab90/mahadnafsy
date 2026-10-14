-- A second number for a client, and every Egyptian number stored in ONE form.
--
-- «خلي في مساحة في تعديل بيانات العميل ان يكون في رقمين لنفس العميل» + «خلي مطابقة رقم الهاتف تكون
-- ب10 ارقام زي كدا 1157575809 مش 11 ولا اكثر، لان في عملاء مكررة: في رقم اوله 0 ورقم تاني لاء»
-- (14 Oct 2026).
--
-- subscribers.phone is the identity the system compares (lib/phoneNumber.js toIdentity): the
-- ten digits of an Egyptian mobile, no trunk 0, no country code — what uq_subs_tenant_phone
-- guards. Four insert paths kept the number as it was typed (a converted lead, a booking made
-- from a lead, the Dokki import, a collection sheet), so «01157575809» and «1157575809» were two
-- clients. Those paths now store the identity (the code); this brings the rows already stored
-- into the same form, where doing so does not collide with another client — a pair that
-- collides is a real duplicate, and is listed for the managers to merge
-- (GET /api/admin/subscribers/duplicate-phones), never merged here.
--
-- phone2 is the client's second number, in the same form; the same number is never held by two
-- clients, as either of theirs (the save route checks).
--
-- Rollback:
--   ALTER TABLE subscribers DROP INDEX idx_subscribers_phone2, DROP COLUMN phone2;
--   (the normalised phone values are the identity form the code already writes — nothing to undo)

ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS phone2 VARCHAR(50) NULL DEFAULT NULL,
  ADD KEY IF NOT EXISTS idx_subscribers_phone2 (tenant_id, phone2);

-- 0 + ten digits (an Egyptian mobile written with its trunk zero) → the ten digits.
UPDATE subscribers s
   SET s.phone = SUBSTRING(s.phone, 2)
 WHERE s.phone REGEXP '^0(1[0125][0-9]{8})$'
   AND NOT EXISTS (SELECT 1 FROM (SELECT tenant_id, phone FROM subscribers) o
                    WHERE o.tenant_id = s.tenant_id AND o.phone = SUBSTRING(s.phone, 2));

-- 20 + ten digits, with or without the «+» / «00» (an Egyptian mobile with its country code) → the ten digits.
UPDATE subscribers s
   SET s.phone = SUBSTRING(REGEXP_REPLACE(s.phone, '^(\\+|00)', ''), 3)
 WHERE s.phone REGEXP '^(\\+|00)?20(1[0125][0-9]{8})$'
   AND NOT EXISTS (SELECT 1 FROM (SELECT tenant_id, phone FROM subscribers) o
                    WHERE o.tenant_id = s.tenant_id AND o.phone = SUBSTRING(REGEXP_REPLACE(s.phone, '^(\\+|00)', ''), 3));
