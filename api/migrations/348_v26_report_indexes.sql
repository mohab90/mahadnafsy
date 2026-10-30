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
