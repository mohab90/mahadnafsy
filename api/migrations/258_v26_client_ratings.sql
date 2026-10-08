-- «في صفحه جدول الدقي للعملاء اللى بتحضر زر اسمه تقييم … اقدر اسجل فيه تقييم
-- العميل من 1 الي 10 في المحاضر وفي المادة العلميه وفي توصيل المعلومه وفي
-- مسئولين الفرع ,, ويكون في مكان لو عنده ملاحظه او مشكله او تطوير نسجله» (8 Oct 2026).
--
-- client_ratings   one row per time a client housed in a round was asked: the
--                  four scores (1–10), the note, the round and its course and
--                  lecturer as they were that day, and who wrote it down. Read by
--                  the client's file, «التقييمات», and the round's attendee rows.
--
-- Rollback:
--   DROP TABLE client_ratings;

CREATE TABLE IF NOT EXISTS client_ratings (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  round_id VARCHAR(36) DEFAULT NULL,
  branch VARCHAR(32) DEFAULT NULL,
  course_id VARCHAR(36) DEFAULT NULL,
  instructor_name VARCHAR(255) DEFAULT NULL,
  instructor_score TINYINT UNSIGNED NOT NULL,
  material_score TINYINT UNSIGNED NOT NULL,
  delivery_score TINYINT UNSIGNED NOT NULL,
  branch_staff_score TINYINT UNSIGNED NOT NULL,
  note TEXT DEFAULT NULL,
  created_by_id VARCHAR(36) DEFAULT NULL,
  created_by_name VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_client_ratings_subscriber (tenant_id, subscriber_id, created_at),
  KEY idx_client_ratings_round (tenant_id, round_id),
  KEY idx_client_ratings_created (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
