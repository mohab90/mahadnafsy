-- Login telemetry columns used by /api/auth/login.
-- Kept as a numbered migration so the login route does not mutate schema at runtime.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_login DATETIME;
