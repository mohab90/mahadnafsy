-- «الإشعارات … مش بيوصل موبايل الموظف غير لو فاتح اللوحة». Whose phone a push
-- subscription is: an employee's (staff_id) or the owner's (is_admin), so each
-- notification reaches the people its bell shows it to (lib/staffPush.js).
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS staff_id varchar(36) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_admin tinyint(1) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_push_tenant_staff ON push_subscriptions (tenant_id, staff_id, is_active);
