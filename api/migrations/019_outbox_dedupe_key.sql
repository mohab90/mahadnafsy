-- Lifecycle dedupe 2026-06-20. A nullable, unique dedupe_key on message_outbox so
-- time-based nudges (stalled learner, installment due) are sent once per period.
-- Multiple NULLs are allowed by a UNIQUE index, so normal messages are unaffected.
ALTER TABLE message_outbox ADD COLUMN dedupe_key VARCHAR(150) NULL;
ALTER TABLE message_outbox ADD UNIQUE INDEX uniq_outbox_dedupe (dedupe_key);
