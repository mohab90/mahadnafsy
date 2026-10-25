-- The lecturer's own account (25 Oct 2026): blocked days on the weekly availability, and a lecturer's own community posts.
--
-- «الأوقات اللي المحاضر بيحددها تتكرر كل أسبوع … ويقدر يقفل يوم معين»: therapist_slots are weekly (a weekday and an hour),
-- so only the exceptions need a row — one per day the lecturer is away. A booking on a blocked day is refused.
CREATE TABLE IF NOT EXISTS therapist_blocked_dates (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  therapist_id VARCHAR(36) NOT NULL,
  blocked_date DATE NOT NULL,
  reason VARCHAR(255) NULL,
  created_by VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_therapist_blocked_day (tenant_id, therapist_id, blocked_date),
  KEY idx_therapist_blocked_date (tenant_id, blocked_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A post written by a lecturer from their portal belongs to their staff account, not to a subscriber.
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS staff_id VARCHAR(36) NULL AFTER subscriber_id;
ALTER TABLE community_posts ADD INDEX IF NOT EXISTS idx_community_posts_staff (tenant_id, staff_id);
