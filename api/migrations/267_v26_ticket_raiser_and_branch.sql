-- A ticket says who raised it and which branch it is for.
--
-- «في خدمه العملاء مشاكل العملاء والتذاكر … لازم نظهر المشكله او الشكوي تبع فرع
-- ايه، وكمان مين المسئول في الفرع اللى رفعتها» (10 Oct 2026). A problem opened
-- from a client's row by the Dokki reception and one the client wrote on the site
-- looked the same: no branch, no raiser. created_by_* is the employee who opened
-- it (empty when the client did); branch is the client's branch, else the
-- raiser's. Older tickets read the client's branch and the «created» event's
-- actor instead (routes/support.js).
--
-- Rollback:
--   ALTER TABLE support_tickets DROP COLUMN branch, DROP COLUMN created_by_name, DROP COLUMN created_by_id;

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS created_by_id VARCHAR(36) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS created_by_name VARCHAR(255) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS branch VARCHAR(16) NULL DEFAULT NULL;
