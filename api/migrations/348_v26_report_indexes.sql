-- Two reads the daily and team reports make over all the leads, measured on the lab at production scale (150,000 leads), 30 Oct 2026.
--
-- «ما استلمه كل موظف اليوم» (lib/teamDailyReport.js, lib/teamReports.js — the sales, Dokki and Tagamoa team reports, the management
-- report and the daily WhatsApp report): leads handed out inside a range, by assigned_at. Every index that holds assigned_at has
-- assigned_sales_id before it, so a range on assigned_at alone walked idx_leads_tenant_sales_created (67,000 rows) and filtered:
-- 734 ms. Read from this index alone: 3 ms.
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_assigned_at (tenant_id, hidden, assigned_at, assigned_sales_id, created_at);

-- «متابعات اليوم والمتأخرة» of each rep (lib/teamDailyReport.js): the open leads that have a follow-up date, grouped by rep.
-- 788 ms over the lead rows; 39 ms from this index.
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_followup_open (tenant_id, next_follow_up_date, assigned_sales_id, status, hidden);

-- «توقعات المبيعات» (lib/crmForecast.js): the open leads in the order ORDER BY expected_close_date, id, cut at 10,000. No index held the
-- two together, so every open lead (77,000 of the lab's 150,000) was sorted to keep the first 10,000: 884 ms; read in index order: 110 ms,
-- the same rows in the same order. In production, with ~3.5x the leads, the sort is what grows.
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_close_id (tenant_id, expected_close_date, id);

-- «قائمة شغل اليوم» (routes/crm-ops.js /crm/work-queue): the open leads ranked ORDER BY score DESC, created_at ASC, cut at 400. The
-- index held score and the id but not the date after it, so the 74,000 open leads of the lab were sorted to keep 400: 790 ms; read
-- in this order (the key is written the way the query sorts, mixed directions need MariaDB 10.8 or later): 13 ms, the same 400 ids in
-- the same order.
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_queue (tenant_id, hidden, score DESC, created_at ASC);
