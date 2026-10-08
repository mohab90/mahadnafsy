-- «في صفحه الشهادات محتاجين يبقي تكمله لداتا العميل الاسم بالانجليزي ,, الرقم
-- القومي ,,, تاريخ بداية الكورس وتاريخ النهايه» (8 Oct 2026).
--
-- certificate_requests.course_start_date / course_end_date   the dates the
-- certificate states; until the desk types them the list suggests them from the
-- client's Dokki round or enrolment (routes/certificates.js).
--
-- Rollback:
--   ALTER TABLE certificate_requests DROP COLUMN course_start_date, DROP COLUMN course_end_date;

ALTER TABLE certificate_requests
  ADD COLUMN IF NOT EXISTS course_start_date DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS course_end_date DATE DEFAULT NULL;
