ALTER TABLE attendance_logs
  ADD INDEX IF NOT EXISTS idx_attendance_tenant_staff_date
    (tenant_id, staff_id, date);

ALTER TABLE payments
  ADD INDEX IF NOT EXISTS idx_payments_tenant_staff_status_date
    (tenant_id, staff_id, status, date);

ALTER TABLE leads
  ADD INDEX IF NOT EXISTS idx_leads_tenant_sales_created
    (tenant_id, assigned_sales_id, created_at),
  ADD INDEX IF NOT EXISTS idx_leads_tenant_sales_updated
    (tenant_id, assigned_sales_id, updated_at);

ALTER TABLE support_tickets
  ADD INDEX IF NOT EXISTS idx_support_tenant_assignee_created
    (tenant_id, assigned_to, created_at);

ALTER TABLE physical_checkins
  ADD INDEX IF NOT EXISTS idx_checkins_dedupe
    (tenant_id, subscriber_id, branch_id, checked_in_at);

ALTER TABLE daqqi_attendees
  ADD INDEX IF NOT EXISTS idx_daqqi_attendees_tenant_round
    (tenant_id, round_id, subscriber_id);
