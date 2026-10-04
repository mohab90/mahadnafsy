-- «تاب فوق للسيلز والتحصيل اسمها واتس اب … يقدر يدخل الواتس اب بتاعه ربط من
-- التليفون للجهاز داخل السيستم ولما يضغط ارسال يرسل مباشر ويعد الرسايل».
--
-- Each rep links their own WhatsApp to the system the way WhatsApp Web does —
-- a QR code scanned from the phone's «الأجهزة المرتبطة» — and chats from the
-- system (lib/whatsappWeb.js). The link keys live on disk next to the API
-- (WA_WEB_DATA_DIR); these tables hold what the screens show:
--
--   wa_web_sessions  one row per rep: linked or not, which number
--   wa_web_chats     the rep's conversations, with the CRM lead/client the
--                    number belongs to (matched once — on opening the chat, on the
--                    first send, or on a live incoming message — not for every
--                    chat in the history WhatsApp sends when a phone is linked)
--   wa_web_messages  the messages, deduplicated on WhatsApp's own id; sent_by_system
--                    marks the ones typed in the system — what the counts count
--
-- Rollback: DROP TABLE wa_web_messages, wa_web_chats, wa_web_sessions.

CREATE TABLE IF NOT EXISTS wa_web_sessions (
  tenant_id VARCHAR(64) NOT NULL,
  staff_id VARCHAR(64) NOT NULL,
  status ENUM('disconnected','linking','connected','logged_out') NOT NULL DEFAULT 'disconnected',
  phone VARCHAR(32) NULL,
  wa_name VARCHAR(255) NULL,
  linked_at DATETIME NULL,
  last_seen_at DATETIME NULL,
  last_error VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_web_chats (
  tenant_id VARCHAR(64) NOT NULL,
  staff_id VARCHAR(64) NOT NULL,
  jid VARCHAR(128) NOT NULL,
  phone VARCHAR(32) NULL,
  name VARCHAR(255) NULL,
  lead_id VARCHAR(64) NULL,
  subscriber_id VARCHAR(64) NULL,
  matched_at DATETIME NULL,
  last_message VARCHAR(500) NULL,
  last_at DATETIME NULL,
  unread INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, staff_id, jid),
  KEY idx_wa_chats_recent (tenant_id, staff_id, last_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wa_web_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL,
  staff_id VARCHAR(64) NOT NULL,
  jid VARCHAR(128) NOT NULL,
  wa_id VARCHAR(128) NOT NULL,
  from_me TINYINT(1) NOT NULL DEFAULT 0,
  sent_by_system TINYINT(1) NOT NULL DEFAULT 0,
  body TEXT NULL,
  kind VARCHAR(32) NOT NULL DEFAULT 'text',
  status VARCHAR(16) NULL,
  sent_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wa_msg (tenant_id, staff_id, wa_id),
  KEY idx_wa_msg_chat (tenant_id, staff_id, jid, sent_at),
  KEY idx_wa_msg_counts (tenant_id, sent_by_system, sent_at, staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
