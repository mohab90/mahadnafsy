-- «نجهز خدمه اللايف سيشن … حساب لمحاضر يدخل علي السيستم بصلاحيه محاضر ويقدر
-- يفتح اللايف ,, ولما نضيف محاضرة لايف علي السيستم مع دكتور لازم يروحله اشعار
-- ويروح لكل العملاء اللى مشتركه في نفس الكورس … بس شرط ان العملاء دول خلصوا
-- فلوسهم او 90 % وشرط انهم محضروش اللايف قبل كدا» (8 Oct 2026).
--
-- live_streams.instructor_id (already there, never written) now holds the lecturer's
-- staff id; announced_at is when the lecturer and the clients were told; started_at /
-- ended_at are the lecturer's «ابدأ» and «إنهاء».
-- live_stream_attendance — a client who joined, through their own link or the site.
--
-- Rollback:
--   DROP TABLE live_stream_attendance;
--   ALTER TABLE live_streams DROP COLUMN announced_at, DROP COLUMN started_at, DROP COLUMN ended_at;

ALTER TABLE live_streams
  ADD COLUMN IF NOT EXISTS announced_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS started_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ended_at DATETIME DEFAULT NULL;

CREATE TABLE IF NOT EXISTS live_stream_attendance (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  stream_id VARCHAR(64) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  via VARCHAR(20) NOT NULL DEFAULT 'link',
  PRIMARY KEY (id),
  UNIQUE KEY uq_live_attendance (tenant_id, stream_id, subscriber_id),
  KEY idx_live_attendance_subscriber (tenant_id, subscriber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
