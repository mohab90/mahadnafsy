-- The dates a client's course ran, for the certificate.
--
-- «اي عميل في صفحته لازم يكون في زر بيظهر للتحصيل وخدمة العملاء اسمه بيانات الشهادة
-- يقدر يدخل فيه اسم العميل بالانجليزي وتاريخ الكورس البداية والنهاية والرقم القومي»
-- (13 Oct 2026). The dates lived only on a certificate REQUEST, so a client with none —
-- the institute's own free certificate has no request — had nowhere to hold them.
-- They sit on the enrolment now (one row per client and course); a request that
-- is opened later is filled from them.
--
-- Rollback:
--   ALTER TABLE enrollments DROP COLUMN course_start_date, DROP COLUMN course_end_date;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS course_start_date DATE NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS course_end_date DATE NULL DEFAULT NULL;
