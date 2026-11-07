-- «مين فاتح السيستم دلوقتي» (7 Nov 2026): one row per member of staff, kept current by the panel's own heartbeat
-- and by their writes (lib/staffPresence.js, at most one write a minute per person). Nothing about the address or
-- the device is kept: the screen shows who is in and what they last did, not where from.
CREATE TABLE IF NOT EXISTS staff_presence (
  tenant_id VARCHAR(64) NOT NULL,
  staff_key VARCHAR(100) NOT NULL,
  name VARCHAR(255) NULL,
  role VARCHAR(40) NULL,
  screen VARCHAR(64) NULL,
  last_seen_at DATETIME(3) NOT NULL,
  last_action_at DATETIME(3) NULL,
  last_action_kind VARCHAR(8) NULL,
  last_action_label VARCHAR(255) NULL,
  seen_day DATE NOT NULL,
  first_seen_at DATETIME(3) NOT NULL,
  PRIMARY KEY (tenant_id, staff_key),
  KEY idx_staff_presence_seen (tenant_id, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The page a client is on and the course, where the page names one, next to the existing presence row
-- (used when presence lives in the database rather than in memory or Redis).
ALTER TABLE online_presence ADD COLUMN IF NOT EXISTS page VARCHAR(200) NULL;
ALTER TABLE online_presence ADD COLUMN IF NOT EXISTS course_id VARCHAR(64) NULL;
