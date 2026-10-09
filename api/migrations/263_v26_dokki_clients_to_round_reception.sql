-- «كل روند مسئول موظف رسيبشن وبالمثل كل عملاء روند هيبقوا تبع نفس الرسيبشن …
-- 1,920 من 1,921 عميل في الدقي ملهمش موظف مسئول … بناءا علي مسئول الروند» (9 Oct 2026).
--
-- A client housed in a Dokki or Tagamoa round with no responsible employee
-- becomes the round's reception's — the round they were housed in last. From now
-- on housing does it (lib/daqqiHousing.js assignToRoundReception). Clients in no
-- round (about 1,660 imported from the sheets) are left as they are: no round
-- names their reception. The clients touched are kept for the rollback.
--
-- Rollback:
--   UPDATE subscribers s JOIN backfill_263_dokki_owners b ON b.subscriber_id=s.id AND b.tenant_id=s.tenant_id
--      SET s.assigned_cs_id=NULL, s.assigned_cs_name=NULL;
--   DROP TABLE backfill_263_dokki_owners;

CREATE TABLE IF NOT EXISTS backfill_263_dokki_owners (
  tenant_id VARCHAR(64) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  reception_id VARCHAR(36) NOT NULL,
  reception_name VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (tenant_id, subscriber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO backfill_263_dokki_owners (tenant_id, subscriber_id, reception_id, reception_name)
SELECT x.tenant_id, x.subscriber_id,
       SUBSTRING_INDEX(x.receptions, '|', 1),
       (SELECT st.name FROM staff st WHERE st.id = SUBSTRING_INDEX(x.receptions, '|', 1) AND st.tenant_id = x.tenant_id LIMIT 1)
  FROM (
    SELECT da.tenant_id, da.subscriber_id,
           GROUP_CONCAT(r.reception_id ORDER BY (r.status = 'FINISHED'), da.booked_at DESC SEPARATOR '|') AS receptions
      FROM daqqi_attendees da
      JOIN daqqi_rounds r ON r.id = da.round_id AND r.tenant_id = da.tenant_id
     WHERE r.reception_id IS NOT NULL AND r.reception_id <> ''
     GROUP BY da.tenant_id, da.subscriber_id
  ) x
  JOIN subscribers s ON s.id = x.subscriber_id AND s.tenant_id = x.tenant_id
 WHERE s.deleted_at IS NULL AND (s.assigned_cs_id IS NULL OR s.assigned_cs_id = '');

UPDATE subscribers s
  JOIN backfill_263_dokki_owners b ON b.subscriber_id = s.id AND b.tenant_id = s.tenant_id
   SET s.assigned_cs_id = b.reception_id, s.assigned_cs_name = COALESCE(b.reception_name, s.assigned_cs_name)
 WHERE s.assigned_cs_id IS NULL OR s.assigned_cs_id = '';
