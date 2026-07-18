-- Client type taxonomy fields.
-- Mirrors the temporary startup guard in api/lib/startupTasks.js.

ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS client_type VARCHAR(50) DEFAULT NULL;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS client_type VARCHAR(50) DEFAULT NULL;
