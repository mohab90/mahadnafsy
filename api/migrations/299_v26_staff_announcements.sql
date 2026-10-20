-- A message from the administration to the employees, shown as a special pop-up (20 Oct 2026).
--
-- «في قسم الإدارة أبعت رسالة فيديو أو صور أو كلام بشكل مميز يظهر بوب أب للموظفين»: one row per announcement (text, up to four
-- pictures, a video, a look, who it is for, until when) and one row per employee who has closed it, so it is shown to each
-- until they do — and a newly hired employee, who was never sent it, still sees one that is running.
CREATE TABLE IF NOT EXISTS staff_announcements (
  id varchar(36) NOT NULL,
  tenant_id varchar(64) NOT NULL,
  title varchar(200) NOT NULL,
  body text DEFAULT NULL,
  image_urls text DEFAULT NULL,
  video_url varchar(500) DEFAULT NULL,
  style enum('info','urgent','celebrate') NOT NULL DEFAULT 'info',
  audience_roles varchar(1000) DEFAULT NULL,
  expires_at datetime DEFAULT NULL,
  is_active tinyint(1) NOT NULL DEFAULT 1,
  created_by varchar(64) DEFAULT NULL,
  created_by_name varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_staff_ann_live (tenant_id, is_active, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_announcement_seen (
  tenant_id varchar(64) NOT NULL,
  announcement_id varchar(36) NOT NULL,
  staff_id varchar(64) NOT NULL,
  seen_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (tenant_id, announcement_id, staff_id),
  KEY idx_staff_ann_seen_staff (tenant_id, staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
