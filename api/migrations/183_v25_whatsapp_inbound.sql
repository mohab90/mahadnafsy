-- 183: record inbound WhatsApp messages, not just outbound ones.
--
-- The webhook handled delivery statuses and dropped everything else on the
-- floor. Now that WhatsApp is how customers sign in and how the institute talks
-- to them, a reply that lands nowhere is a lost customer: the sales rep never
-- learns the lead answered, and the conversation has no record on the client's
-- timeline.
--
-- `communications` is already the timeline both the CRM and the client page read
-- from, so inbound messages belong in it rather than in a parallel table. Two
-- columns are all it needs.

ALTER TABLE IF EXISTS communications
  -- Existing rows are all outbound (staff logging what they sent), so OUT is the
  -- correct default for the backfill as well as for new writes.
  ADD COLUMN IF NOT EXISTS direction ENUM('OUT','IN') NOT NULL DEFAULT 'OUT'
    COMMENT 'IN = received from the customer via the WhatsApp webhook',
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(128) NULL DEFAULT NULL
    COMMENT 'Provider id of the inbound message — the idempotency key';

-- Webhooks retry. Without this a provider redelivering the same message would
-- append a duplicate to the customer's timeline on every attempt. NULLs are
-- exempt from UNIQUE in MySQL, so outbound rows (which have no provider id) are
-- unaffected and can still be inserted freely.
ALTER TABLE IF EXISTS communications
  ADD UNIQUE INDEX IF NOT EXISTS uq_comm_tenant_provider_msg (tenant_id, provider_message_id);

-- The inbound path looks a conversation up by direction and recency to show the
-- unanswered ones first.
ALTER TABLE IF EXISTS communications
  ADD INDEX IF NOT EXISTS idx_comm_tenant_direction_date (tenant_id, direction, date);
