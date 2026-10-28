-- A cache dropped in one API process is dropped in the others (lib/cacheBus.js): a saved setting,
-- price or catalogue change writes one row here, and every other process polls the new rows and
-- drops its own copy, instead of serving the old one until its TTL ran out. Rows older than an hour
-- are deleted by the pollers. Only written when there is more than one process (MAHAD_ROLE=web +
-- worker, or MAHAD_MULTI_INSTANCE).
CREATE TABLE IF NOT EXISTS cache_invalidations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel VARCHAR(64) NOT NULL,
  arg VARCHAR(255) NULL,
  origin VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_cache_invalidations_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
