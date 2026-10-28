-- Certificates: what was printed, wrong ones deleted, a track's hours, and the English name in one place (26 Oct 2026).
--
-- «أي شهادة اتطبعت في المعهد لازم يظهر علامة إنها اتطبعت … والشهادة الغلط يبقى جنبها زر حذف … وكل كورس ومسار أحدد أنا ساعاته»:
--   printed_at / printed_by / print_count  the desk's own prints (the client's downloads are downloaded_at / download_count)
--   deleted_at / deleted_by                a revoked certificate taken off the client's page (kept, so the hourly sweep does not issue it again)
--   bundles.hours                          the training hours a track's certificate prints, as courses.hours does for a course
ALTER TABLE course_completions ADD COLUMN IF NOT EXISTS printed_at DATETIME NULL;
ALTER TABLE course_completions ADD COLUMN IF NOT EXISTS printed_by VARCHAR(255) NULL;
ALTER TABLE course_completions ADD COLUMN IF NOT EXISTS print_count INT NOT NULL DEFAULT 0;
ALTER TABLE course_completions ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;
ALTER TABLE course_completions ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255) NULL;
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS hours DOUBLE NULL;

-- «الاسم بالإنجليزي … أنا مدخله قبل كده لنفس العميل من صفحة الشهادات»: the English name typed on a certificate request is the CLIENT's name;
-- a client whose file has none takes the latest English one a request carries (never an Arabic one).
UPDATE subscribers s
  JOIN (SELECT cr.tenant_id, cr.subscriber_id,
               SUBSTRING_INDEX(GROUP_CONCAT(TRIM(cr.name_en) ORDER BY cr.requested_at DESC SEPARATOR '|'), '|', 1) AS name_en
          FROM certificate_requests cr
         WHERE cr.subscriber_id IS NOT NULL AND TRIM(COALESCE(cr.name_en, '')) <> ''
           AND cr.name_en REGEXP '[A-Za-z]' AND cr.name_en NOT REGEXP '[ء-ي]'
         GROUP BY cr.tenant_id, cr.subscriber_id) r
    ON r.tenant_id = s.tenant_id AND r.subscriber_id = s.id
   SET s.name_en = r.name_en
 WHERE s.name_en IS NULL OR TRIM(s.name_en) = '';
