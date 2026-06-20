-- Business decision 2026-06-10:
-- Any remaining subscriber without a branch is treated as local online.
-- This is intentionally broader than 004_branch_backfill.sql and should only
-- run after the reliable linked-lead backfill has had a chance to classify rows.

UPDATE subscribers
SET branch = 'ONLINE_EGYPT'
WHERE branch IS NULL OR branch = '';

UPDATE payments p
JOIN subscribers s ON s.id = p.subscriber_id
SET p.branch = s.branch
WHERE (p.branch IS NULL OR p.branch = '')
  AND s.branch IN ('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER');
