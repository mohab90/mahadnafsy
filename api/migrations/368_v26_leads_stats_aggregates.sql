-- 6 Nov 2026 (plan 9.5, «جداول التجميع اليومية»): the lead counters behind GET /api/admin/leads/stats, kept in tables instead of counted from the leads table.
--
-- The stats route scanned the leads table six times on every cold read (1.15 s at 600,000 leads on the lab). Its figures are counts and sums by a handful of
-- columns, so they are kept up to date as the leads change:
--
--   leads_stats_agg     one row per (tenant, status, owner, collection officer, source, branch): how many leads, and their deal value. Behind the pipeline totals, the
--                       per-rep counts, the sources, the collection officers' holdings.
--   leads_created_daily one row per (tenant, UTC day, branch, owner, converted): how many leads were created that day. Behind the six-month trend.
--   leads_score_agg     one row per (tenant, status, owner, branch): the leads' scores added up and counted by band. Rebuilt by the hourly score refresh
--                       (lib/leadScoreRefresh.js rewrites leads.score hourly, so a trigger on every score change would cost more than the counting saved), so it is
--                       as old as the scores are — at most an hour.
--
-- The first two are kept by triggers on leads (an insert, an update that moves a lead between rows, a delete): every writer — the routes, the imports, the scripts —
-- is covered without each knowing. An update that moves nothing (a score rewrite, a note) changes no row. Only leads with hidden = 0 are counted, as the route did.
-- A nightly job (lib/leadsStatsAgg.js) recounts and fixes any difference, and says how many it found. The existing triggers on leads (216, 252) are BEFORE triggers;
-- these are AFTER triggers, a second one on the same event, which MariaDB 10.2.3 and later allows.
--
-- Rollback: DROP the eight triggers named trg_leads_stats_* and the three tables; the route reads the live table when the aggregate tables are absent or empty.

CREATE TABLE IF NOT EXISTS leads_stats_agg (
  tenant_id VARCHAR(64) NOT NULL,
  status VARCHAR(50) NOT NULL,
  owner_id VARCHAR(36) NOT NULL DEFAULT '',
  cs_id VARCHAR(36) NOT NULL DEFAULT '',
  source VARCHAR(255) NOT NULL DEFAULT '',
  branch VARCHAR(20) NOT NULL DEFAULT '',
  n INT NOT NULL DEFAULT 0,
  deal_sum DECIMAL(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, status, owner_id, cs_id, source, branch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leads_created_daily (
  tenant_id VARCHAR(64) NOT NULL,
  day DATE NOT NULL,
  branch VARCHAR(20) NOT NULL DEFAULT '',
  owner_id VARCHAR(36) NOT NULL DEFAULT '',
  converted TINYINT NOT NULL DEFAULT 0,
  n INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day, branch, owner_id, converted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leads_score_agg (
  tenant_id VARCHAR(64) NOT NULL,
  status VARCHAR(50) NOT NULL,
  owner_id VARCHAR(36) NOT NULL DEFAULT '',
  branch VARCHAR(20) NOT NULL DEFAULT '',
  scored_n INT NOT NULL DEFAULT 0,
  score_sum BIGINT NOT NULL DEFAULT 0,
  band_high INT NOT NULL DEFAULT 0,
  band_mid INT NOT NULL DEFAULT 0,
  band_low INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, status, owner_id, branch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The triggers first, then the counts, so a lead written while the counts are being taken is not missed (a lead written in those seconds may be counted twice; the nightly job corrects it).
CREATE OR REPLACE TRIGGER trg_leads_stats_agg_insert AFTER INSERT ON leads FOR EACH ROW
  INSERT INTO leads_stats_agg (tenant_id, status, owner_id, cs_id, source, branch, n, deal_sum)
  SELECT NEW.tenant_id, COALESCE(NEW.status, ''), COALESCE(NULLIF(NEW.assigned_sales_id, ''), ''), COALESCE(NULLIF(NEW.assigned_cs_id, ''), ''), COALESCE(NULLIF(NEW.source, ''), ''), COALESCE(NEW.branch, ''), 1, COALESCE(NEW.deal_value, 0) FROM DUAL WHERE NEW.hidden = 0
  ON DUPLICATE KEY UPDATE n = n + 1, deal_sum = deal_sum + VALUES(deal_sum);

CREATE OR REPLACE TRIGGER trg_leads_stats_agg_delete AFTER DELETE ON leads FOR EACH ROW
  UPDATE leads_stats_agg SET n = n - 1, deal_sum = deal_sum - COALESCE(OLD.deal_value, 0)
   WHERE OLD.hidden = 0 AND tenant_id = OLD.tenant_id AND status = COALESCE(OLD.status, '') AND owner_id = COALESCE(NULLIF(OLD.assigned_sales_id, ''), '') AND cs_id = COALESCE(NULLIF(OLD.assigned_cs_id, ''), '') AND source = COALESCE(NULLIF(OLD.source, ''), '') AND branch = COALESCE(OLD.branch, '');

CREATE OR REPLACE TRIGGER trg_leads_stats_agg_update_out AFTER UPDATE ON leads FOR EACH ROW
  UPDATE leads_stats_agg SET n = n - 1, deal_sum = deal_sum - COALESCE(OLD.deal_value, 0)
   WHERE OLD.hidden = 0 AND NOT (OLD.tenant_id <=> NEW.tenant_id AND COALESCE(OLD.status, '') = COALESCE(NEW.status, '') AND COALESCE(NULLIF(OLD.assigned_sales_id, ''), '') = COALESCE(NULLIF(NEW.assigned_sales_id, ''), '') AND COALESCE(NULLIF(OLD.assigned_cs_id, ''), '') = COALESCE(NULLIF(NEW.assigned_cs_id, ''), '') AND COALESCE(NULLIF(OLD.source, ''), '') = COALESCE(NULLIF(NEW.source, ''), '') AND COALESCE(OLD.branch, '') = COALESCE(NEW.branch, '') AND COALESCE(OLD.deal_value, 0) = COALESCE(NEW.deal_value, 0) AND OLD.hidden = NEW.hidden) AND tenant_id = OLD.tenant_id AND status = COALESCE(OLD.status, '') AND owner_id = COALESCE(NULLIF(OLD.assigned_sales_id, ''), '') AND cs_id = COALESCE(NULLIF(OLD.assigned_cs_id, ''), '') AND source = COALESCE(NULLIF(OLD.source, ''), '') AND branch = COALESCE(OLD.branch, '');

CREATE OR REPLACE TRIGGER trg_leads_stats_agg_update_in AFTER UPDATE ON leads FOR EACH ROW
  INSERT INTO leads_stats_agg (tenant_id, status, owner_id, cs_id, source, branch, n, deal_sum)
  SELECT NEW.tenant_id, COALESCE(NEW.status, ''), COALESCE(NULLIF(NEW.assigned_sales_id, ''), ''), COALESCE(NULLIF(NEW.assigned_cs_id, ''), ''), COALESCE(NULLIF(NEW.source, ''), ''), COALESCE(NEW.branch, ''), 1, COALESCE(NEW.deal_value, 0) FROM DUAL WHERE NEW.hidden = 0 AND NOT (OLD.tenant_id <=> NEW.tenant_id AND COALESCE(OLD.status, '') = COALESCE(NEW.status, '') AND COALESCE(NULLIF(OLD.assigned_sales_id, ''), '') = COALESCE(NULLIF(NEW.assigned_sales_id, ''), '') AND COALESCE(NULLIF(OLD.assigned_cs_id, ''), '') = COALESCE(NULLIF(NEW.assigned_cs_id, ''), '') AND COALESCE(NULLIF(OLD.source, ''), '') = COALESCE(NULLIF(NEW.source, ''), '') AND COALESCE(OLD.branch, '') = COALESCE(NEW.branch, '') AND COALESCE(OLD.deal_value, 0) = COALESCE(NEW.deal_value, 0) AND OLD.hidden = NEW.hidden)
  ON DUPLICATE KEY UPDATE n = n + 1, deal_sum = deal_sum + VALUES(deal_sum);

CREATE OR REPLACE TRIGGER trg_leads_stats_daily_insert AFTER INSERT ON leads FOR EACH ROW
  INSERT INTO leads_created_daily (tenant_id, day, branch, owner_id, converted, n)
  SELECT NEW.tenant_id, DATE(NEW.created_at), COALESCE(NEW.branch, ''), COALESCE(NULLIF(NEW.assigned_sales_id, ''), ''), (COALESCE(NEW.status, '') = 'converted'), 1 FROM DUAL WHERE NEW.hidden = 0
  ON DUPLICATE KEY UPDATE n = n + 1;

CREATE OR REPLACE TRIGGER trg_leads_stats_daily_delete AFTER DELETE ON leads FOR EACH ROW
  UPDATE leads_created_daily SET n = n - 1
   WHERE OLD.hidden = 0 AND tenant_id = OLD.tenant_id AND day = DATE(OLD.created_at) AND branch = COALESCE(OLD.branch, '') AND owner_id = COALESCE(NULLIF(OLD.assigned_sales_id, ''), '') AND converted = (COALESCE(OLD.status, '') = 'converted');

CREATE OR REPLACE TRIGGER trg_leads_stats_daily_update_out AFTER UPDATE ON leads FOR EACH ROW
  UPDATE leads_created_daily SET n = n - 1
   WHERE OLD.hidden = 0 AND NOT (OLD.tenant_id <=> NEW.tenant_id AND DATE(OLD.created_at) = DATE(NEW.created_at) AND COALESCE(OLD.branch, '') = COALESCE(NEW.branch, '') AND COALESCE(NULLIF(OLD.assigned_sales_id, ''), '') = COALESCE(NULLIF(NEW.assigned_sales_id, ''), '') AND (COALESCE(OLD.status, '') = 'converted') = (COALESCE(NEW.status, '') = 'converted') AND OLD.hidden = NEW.hidden) AND tenant_id = OLD.tenant_id AND day = DATE(OLD.created_at) AND branch = COALESCE(OLD.branch, '') AND owner_id = COALESCE(NULLIF(OLD.assigned_sales_id, ''), '') AND converted = (COALESCE(OLD.status, '') = 'converted');

CREATE OR REPLACE TRIGGER trg_leads_stats_daily_update_in AFTER UPDATE ON leads FOR EACH ROW
  INSERT INTO leads_created_daily (tenant_id, day, branch, owner_id, converted, n)
  SELECT NEW.tenant_id, DATE(NEW.created_at), COALESCE(NEW.branch, ''), COALESCE(NULLIF(NEW.assigned_sales_id, ''), ''), (COALESCE(NEW.status, '') = 'converted'), 1 FROM DUAL WHERE NEW.hidden = 0 AND NOT (OLD.tenant_id <=> NEW.tenant_id AND DATE(OLD.created_at) = DATE(NEW.created_at) AND COALESCE(OLD.branch, '') = COALESCE(NEW.branch, '') AND COALESCE(NULLIF(OLD.assigned_sales_id, ''), '') = COALESCE(NULLIF(NEW.assigned_sales_id, ''), '') AND (COALESCE(OLD.status, '') = 'converted') = (COALESCE(NEW.status, '') = 'converted') AND OLD.hidden = NEW.hidden)
  ON DUPLICATE KEY UPDATE n = n + 1;

INSERT INTO leads_stats_agg (tenant_id, status, owner_id, cs_id, source, branch, n, deal_sum)
SELECT l.tenant_id, COALESCE(l.status, ''), COALESCE(NULLIF(l.assigned_sales_id, ''), ''), COALESCE(NULLIF(l.assigned_cs_id, ''), ''), COALESCE(NULLIF(l.source, ''), ''), COALESCE(l.branch, ''),
       COUNT(*), COALESCE(SUM(COALESCE(l.deal_value, 0)), 0)
  FROM leads l WHERE l.hidden = 0
 GROUP BY l.tenant_id, COALESCE(l.status, ''), COALESCE(NULLIF(l.assigned_sales_id, ''), ''), COALESCE(NULLIF(l.assigned_cs_id, ''), ''), COALESCE(NULLIF(l.source, ''), ''), COALESCE(l.branch, '');

INSERT INTO leads_created_daily (tenant_id, day, branch, owner_id, converted, n)
SELECT l.tenant_id, DATE(l.created_at), COALESCE(l.branch, ''), COALESCE(NULLIF(l.assigned_sales_id, ''), ''), (COALESCE(l.status, '') = 'converted'), COUNT(*)
  FROM leads l WHERE l.hidden = 0
 GROUP BY l.tenant_id, DATE(l.created_at), COALESCE(l.branch, ''), COALESCE(NULLIF(l.assigned_sales_id, ''), ''), (COALESCE(l.status, '') = 'converted');

INSERT INTO leads_score_agg (tenant_id, status, owner_id, branch, scored_n, score_sum, band_high, band_mid, band_low)
SELECT l.tenant_id, COALESCE(l.status, ''), COALESCE(NULLIF(l.assigned_sales_id, ''), ''), COALESCE(l.branch, ''),
       COUNT(*), COALESCE(SUM(COALESCE(l.score, 0)), 0), COALESCE(SUM(COALESCE(l.score, 0) >= 70), 0),
       COALESCE(SUM(COALESCE(l.score, 0) >= 40 AND COALESCE(l.score, 0) < 70), 0), COALESCE(SUM(COALESCE(l.score, 0) < 40), 0)
  FROM leads l WHERE l.hidden = 0
 GROUP BY l.tenant_id, COALESCE(l.status, ''), COALESCE(NULLIF(l.assigned_sales_id, ''), ''), COALESCE(l.branch, '');
