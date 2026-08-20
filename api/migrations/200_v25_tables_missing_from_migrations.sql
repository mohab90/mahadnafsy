-- Three tables the application reads and writes that no migration ever created.
--
-- They exist in production and therefore in api/schema.sql, which was dumped
-- from it — but a fresh database built from migrations/ alone comes up without
-- them, and the code that uses them fails on the first request:
--
--   course_chapters      — the LMS curriculum. routes/lms-admin.js writes it,
--                          routes/public.js and core/catalog.js read it.
--   therapist_slots      — consultation availability. Rewritten wholesale every
--                          time a therapist is saved (routes/lms-admin.js).
--   issued_certificates  — issued certificate records, read by the privacy
--                          export.
--
-- The drift guard has been reporting these as "only in schema.sql" and they read
-- as harmless legacy. They are the opposite: legacy tables are ones nothing uses,
-- and these are load-bearing. The gap only stays invisible because every
-- environment so far was cloned from a database that already had them.
--
-- Definitions copied verbatim from api/schema.sql so an existing database sees
-- no change — IF NOT EXISTS makes this a no-op wherever the tables are already
-- present, which is everywhere today.
--
-- Deliberately NOT added here: course_materials, discount_rules and
-- notification_broadcasts. They are in schema.sql for the same reason but no
-- code path touches them, so creating them in a fresh build would carry dead
-- weight forward. They should be dropped from schema.sql instead, which is a
-- separate decision about production data.

CREATE TABLE IF NOT EXISTS course_chapters (
  id varchar(36) NOT NULL DEFAULT (uuid()),
  course_id varchar(36) NOT NULL,
  title varchar(500) NOT NULL,
  sort_order int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_chapters_course (course_id),
  CONSTRAINT fk_chapters_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS therapist_slots (
  id varchar(36) NOT NULL DEFAULT (uuid()),
  therapist_id varchar(36) NOT NULL,
  day varchar(20) NOT NULL,
  start_time varchar(10) NOT NULL,
  end_time varchar(10) NOT NULL,
  timezone varchar(100) NOT NULL,
  label varchar(255) DEFAULT NULL,
  meeting_link text DEFAULT NULL,
  is_active tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_slots_therapist (therapist_id),
  CONSTRAINT fk_slots_therapist FOREIGN KEY (therapist_id) REFERENCES therapists (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS issued_certificates (
  id varchar(36) NOT NULL DEFAULT (uuid()),
  subscriber_id varchar(36) NOT NULL,
  course_id varchar(36) NOT NULL,
  certificate_number varchar(100) NOT NULL,
  issued_at datetime NOT NULL DEFAULT current_timestamp(),
  note text DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY idx_issued_cert_number (certificate_number),
  KEY idx_issued_cert_subscriber (subscriber_id),
  KEY idx_issued_cert_course (course_id),
  CONSTRAINT fk_issued_cert_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT fk_issued_cert_subscriber FOREIGN KEY (subscriber_id) REFERENCES subscribers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
