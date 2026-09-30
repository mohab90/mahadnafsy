-- «استرداد جزئي لكورس محدد للعميل … عند الاسترداد لازم يتحدد دفعه العميل …
-- مش لازم الخطوه دي». A refund names the course it is for — a course id, or
-- 'bundle:<id>' for a track — so one with no payment behind it can still be
-- approved against that course (lib/refunds.js#applyUnlinkedRefund).
ALTER TABLE refund_requests
  ADD COLUMN IF NOT EXISTS course_item varchar(80) DEFAULT NULL;

-- HANDLING — moved to another course, credited, settled some other way — has
-- been offered by PUT /api/admin/finance/refunds/:id since 198, and the column
-- never took it: production runs STRICT_TRANS_TABLES, so choosing it failed
-- the save.
ALTER TABLE refund_requests
  MODIFY COLUMN status enum('PENDING','APPROVED','REJECTED','HANDLING') DEFAULT 'PENDING';
