ALTER TABLE join_us_applications
  ADD COLUMN `role_type` VARCHAR(50) DEFAULT 'instructor' AFTER `type`;
