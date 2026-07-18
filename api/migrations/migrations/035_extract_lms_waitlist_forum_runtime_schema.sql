-- LMS waitlist/forum schema extracted from api/routes/lms.js runtime guards.
-- Keep route-level guards temporarily until all environments run numbered migrations.

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS max_students INT UNSIGNED NULL COMMENT 'NULL = unlimited';

CREATE TABLE IF NOT EXISTS course_waitlist (
  id VARCHAR(36) PRIMARY KEY,
  course_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) DEFAULT NULL,
  name VARCHAR(255) DEFAULT NULL,
  email VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  status ENUM('waiting','notified','enrolled','cancelled') NOT NULL DEFAULT 'waiting',
  position INT UNSIGNED NOT NULL DEFAULT 0,
  notified_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_course_waitlist_sub (course_id, subscriber_id),
  KEY idx_course_waitlist_course_status (course_id, status, position)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS forum_posts (
  id VARCHAR(36) PRIMARY KEY,
  author_id VARCHAR(36) DEFAULT NULL,
  author_name VARCHAR(255) DEFAULT NULL,
  course_id VARCHAR(36) DEFAULT NULL,
  parent_id VARCHAR(36) DEFAULT NULL,
  title VARCHAR(500) DEFAULT NULL,
  body TEXT NOT NULL,
  upvotes INT NOT NULL DEFAULT 0,
  is_hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_forum_course_hidden_created (course_id, is_hidden, created_at),
  KEY idx_forum_parent_hidden (parent_id, is_hidden)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS forum_upvotes (
  post_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, subscriber_id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
