-- What the mail relay says happened to each message (31 Oct 2026 audit: «no email delivery tracking»).
--
-- Brevo accepts a message and tells us later, on a webhook (routes/email-webhook.js), whether it was delivered, bounced, blocked or
-- reported as spam. Until now nothing listened: a receipt, a password reset or a campaign to a dead address looked sent. One row per
-- event; the same event delivered twice by the relay (it retries) is one row (uq_email_event).
CREATE TABLE IF NOT EXISTS email_delivery_events (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  tenant_id varchar(64) NOT NULL,
  message_id varchar(255) NOT NULL DEFAULT '',
  email varchar(320) NOT NULL,
  event varchar(40) NOT NULL,
  reason varchar(500) DEFAULT NULL,
  subject varchar(255) DEFAULT NULL,
  occurred_at datetime NOT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_event (tenant_id, message_id(120), event, email(120), occurred_at),
  KEY idx_email_events_when (tenant_id, event, occurred_at),
  KEY idx_email_events_email (tenant_id, email(120), occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
