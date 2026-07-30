INSERT IGNORE INTO communications
  (id,tenant_id,lead_id,type,date,notes,outcome,next_follow_up,staff_id)
SELECT
  CONCAT('lc-',LEFT(SHA2(CONCAT(l.tenant_id,'|',l.id,'|',COALESCE(j.item_id,''),'|',
    COALESCE(j.date_text,''),'|',COALESCE(j.type_text,''),'|',COALESCE(j.notes,'')),256),33)),
  l.tenant_id,
  l.id,
  CASE UPPER(j.type_text)
    WHEN 'CALL' THEN 'CALL' WHEN 'WHATSAPP' THEN 'WHATSAPP' WHEN 'EMAIL' THEN 'EMAIL'
    WHEN 'MEETING' THEN 'MEETING' WHEN 'PAYMENT_FOLLOWUP' THEN 'PAYMENT_FOLLOWUP'
    WHEN 'NEW_COURSE_SALE' THEN 'NEW_COURSE_SALE' WHEN 'CERTIFICATE' THEN 'CERTIFICATE'
    ELSE 'NOTE'
  END,
  COALESCE(
    STR_TO_DATE(NULLIF(j.date_text,''),'%Y-%m-%dT%H:%i:%s.%fZ'),
    STR_TO_DATE(NULLIF(j.date_text,''),'%Y-%m-%d %H:%i:%s'),
    l.created_at,
    NOW()
  ),
  LEFT(COALESCE(NULLIF(j.notes,''),'Legacy CRM interaction'),2000),
  NULLIF(LEFT(j.outcome,500),''),
  COALESCE(
    STR_TO_DATE(NULLIF(j.next_follow_up,''),'%Y-%m-%dT%H:%i:%s.%fZ'),
    STR_TO_DATE(NULLIF(j.next_follow_up,''),'%Y-%m-%d %H:%i:%s')
  ),
  NULLIF(j.staff_id,'')
FROM leads l
JOIN JSON_TABLE(
  IF(JSON_VALID(l.crm_json),COALESCE(JSON_EXTRACT(l.crm_json,'$.communications'),JSON_ARRAY()),JSON_ARRAY()),
  '$[*]' COLUMNS (
    item_id VARCHAR(100) PATH '$.id' NULL ON EMPTY,
    type_text VARCHAR(50) PATH '$.type' NULL ON EMPTY,
    date_text VARCHAR(100) PATH '$.date' NULL ON EMPTY,
    notes TEXT PATH '$.notes' NULL ON EMPTY,
    outcome TEXT PATH '$.outcome' NULL ON EMPTY,
    next_follow_up VARCHAR(100) PATH '$.nextFollowUp' NULL ON EMPTY,
    staff_id VARCHAR(36) PATH '$.staffId' NULL ON EMPTY
  )
) j
WHERE l.crm_json IS NOT NULL
  AND JSON_VALID(l.crm_json)
  AND JSON_TYPE(JSON_EXTRACT(l.crm_json,'$.communications'))='ARRAY';

UPDATE leads
SET crm_json=JSON_REMOVE(crm_json,'$.communications')
WHERE crm_json IS NOT NULL
  AND JSON_VALID(crm_json)
  AND JSON_CONTAINS_PATH(crm_json,'one','$.communications');
