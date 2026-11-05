-- 5 Nov 2026: three PDFs per course, each opened by what the client has paid. One row per course and tier:
--   FREE            the one anybody may read (the course page shows it to every visitor)
--   FIRST_PAYMENT   after the client has booked the course and paid a first payment on it
--   EIGHTY_PERCENT  the full document, after 80% or more of the course's price is paid
-- The file is stored privately (never under a path the web server hands out); the server decides, per request, who may download it.
CREATE TABLE IF NOT EXISTS course_documents (
  id varchar(36) NOT NULL,
  tenant_id varchar(64) NOT NULL DEFAULT 'tenant-default',
  course_id varchar(36) NOT NULL,
  tier enum('FREE','FIRST_PAYMENT','EIGHTY_PERCENT') NOT NULL,
  title varchar(300) NOT NULL,
  original_name varchar(300) NOT NULL,
  stored_name varchar(120) NOT NULL,
  size_bytes bigint(20) NOT NULL,
  sha256 char(64) NOT NULL,
  uploaded_by varchar(64) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_course_documents_tier (tenant_id, course_id, tier),
  KEY idx_course_documents_course (course_id),
  CONSTRAINT fk_course_documents_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
