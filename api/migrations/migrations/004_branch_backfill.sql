-- Backfill reliable branch values from linked leads into subscribers/payments.
-- Safe rule: only fill empty subscriber/payment branch when the linked source branch
-- is one of the canonical branch enum values. Do not guess from free text.

UPDATE subscribers s
JOIN leads l ON l.id = s.lead_id
SET s.branch = l.branch
WHERE (s.branch IS NULL OR s.branch = '')
  AND l.branch IN ('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER');

UPDATE payments p
JOIN subscribers s ON s.id = p.subscriber_id
SET p.branch = s.branch
WHERE (p.branch IS NULL OR p.branch = '')
  AND s.branch IN ('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER');
