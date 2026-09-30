-- «سجل النظام … اسم المسئول مش ايميله ومحتاجين يضاف القسم». Who did it by
-- name, their department, and what was sent (middleware/adminAudit.js).
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS actor_name varchar(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS department varchar(80) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS details text DEFAULT NULL;

-- «عمود اسمه جهه التحصيل»: where the certificate's money was taken — a box
-- («خزنة الدقي», «فودافون كاش …»). Imported requests carry it in their note.
ALTER TABLE certificate_requests
  ADD COLUMN IF NOT EXISTS collection_party varchar(160) DEFAULT NULL;

-- «قسم شهادات في الشحن … زر اتسلم لشركة الشحن … ومنها زر تاني استلم للعميل او
-- حصل مرتجع». RETURNED: the courier brought it back. Last: the column feeds the
-- generated active_request_marker, and the statements above must not wait on it.
ALTER TABLE certificate_requests
  MODIFY COLUMN status enum('PENDING','PRICED','PAID','IN_PROGRESS','NOT_SENT','ISSUED','SHIPPED','AT_BRANCH','DELIVERED','RETURNED') NOT NULL DEFAULT 'PENDING';
