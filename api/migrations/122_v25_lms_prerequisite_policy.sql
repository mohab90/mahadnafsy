CREATE TABLE IF NOT EXISTS learning_prerequisites (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  subject_type VARCHAR(24) NOT NULL,
  subject_id VARCHAR(100) NOT NULL,
  prerequisite_course_id VARCHAR(36) NOT NULL,
  requirement_type VARCHAR(24) NOT NULL DEFAULT 'completion',
  created_by VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_learning_prerequisite (tenant_id,subject_type,subject_id,prerequisite_course_id),
  INDEX idx_learning_prerequisite_subject (tenant_id,subject_type,subject_id),
  CONSTRAINT fk_learning_prerequisite_course FOREIGN KEY (prerequisite_course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
