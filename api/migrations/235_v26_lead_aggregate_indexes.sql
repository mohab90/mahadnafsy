-- Indexes for the CRM's aggregate screens at 500k leads.
--
-- Measured on a 500,000-lead / 50,000-client test tenant (tools/load-test-seed.cjs,
-- tools/load-test-bench.cjs). Each is covering for the queries named, so they are
-- answered from the index without reading a lead row:
--
--   idx_leads_tenant_hidden_status_owner — the KPI screen's GROUP BY status
--     (count, unassigned, deal value): 10.8 s → 0.27 s.
--   idx_leads_tenant_hidden_owner_status — every per-rep GROUP BY: the KPI
--     screen's owner × status with the score sum, staff performance, CRM
--     insights. Without it the optimiser walked idx_leads_tenant_sales_created
--     and read 250k rows per query (3.9 s → 0.23 s).
--   idx_leads_tenant_hidden_score — the scoring screen's top N by score and its
--     score >= N filter, now that leads.score is kept current by the hourly
--     refresh (lib/leadScoreRefresh.js) instead of being computed per request.
--   idx_leads_tenant_hidden_source_status — the source breakdown and the
--     scoring screen's filter dropdowns.
--   idx_comm_tenant_date_lead — "this week's calls per rep" in CRM insights
--     starts from the week's communications instead of every assigned lead:
--     10.7 s → 0.6 s.
--   idx_comm_tenant_lead_type — communications per rep per channel on the KPI
--     screen, answered from the index: 5.0 s → 1.8 s.
--   ft_leads_name_email — the lead search box. Whole words look up the index
--     (MATCH … AGAINST '+word*'); the '%text%' scan, 2–3 s at 500k leads, now
--     runs only when the indexed lookup finds nothing. The first FULLTEXT index
--     on a table rebuilds it once (adds InnoDB's hidden FTS_DOC_ID): about a
--     second at production's size, 40 s at 500k.
--
-- Additive only. Rollback: DROP INDEX each.

CREATE INDEX IF NOT EXISTS idx_leads_tenant_hidden_status_owner
  ON leads (tenant_id, hidden, status, assigned_sales_id, deal_value);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_hidden_owner_status
  ON leads (tenant_id, hidden, assigned_sales_id, status, created_at, score);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_hidden_score
  ON leads (tenant_id, hidden, score, id);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_hidden_source_status
  ON leads (tenant_id, hidden, source, status);

CREATE INDEX IF NOT EXISTS idx_comm_tenant_date_lead
  ON communications (tenant_id, date, lead_id, type);

CREATE INDEX IF NOT EXISTS idx_comm_tenant_lead_type
  ON communications (tenant_id, lead_id, type);

CREATE FULLTEXT INDEX IF NOT EXISTS ft_leads_name_email
  ON leads (name, email);
