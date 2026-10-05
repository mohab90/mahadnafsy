-- «نعمل انبوكس يكون فيه واتس اب واحد وماسنجر وانستجرام … كل الموظفين يردو منه
-- وكمان نشغل منه ai chat bot».
--
-- inbox_threads.labels         the conversation's labels, a JSON array of short
--                              strings (مهتم، سعر، حجز، شكوى…), filterable.
-- inbox_threads.bot_paused     1 once a person took over: the bot stays quiet in
--                              this conversation until someone hands it back.
-- inbox_threads.bot_replies    how many times the bot answered here — capped,
--                              so a loop with another bot cannot run forever.
-- inbox_threads.bot_last_at    when it last answered.
-- inbox_notes                  notes the team writes on a conversation; the
--                              customer never sees them.
-- inbox_quick_replies          saved answers, typed as /shortcut in the composer.
--
-- Rollback:
--   DROP TABLE inbox_quick_replies; DROP TABLE inbox_notes;
--   ALTER TABLE inbox_threads DROP COLUMN labels, DROP COLUMN bot_paused,
--     DROP COLUMN bot_replies, DROP COLUMN bot_last_at;

ALTER TABLE inbox_threads
  ADD COLUMN IF NOT EXISTS labels VARCHAR(500) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bot_paused TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bot_replies INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bot_last_at DATETIME DEFAULT NULL;

CREATE TABLE IF NOT EXISTS inbox_notes (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  thread_id VARCHAR(36) NOT NULL,
  staff_id VARCHAR(36) DEFAULT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inbox_notes_thread (tenant_id, thread_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inbox_quick_replies (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  title VARCHAR(120) NOT NULL,
  shortcut VARCHAR(40) DEFAULT NULL,
  body TEXT NOT NULL,
  created_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inbox_quick_reply_shortcut (tenant_id, shortcut),
  KEY idx_inbox_quick_replies (tenant_id, title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
