-- «مين أونلاين» across API processes (lib/onlineUsers.js). The heartbeat landed in the memory of
-- whichever process answered it, so with two instances each one saw about half the people online.
-- Used when MAHAD_MULTI_INSTANCE is on and Redis is not; rows older than five minutes are deleted.
CREATE TABLE IF NOT EXISTS online_presence (
  tenant_id VARCHAR(64) NOT NULL,
  uid VARCHAR(100) NOT NULL,
  name VARCHAR(100) NULL,
  email VARCHAR(320) NULL,
  last_seen DATETIME(3) NOT NULL,
  PRIMARY KEY (tenant_id, uid),
  KEY idx_online_presence_seen (tenant_id, last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
