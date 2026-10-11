-- The 30-day re-engagement message is queued, not sent, and skips a number
-- that wrote «ستوب».
--
-- «ابعت STOP أو ستوب يوقف الرسايل» (11 Oct 2026). lib/scheduledJobHandlers.js
-- leadRetargeting used to call sendWhatsApp itself and log the lead as SENT.
-- It now goes through the outbox, which delivers it a minute later — so what
-- the log can honestly say at that moment is QUEUED — and it checks the
-- opt-out list first: a lead held back by it is logged SKIPPED (and not
-- picked again for 30 days, or the same opted-out leads would fill every run).
-- Appended to the enum, so the rows already logged keep their meaning.
--
-- Rollback:
--   UPDATE retargeting_log SET status='SENT' WHERE status IN ('QUEUED','SKIPPED');
--   ALTER TABLE retargeting_log MODIFY COLUMN status ENUM('SENT','FAILED') NOT NULL DEFAULT 'SENT';

ALTER TABLE retargeting_log
  MODIFY COLUMN status ENUM('SENT','FAILED','QUEUED','SKIPPED') NOT NULL DEFAULT 'SENT';
