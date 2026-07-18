-- Add HR/staff applications to the join-us workflow.
ALTER TABLE join_us_applications
  MODIFY COLUMN `type` ENUM('INSTRUCTOR','CONSULTANT','STAFF') NOT NULL DEFAULT 'INSTRUCTOR';
