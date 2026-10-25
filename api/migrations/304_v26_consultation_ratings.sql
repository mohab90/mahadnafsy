-- The client's rating of a consultation, 1 to 5 stars (25 Oct 2026).
--
-- «تقييم الاستشارة»: a consultation marked completed sends the client their own link to rate it
-- (lib/consultationRating.js); the lecturer reads the ratings in their portal. One rating per consultation.
CREATE TABLE IF NOT EXISTS consultation_ratings (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  consultation_id VARCHAR(36) NOT NULL,
  therapist_id VARCHAR(36) NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_consultation_rating (tenant_id, consultation_id),
  KEY idx_consultation_rating_therapist (tenant_id, therapist_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
