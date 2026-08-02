-- 186: Wapilot as a WhatsApp provider.
--
-- A WhatsApp-Web session provider (api.wapilot.net), alongside the Meta Cloud
-- API and Green-API. Adding it is an enum widening and nothing else — which is
-- the point of migration 184's channel registry: a new provider is one adapter
-- and one enum value, not a new subsystem.
--
-- Verified against the live API before this was written: Bearer auth,
-- GET /instances, GET /instances/{unique}, GET /instances/{unique}/status.
-- See api/lib/whatsappWapilot.js for what is confirmed and what is still
-- configuration.

ALTER TABLE IF EXISTS messaging_channels
  MODIFY COLUMN provider ENUM('meta','green-api','wapilot','messenger') NOT NULL;
