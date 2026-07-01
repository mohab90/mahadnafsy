-- 029_performance_indexes.sql
-- Perf pass (weakness #9): composite/covering indexes for the hottest filter
-- patterns (CRM lists, payment reports, follow-up queues). Additive + idempotent
-- (ADD INDEX IF NOT EXISTS on MariaDB 11.8); safe on the live tables.

-- Leads: the CRM list filters by hidden + status + assignment, sorts by created_at.
ALTER TABLE IF EXISTS leads ADD INDEX IF NOT EXISTS idx_leads_hidden_created (hidden, created_at);
ALTER TABLE IF EXISTS leads ADD INDEX IF NOT EXISTS idx_leads_status (status);
ALTER TABLE IF EXISTS leads ADD INDEX IF NOT EXISTS idx_leads_assigned_sales (assigned_sales_id);
ALTER TABLE IF EXISTS leads ADD INDEX IF NOT EXISTS idx_leads_next_followup (next_follow_up_date);

-- Payments: finance reports filter by status + date; joins by subscriber_id.
ALTER TABLE IF EXISTS payments ADD INDEX IF NOT EXISTS idx_payments_status_date (status, `date`);
ALTER TABLE IF EXISTS payments ADD INDEX IF NOT EXISTS idx_payments_subscriber (subscriber_id);

-- Subscribers: role-scoped lists filter by assignment; sorted by created_at.
ALTER TABLE IF EXISTS subscribers ADD INDEX IF NOT EXISTS idx_subscribers_assigned_sales (assigned_sales_id);
ALTER TABLE IF EXISTS subscribers ADD INDEX IF NOT EXISTS idx_subscribers_assigned_cs (assigned_cs_id);
ALTER TABLE IF EXISTS subscribers ADD INDEX IF NOT EXISTS idx_subscribers_created (created_at);

-- Enrollments: batch-loaded by subscriber/course.
ALTER TABLE IF EXISTS enrollments ADD INDEX IF NOT EXISTS idx_enrollments_subscriber (subscriber_id);
ALTER TABLE IF EXISTS enrollments ADD INDEX IF NOT EXISTS idx_enrollments_course (course_id);

-- Orders: admin list filters by status, sorts by created_at.
ALTER TABLE IF EXISTS orders ADD INDEX IF NOT EXISTS idx_orders_status_created (status, created_at);

-- Course completions / consultations: dashboard aggregates.
ALTER TABLE IF EXISTS course_completions ADD INDEX IF NOT EXISTS idx_completions_subscriber (subscriber_id);
ALTER TABLE IF EXISTS consultations ADD INDEX IF NOT EXISTS idx_consultations_status (status);
