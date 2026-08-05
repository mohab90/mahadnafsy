-- "الفرع الإداري - طنطا" — an admin-only branch: usable for job postings and
-- staff assignment (job_postings.branch / staff.branch_id, both matched on
-- branch_key), marked internal_only so it's excluded wherever a branch list
-- is filtered for customers. Inserted directly into `branches` rather than
-- going through content['institute.branches'] (the tenant has never actually
-- populated that key — see 190_v25_branches_internal_only.sql — so touching
-- it now would be the first time that sync path runs in production, with a
-- real risk of it renaming/altering the 6 existing real branches instead of
-- just adding one).
INSERT INTO branches (id, tenant_id, branch_key, slug, label, branch_type, timezone, currency, is_active, internal_only)
SELECT 'branch-tanta-admin', 'tenant-default', 'tanta_admin', 'tanta-admin', 'الفرع الإداري - طنطا', 'other', 'Africa/Cairo', 'EGP', 1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM branches WHERE tenant_id = 'tenant-default' AND branch_key = 'tanta_admin'
);
