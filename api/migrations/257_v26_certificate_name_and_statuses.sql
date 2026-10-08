-- «خلي اسم العميل مدام ثلاثي او اكثر يكون هو الاسم علي الشهاده … والحالات هتكون
-- كالاتي فقط» (8 Oct 2026).
--
-- A request with no name for its certificate takes the client's when it is three
-- names or more (new requests do so as they are made — lib/certificatePayments.js
-- certificateNameOf). And «لسه متبعتتش» is no longer a status: a paid request not
-- yet sent is «تحت المراجعة» (PAID).
--
-- Rollback: none needed — a name only filled where there was none; NOT_SENT held no rows on 8 Oct 2026.

UPDATE certificate_requests cr
  JOIN subscribers s ON s.id = cr.subscriber_id AND s.tenant_id = cr.tenant_id
   SET cr.name_ar = TRIM(s.name)
 WHERE (cr.name_ar IS NULL OR TRIM(cr.name_ar) = '')
   AND TRIM(s.name) REGEXP '^[^ ]+( +[^ ]+){2,}$';

UPDATE certificate_requests SET status = 'PAID' WHERE status = 'NOT_SENT';
