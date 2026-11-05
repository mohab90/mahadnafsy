-- 5 Nov 2026. Which routes are called, per day and per method (lib/routeUsage.js writes it once a minute from each API process; the counts add up).
-- The performance monitor forgets everything at every restart, so «which of the thousand routes does nobody call?» had no answer; after a month of this table
-- tools/route-usage-report.cjs lists the registered routes with no call in the period. Rows older than 400 days are purged by the same job.
CREATE TABLE IF NOT EXISTS route_usage (
  day       DATE         NOT NULL,
  method    VARCHAR(8)   NOT NULL,
  route     VARCHAR(190) NOT NULL,
  hits      INT UNSIGNED NOT NULL DEFAULT 0,
  errors    INT UNSIGNED NOT NULL DEFAULT 0,
  last_seen DATETIME     NULL,
  PRIMARY KEY (day, method, route),
  KEY idx_route_usage_route (route, method, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
