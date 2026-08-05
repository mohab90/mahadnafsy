-- Two-way internal thread between management and an employee.
-- `notifications.recipient_staff_id` already carries system→staff alerts, but
-- it is one-way and unthreaded, so it cannot represent "management wrote to
-- the employee, the employee wrote back". This table is that conversation:
-- one thread per employee (staff_id), each row tagged with who wrote it.
CREATE TABLE IF NOT EXISTS staff_messages (
  id varchar(36) NOT NULL,
  tenant_id varchar(64) NOT NULL DEFAULT 'tenant-default',
  -- Whose thread this belongs to (the employee being discussed//messaged).
  staff_id varchar(36) NOT NULL,
  -- Who wrote this message. NULL only if the author's staff row is later
  -- deleted; author_name is denormalised so the thread stays readable.
  author_staff_id varchar(36) DEFAULT NULL,
  author_name varchar(255) NOT NULL DEFAULT '',
  -- to_staff   = management → employee
  -- from_staff = employee → management (posted by the employee themselves)
  direction enum('to_staff','from_staff') NOT NULL DEFAULT 'to_staff',
  body text NOT NULL,
  read_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_staff_messages_thread (tenant_id, staff_id, created_at),
  KEY idx_staff_messages_unread (tenant_id, staff_id, direction, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The staff profile aggregates calls per staff member across their whole
-- employment period. `communications` had indexes on lead/subscriber/direction
-- but none on staff_id, so that aggregation was a full scan of a table that is
-- already large at this tenant's CRM volume.
ALTER TABLE IF EXISTS communications
  ADD INDEX IF NOT EXISTS idx_comm_tenant_staff_date (tenant_id, staff_id, date);
