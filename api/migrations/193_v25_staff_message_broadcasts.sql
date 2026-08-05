-- Group messaging on top of the 1:1 thread from migration 192.
--
-- A broadcast fans out into one row per recipient (each lands in that person's
-- own thread, so nobody sees a shared mailbox and read state stays per-person).
-- `broadcast_id` ties those copies back together; `broadcast_label` records who
-- the group was ("كل الفريق" / "فريق المبيعات" / "فرع الدقي") so the thread
-- explains itself later.
--
-- `peer_broadcast` is a third routing case, not a cosmetic flag:
--   to_staff       = management → the thread owner
--   from_staff     = the thread owner wrote it (to management, or their own
--                    copy of a team broadcast they sent)
--   peer_broadcast = a colleague's team broadcast that landed in this thread
-- Without it, a colleague's message would have to be stored as either
-- "management wrote this" or "the owner wrote this" — both untrue.
ALTER TABLE IF EXISTS staff_messages
  MODIFY COLUMN direction enum('to_staff','from_staff','peer_broadcast') NOT NULL DEFAULT 'to_staff',
  ADD COLUMN IF NOT EXISTS broadcast_id varchar(36) DEFAULT NULL AFTER direction,
  ADD COLUMN IF NOT EXISTS broadcast_label varchar(160) DEFAULT NULL AFTER broadcast_id;

ALTER TABLE IF EXISTS staff_messages
  ADD INDEX IF NOT EXISTS idx_staff_messages_broadcast (tenant_id, broadcast_id);
