-- 5 Nov 2026. «فريق الأونلاين والتحصيل» counts, for every rep, the leads of the online branches and how many of them became clients
-- (GET /api/admin/online-performance). With the index that existed it read 288,000 leads through idx_leads_tenant_sales_created and went back to the table for the
-- branch and the status of each: 2.4 s at 600,000 leads. This one holds all four columns, so the same count is answered from the index alone: 0.36 s.
ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_leads_tenant_sales_branch_status (tenant_id, assigned_sales_id, branch, status);
