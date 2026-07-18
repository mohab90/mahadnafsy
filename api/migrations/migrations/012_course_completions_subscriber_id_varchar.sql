-- Migration 012 - course_completions subscriber id compatibility
-- Keeps certificate fixtures and certificate routes compatible with subscribers.id VARCHAR(36).

ALTER TABLE course_completions
  MODIFY COLUMN subscriber_id VARCHAR(36) NOT NULL;

