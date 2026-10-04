-- «واتس واحد للشركة كلها بيدخل عليه كل السيلز ويجمع الانبوكس بتاع ماسنجر
-- وانستجرام مع بعض … رسايل ترويجيه للواتس اب».
--
-- inbox_threads           one row per person per platform: the company WhatsApp
--                         number, the Facebook page, the Instagram account. Who
--                         answers it (assigned_staff_id), whether it is waiting
--                         (unread_count, last_direction), and the 24-hour reply
--                         window (last_inbound_at). The messages themselves stay
--                         in communications, the timeline the CRM already reads;
--                         thread_id ties them to the conversation.
-- communications          INSTAGRAM as a message type; thread_id; the delivery
--                         ticks of a reply (delivery_status) — WhatsApp reports
--                         sent / delivered / read against the id stored in
--                         provider_message_id.
-- leads.instagram_id      the Instagram-scoped id: like Messenger's PSID, the
--                         only identity Instagram gives.
-- messaging_channels.external_id
--                         the number's phone_number_id (or the page id) at Meta,
--                         so a webhook is filed under the channel it came to.
-- whatsapp_campaigns      an approved Meta template (name, language, and what
--                         fills its {{1}}, {{2}}…): outside a conversation Meta
--                         delivers templates only.
--
-- Rollback:
--   DROP TABLE inbox_threads;
--   ALTER TABLE communications DROP COLUMN thread_id, DROP COLUMN delivery_status;
--   ALTER TABLE leads DROP INDEX uq_leads_tenant_instagram, DROP COLUMN instagram_id, DROP COLUMN instagram_last_inbound_at;
--   ALTER TABLE messaging_channels DROP COLUMN external_id;
--   ALTER TABLE whatsapp_campaigns DROP COLUMN template_name, DROP COLUMN template_language, DROP COLUMN template_params_json;
--   (INSTAGRAM stays in the communications.type enum: removing a member relabels rows.)

CREATE TABLE IF NOT EXISTS inbox_threads (
  id                VARCHAR(36)  NOT NULL,
  tenant_id         VARCHAR(64)  NOT NULL,
  platform          ENUM('whatsapp','messenger','instagram') NOT NULL,
  contact_key       VARCHAR(64)  NOT NULL COMMENT 'dialable number, Messenger PSID or Instagram id',
  channel_id        VARCHAR(36)  NULL,
  lead_id           VARCHAR(36)  NULL,
  subscriber_id     VARCHAR(36)  NULL,
  contact_name      VARCHAR(255) NULL,
  assigned_staff_id VARCHAR(36)  NULL,
  assigned_at       DATETIME     NULL,
  status            ENUM('open','closed') NOT NULL DEFAULT 'open',
  unread_count      INT          NOT NULL DEFAULT 0,
  last_direction    ENUM('IN','OUT') NULL,
  last_preview      VARCHAR(200) NULL,
  last_message_at   DATETIME     NULL,
  last_inbound_at   DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inbox_thread_contact (tenant_id, platform, contact_key),
  KEY idx_inbox_thread_recent (tenant_id, status, last_message_at),
  KEY idx_inbox_thread_staff (tenant_id, assigned_staff_id, last_message_at),
  KEY idx_inbox_thread_lead (tenant_id, lead_id),
  KEY idx_inbox_thread_subscriber (tenant_id, subscriber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE communications
  MODIFY COLUMN type ENUM('CALL','WHATSAPP','EMAIL','MEETING','NOTE','PAYMENT_FOLLOWUP','NEW_COURSE_SALE','CERTIFICATE','MESSENGER','INSTAGRAM') NOT NULL,
  ADD COLUMN IF NOT EXISTS thread_id VARCHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(16) NULL,
  ADD KEY IF NOT EXISTS idx_comm_thread_date (thread_id, date);

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS instagram_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS instagram_last_inbound_at DATETIME NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_leads_tenant_instagram (tenant_id, instagram_id);

ALTER TABLE messaging_channels
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(64) NULL,
  ADD KEY IF NOT EXISTS idx_channel_external (external_id);

ALTER TABLE whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS template_name VARCHAR(512) NULL,
  ADD COLUMN IF NOT EXISTS template_language VARCHAR(16) NULL,
  ADD COLUMN IF NOT EXISTS template_params_json VARCHAR(2000) NULL;
