-- The COLLATE on the JSON_TABLE side of these joins is required, not cosmetic.
-- MariaDB gives every JSON_TABLE column utf8mb4_general_ci no matter what the
-- connection or database collation is (verified: SET NAMES utf8mb4 COLLATE
-- utf8mb4_unicode_ci still yields COLLATION(j.col) = utf8mb4_general_ci), while
-- every real column here is utf8mb4_unicode_ci. Comparing them is an outright
-- error — this migration failed with "Illegal mix of collations" on a rehearsal
-- against a copy of production, after 82 earlier migrations had already applied.
INSERT IGNORE INTO course_completions
  (id,tenant_id,subscriber_id,course_id,certificate_code,completed_at,status,version)
SELECT UUID(),s.tenant_id,s.id,c.id,
       COALESCE(NULLIF(j.certificate_code,''),CONCAT('MHAD-LEGACY-',UPPER(SUBSTRING(REPLACE(UUID(),'-',''),1,12)))),
       COALESCE(STR_TO_DATE(LEFT(j.issued_at,19),'%Y-%m-%dT%H:%i:%s'),s.created_at,NOW()),
       'active',1
FROM subscribers s
JOIN JSON_TABLE(
  IF(JSON_VALID(s.crm_json),COALESCE(JSON_EXTRACT(s.crm_json,'$.certificates'),JSON_ARRAY()),JSON_ARRAY()),
  '$[*]' COLUMNS(
    course_id VARCHAR(36) PATH '$.courseId',
    certificate_code VARCHAR(50) PATH '$.certificateNumber',
    issued_at VARCHAR(40) PATH '$.issuedAt'
  )
) j
JOIN courses c ON c.id=j.course_id COLLATE utf8mb4_unicode_ci AND c.tenant_id=s.tenant_id AND c.deleted_at IS NULL
WHERE j.course_id IS NOT NULL;

INSERT INTO certificate_lifecycle_events
  (id,tenant_id,completion_id,event_type,new_code,actor,reason,created_at)
SELECT UUID(),cc.tenant_id,cc.id,'issued',cc.certificate_code,'migration-125',
       'Legacy subscriber certificate backfill',cc.completed_at
FROM course_completions cc
WHERE NOT EXISTS (
  SELECT 1 FROM certificate_lifecycle_events e
  WHERE e.tenant_id=cc.tenant_id AND e.completion_id=cc.id AND e.event_type='issued'
);

UPDATE subscribers
SET crm_json=JSON_REMOVE(crm_json,'$.certificates')
WHERE crm_json IS NOT NULL AND JSON_VALID(crm_json)
  AND JSON_CONTAINS_PATH(crm_json,'one','$.certificates');
