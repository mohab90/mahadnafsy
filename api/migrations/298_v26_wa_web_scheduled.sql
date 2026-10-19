-- Messages a rep scheduled from the WhatsApp tab, and the chat campaigns (19 Oct 2026).
--
-- «رسائل مجدولة» and «حملات من الشات»: a message written now and sent at a chosen time, and one message sent to many chats
-- one after another. Both are the same thing — a row per message with the time it is due; a campaign is a batch of rows
-- spaced apart. They go out through the rep's own linked WhatsApp (lib/whatsappWeb.js sendText), which paces and caps
-- every send, so a long campaign simply takes the days it needs.
CREATE TABLE IF NOT EXISTS wa_web_scheduled (
  id varchar(36) NOT NULL,
  tenant_id varchar(64) NOT NULL,
  staff_id varchar(64) NOT NULL,
  jid varchar(128) DEFAULT NULL,
  phone varchar(32) DEFAULT NULL,
  name varchar(255) DEFAULT NULL,
  body text NOT NULL,
  send_at datetime NOT NULL,
  status enum('pending','sending','sent','failed','canceled') NOT NULL DEFAULT 'pending',
  attempts tinyint(4) NOT NULL DEFAULT 0,
  error varchar(255) DEFAULT NULL,
  batch_id varchar(36) DEFAULT NULL,
  batch_label varchar(160) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  sent_at datetime DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_wa_sched_due (status, send_at),
  KEY idx_wa_sched_staff (tenant_id, staff_id, status, send_at),
  KEY idx_wa_sched_batch (tenant_id, batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
