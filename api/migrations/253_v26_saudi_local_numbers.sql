-- Saudi clients' numbers written the local way, given their country code.
--
-- A Saudi mobile typed as 05XXXXXXXX (or 5XXXXXXXX) carries no country code,
-- so it could not be dialled and the payment route refused every booking for
-- that client: 9 Saudi-branch leads and 2 clients on 6 Oct 2026. New ones are
-- completed as they are saved (lib/phoneNumber.js completeForBranch); these
-- are the ones already stored. IGNORE: a number whose complete form another
-- record already holds is left for the duplicate review.
--
-- Rollback: none needed — the old spelling is the same number.

UPDATE IGNORE leads
   SET phone = CONCAT('966', RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 9)), updated_at = updated_at
 WHERE branch = 'ONLINE_SAUDI' AND REGEXP_REPLACE(phone, '[^0-9]', '') REGEXP '^0?5[0-9]{8}$';

UPDATE IGNORE subscribers
   SET phone = CONCAT('966', RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 9)), updated_at = updated_at
 WHERE branch = 'ONLINE_SAUDI' AND REGEXP_REPLACE(phone, '[^0-9]', '') REGEXP '^0?5[0-9]{8}$';
