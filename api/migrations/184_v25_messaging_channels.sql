-- 184: one registry for every outbound messaging identity.
--
-- Until now there was exactly one WhatsApp configuration per tenant, held in
-- site_config. That cannot express what the institute actually needs:
--   • the company's main WhatsApp number
--   • each sales rep sending from their own WhatsApp, so the customer sees a
--     person rather than a switchboard
--   • the Facebook page's Messenger inbox
--
-- All three are "a thing we can send from", differing only in provider and
-- credentials, so they belong in one table with one resolution rule rather than
-- three parallel implementations that will drift.
--
-- Credentials are encrypted (AES-256-GCM, api/lib/secretBox.js) rather than
-- stored as plain JSON like the old single config: this table holds one sending
-- identity per employee, and a dump of it would otherwise hand over all of them.

CREATE TABLE IF NOT EXISTS messaging_channels (
  id                 VARCHAR(36)  NOT NULL,
  tenant_id          VARCHAR(64)  NOT NULL DEFAULT 'tenant-default',

  kind               ENUM('whatsapp','messenger') NOT NULL,
  provider           ENUM('meta','green-api','messenger') NOT NULL,

  -- NULL means the company channel. A staff id means that employee's own
  -- identity, which only they and an admin may send from.
  owner_staff_id     VARCHAR(36)  NULL DEFAULT NULL,

  label              VARCHAR(120) NOT NULL,
  -- Display only. The address messages are actually sent to is always rebuilt
  -- by lib/phoneNumber.js toDialable, never read from here.
  display_number     VARCHAR(32)  NULL DEFAULT NULL,

  credentials_sealed TEXT         NULL DEFAULT NULL
    COMMENT 'AES-256-GCM envelope from lib/secretBox.js — never readable in a dump',

  status             ENUM('pending','connected','disconnected','error') NOT NULL DEFAULT 'pending',
  last_verified_at   DATETIME     NULL DEFAULT NULL,
  last_error         VARCHAR(500) NULL DEFAULT NULL,

  -- The channel used when a send does not name one. Exactly one per
  -- (tenant, kind) is enforced in application code, not by a constraint: MySQL
  -- cannot express "at most one row where is_default = 1" per group.
  is_default         TINYINT(1)   NOT NULL DEFAULT 0,
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,

  -- A personal WhatsApp that suddenly sends thousands of messages gets banned by
  -- the provider. This caps the damage per channel per day.
  daily_send_limit   INT          NOT NULL DEFAULT 1000,
  sent_today         INT          NOT NULL DEFAULT 0,
  sent_today_date    DATE         NULL DEFAULT NULL,

  created_by         VARCHAR(190) NULL DEFAULT NULL,
  created_at         DATETIME     NOT NULL DEFAULT current_timestamp(),
  updated_at         DATETIME     NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),

  PRIMARY KEY (id),
  -- One channel of each kind per employee. Without this a rep could end up with
  -- two half-connected WhatsApps and no way to tell which one sent what.
  UNIQUE KEY uq_channel_owner_kind (tenant_id, owner_staff_id, kind),
  KEY idx_channel_tenant_kind (tenant_id, kind, is_active),
  KEY idx_channel_owner (tenant_id, owner_staff_id),
  CONSTRAINT fk_channel_staff FOREIGN KEY (owner_staff_id) REFERENCES staff (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── outbox: which identity sent it, and Messenger as a channel ───────────────
ALTER TABLE IF EXISTS message_outbox
  MODIFY COLUMN channel ENUM('email','whatsapp','messenger') NOT NULL,
  ADD COLUMN IF NOT EXISTS channel_id VARCHAR(36) NULL DEFAULT NULL
    COMMENT 'messaging_channels.id this was sent from — NULL means the tenant default';

ALTER TABLE IF EXISTS message_outbox
  ADD INDEX IF NOT EXISTS idx_outbox_channel_id (tenant_id, channel_id, status);

-- ── communications: attribute an inbound reply to the identity that received it
ALTER TABLE IF EXISTS communications
  ADD COLUMN IF NOT EXISTS channel_id VARCHAR(36) NULL DEFAULT NULL
    COMMENT 'messaging_channels.id the message arrived on or was sent from';

-- MESSENGER joins the type enum. Without it a Messenger conversation would have
-- to masquerade as a NOTE and become invisible to every per-channel filter and
-- report the CRM has.
ALTER TABLE IF EXISTS communications
  MODIFY COLUMN type ENUM('CALL','WHATSAPP','EMAIL','MEETING','NOTE','PAYMENT_FOLLOWUP',
                          'NEW_COURSE_SALE','CERTIFICATE','MESSENGER') NOT NULL;

-- ── leads: the Messenger identity ────────────────────────────────────────────
-- Messenger never exposes a phone or an email, only a page-scoped id issued the
-- first time someone messages the page. Matching a conversation to a lead is
-- therefore a one-time human act, and this is where that link is kept.
ALTER TABLE IF EXISTS leads
  ADD COLUMN IF NOT EXISTS messenger_psid VARCHAR(64) NULL DEFAULT NULL
    COMMENT 'Page-scoped id — the only identifier Messenger gives us',
  ADD COLUMN IF NOT EXISTS messenger_last_inbound_at DATETIME NULL DEFAULT NULL
    COMMENT 'Drives the 24h reply window: outside it Meta rejects plain text';

-- One PSID is one person, so it must not be attached to two leads.
ALTER TABLE IF EXISTS leads
  ADD UNIQUE INDEX IF NOT EXISTS uq_leads_tenant_psid (tenant_id, messenger_psid);
