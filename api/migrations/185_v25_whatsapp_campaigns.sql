-- 185: WhatsApp marketing campaigns.
--
-- Mirrors email_campaigns rather than inventing a second shape, because the
-- operations team already understands that one. The differences are the ones
-- WhatsApp forces:
--
--   • throttle_per_minute — an email provider will happily take 10,000 messages
--     at once. A WhatsApp number that does the same gets banned. Delivery is
--     paced by staggering send times in the outbox.
--   • channel_id — which identity it goes out from: the company number, or a
--     particular rep's own WhatsApp.
--   • template variables — WhatsApp has no subject line and no HTML, so
--     personalisation is the only thing separating a campaign from a blast.

CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
  id                  VARCHAR(36)  NOT NULL,
  tenant_id           VARCHAR(64)  NOT NULL DEFAULT 'tenant-default',

  name                VARCHAR(200) NOT NULL,
  -- Supports {{name}} / {{clientCode}} / {{courseTitle}} — see lib/whatsappCampaigns.js
  message_template    TEXT         NOT NULL,

  -- Which identity sends it. NULL falls back to the tenant default at send time.
  channel_id          VARCHAR(36)  NULL DEFAULT NULL,

  audience            ENUM('leads','subscribers','all','manual','segment') NOT NULL DEFAULT 'leads',
  -- Filters for 'segment' (status, source, branch, assigned rep, …) or an
  -- explicit list of phone numbers for 'manual'.
  audience_filter     LONGTEXT     NULL DEFAULT NULL
    CHECK (audience_filter IS NULL OR json_valid(audience_filter)),

  -- Paced delivery. 60/min is deliberately conservative: the cost of being too
  -- slow is a campaign that finishes an hour later, the cost of being too fast
  -- is a banned number.
  throttle_per_minute INT          NOT NULL DEFAULT 60,

  status              ENUM('draft','scheduled','sending','sent','failed','cancelled')
                        NOT NULL DEFAULT 'draft',
  scheduled_at        DATETIME     NULL DEFAULT NULL,
  sent_at             DATETIME     NULL DEFAULT NULL,

  recipient_count     INT          NOT NULL DEFAULT 0,
  sent_count          INT          NOT NULL DEFAULT 0,
  fail_count          INT          NOT NULL DEFAULT 0,
  skipped_count       INT          NOT NULL DEFAULT 0
    COMMENT 'Unsubscribed, undialable, or duplicate within the same campaign',

  created_by          VARCHAR(190) NULL DEFAULT NULL,
  created_at          DATETIME     NOT NULL DEFAULT current_timestamp(),
  updated_at          DATETIME     NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),

  PRIMARY KEY (id),
  KEY idx_wacamp_tenant_status (tenant_id, status, created_at),
  KEY idx_wacamp_channel (tenant_id, channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-recipient outcome. The outbox holds the delivery attempt; this holds who
-- was in the campaign and why someone was skipped — which is the question
-- actually asked after a send ("why didn't Ahmed get it?").
CREATE TABLE IF NOT EXISTS whatsapp_campaign_recipients (
  id            VARCHAR(36) NOT NULL,
  tenant_id     VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  campaign_id   VARCHAR(36) NOT NULL,

  subject_type  ENUM('lead','subscriber','manual') NOT NULL,
  subject_id    VARCHAR(36)  NULL DEFAULT NULL,
  phone         VARCHAR(32)  NOT NULL COMMENT 'Dialable form, as actually addressed',
  name          VARCHAR(255) NULL DEFAULT NULL,

  status        ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  skip_reason   VARCHAR(120) NULL DEFAULT NULL,
  outbox_id     VARCHAR(64)  NULL DEFAULT NULL,

  created_at    DATETIME NOT NULL DEFAULT current_timestamp(),

  PRIMARY KEY (id),
  -- One message per number per campaign. A lead and a subscriber row for the
  -- same person would otherwise both receive it, which reads as spam to the
  -- customer and burns the number's reputation.
  UNIQUE KEY uq_wacamp_recipient (campaign_id, phone),
  KEY idx_wacamp_recipients (tenant_id, campaign_id, status),
  CONSTRAINT fk_wacamp_recipient_campaign FOREIGN KEY (campaign_id)
    REFERENCES whatsapp_campaigns (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
