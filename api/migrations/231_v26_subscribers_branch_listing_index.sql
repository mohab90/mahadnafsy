-- «عدد عملاء الدقي بيظهر 140 وهما أكتر». A branch's clients are now asked for by
-- branch (GET /api/admin/subscribers?branch=DAQQI and /count), so the list and the
-- count need an index that starts at the tenant and the branch and carries the
-- filters and the ordering the list uses (active, not deleted, newest first).
-- Without it a branch read walks every client the institute has.
CREATE INDEX IF NOT EXISTS idx_subscribers_tenant_branch_listing
  ON subscribers (tenant_id, branch, is_active, deleted_at, created_at);
