-- Normalize lead statuses to the lowercase values used by the admin frontend,
-- analytics filters, automation rules, and CRM reports.

UPDATE leads
SET status = LOWER(status)
WHERE status REGEXP BINARY '^[A-Z_]+$';
