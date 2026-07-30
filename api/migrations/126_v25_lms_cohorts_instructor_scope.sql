ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS instructor_id VARCHAR(36) NULL AFTER instructor,
  ADD INDEX IF NOT EXISTS idx_courses_instructor (tenant_id,instructor_id,deleted_at);

ALTER TABLE therapists
  ADD COLUMN IF NOT EXISTS staff_id VARCHAR(36) NULL AFTER tenant_id,
  ADD INDEX IF NOT EXISTS idx_therapists_staff (tenant_id,staff_id);

UPDATE therapists t
JOIN staff s ON s.tenant_id=t.tenant_id AND LOWER(TRIM(s.name))=LOWER(TRIM(t.name))
  AND LOWER(s.role) IN ('instructor','trainer') AND s.is_active=1 AND s.deleted_at IS NULL
SET t.staff_id=s.id
WHERE t.staff_id IS NULL;

UPDATE courses c
JOIN therapists t ON t.tenant_id=c.tenant_id AND LOWER(TRIM(t.name))=LOWER(TRIM(c.instructor))
SET c.instructor_id=t.staff_id
WHERE c.instructor_id IS NULL AND t.staff_id IS NOT NULL;

ALTER TABLE bundle_courses
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER course_id,
  ADD INDEX IF NOT EXISTS idx_bundle_courses_tenant (tenant_id,bundle_id,sort_order);

UPDATE bundle_courses bc
JOIN bundles b ON b.id=bc.bundle_id
SET bc.tenant_id=b.tenant_id
WHERE bc.tenant_id<>b.tenant_id;

CREATE TABLE IF NOT EXISTS course_cohorts (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  course_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  max_students INT UNSIGNED NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_course_cohorts_course (tenant_id,course_id,status,starts_at),
  CONSTRAINT fk_course_cohort_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cohort_members (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  cohort_id VARCHAR(36) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at DATETIME NULL,
  created_by VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cohort_member (tenant_id,cohort_id,subscriber_id),
  INDEX idx_cohort_members_subscriber (tenant_id,subscriber_id,status),
  CONSTRAINT fk_cohort_member_cohort FOREIGN KEY (cohort_id) REFERENCES course_cohorts(id) ON DELETE CASCADE,
  CONSTRAINT fk_cohort_member_subscriber FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
