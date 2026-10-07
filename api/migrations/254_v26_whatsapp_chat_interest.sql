-- How interested each «واتسابي» chat's customer reads, kept on the chat so the
-- list can show it and filter by it (lib/whatsappInterest.js scores it from the
-- customer's own messages whenever one arrives or the chat is opened).
--
-- Rollback: ALTER TABLE wa_web_chats DROP COLUMN interest_score, DROP COLUMN interest_level;

ALTER TABLE wa_web_chats
  ADD COLUMN IF NOT EXISTS interest_score SMALLINT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS interest_level VARCHAR(8) NULL DEFAULT NULL;
