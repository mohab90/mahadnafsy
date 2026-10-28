-- Rate-limit counters every API process shares (lib/mysqlRateLimitStore.js), for two or more web
-- instances behind nginx (deploy/MULTI_INSTANCE.md). Each process used to count in its own memory, so
-- with two of them a stranger got twice the login guesses. One row per limiter + key + fixed window,
-- the key hashed (it holds the tenant, account, address and action). Unused while MAHAD_MULTI_INSTANCE
-- is off: the single API keeps counting in memory.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket CHAR(64) NOT NULL,
  hits INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (bucket),
  KEY idx_rate_limit_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;
