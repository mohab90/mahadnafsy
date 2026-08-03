-- The COLLATE on the JSON_TABLE side of these joins is required, not cosmetic.
-- MariaDB gives every JSON_TABLE column utf8mb4_general_ci no matter what the
-- connection or database collation is (verified: SET NAMES utf8mb4 COLLATE
-- utf8mb4_unicode_ci still yields COLLATION(j.col) = utf8mb4_general_ci), while
-- every real column here is utf8mb4_unicode_ci. Comparing them is an outright
-- error — this migration failed with "Illegal mix of collations" on a rehearsal
-- against a copy of production, after 82 earlier migrations had already applied.
INSERT IGNORE INTO enrollments
  (id,tenant_id,subscriber_id,course_id,enrolled_at,access_type,lecture_limit,status,
   entitlement_source,granted_by,branch_id)
SELECT UUID(),s.tenant_id,s.id,c.id,COALESCE(s.created_at,NOW()),
       CASE
         WHEN LOWER(COALESCE(
           JSON_UNQUOTE(JSON_EXTRACT(s.crm_json,CONCAT('$.courseAccess."',REPLACE(j.course_id,'"','\\"'),'".mode'))),
           JSON_UNQUOTE(JSON_EXTRACT(s.crm_json,CONCAT('$.courseAccess."',REPLACE(j.course_id,'"','\\"'),'"'))),
           'full'
         ))='limited' THEN 'limited' ELSE 'full'
       END,
       CAST(JSON_UNQUOTE(JSON_EXTRACT(s.crm_json,CONCAT('$.courseAccess."',REPLACE(j.course_id,'"','\\"'),'".lectureLimit'))) AS UNSIGNED),
       'active','legacy_crm_backfill','migration-121',COALESCE(s.branch_id,'branch-other')
FROM subscribers s
JOIN JSON_TABLE(
  IF(JSON_VALID(s.crm_json),COALESCE(JSON_EXTRACT(s.crm_json,'$.enrolledCourseIds'),JSON_ARRAY()),JSON_ARRAY()),
  '$[*]' COLUMNS(course_id VARCHAR(100) PATH '$')
) j
JOIN courses c ON c.id=j.course_id COLLATE utf8mb4_unicode_ci AND c.tenant_id=s.tenant_id AND c.deleted_at IS NULL
WHERE j.course_id NOT LIKE 'bundle:%';

INSERT IGNORE INTO enrollments
  (id,tenant_id,subscriber_id,course_id,bundle_id,enrolled_at,access_type,status,
   entitlement_source,granted_by,branch_id)
SELECT UUID(),s.tenant_id,s.id,bc.course_id,b.id,COALESCE(s.created_at,NOW()),
       'full','active','legacy_crm_backfill','migration-121',COALESCE(s.branch_id,'branch-other')
FROM subscribers s
JOIN JSON_TABLE(
  IF(JSON_VALID(s.crm_json),COALESCE(JSON_EXTRACT(s.crm_json,'$.enrolledCourseIds'),JSON_ARRAY()),JSON_ARRAY()),
  '$[*]' COLUMNS(item_id VARCHAR(100) PATH '$')
) j
JOIN bundles b ON b.id=SUBSTRING(j.item_id,8) COLLATE utf8mb4_unicode_ci AND b.tenant_id=s.tenant_id
JOIN bundle_courses bc ON bc.bundle_id=b.id
JOIN courses c ON c.id=bc.course_id AND c.tenant_id=s.tenant_id AND c.deleted_at IS NULL
WHERE j.item_id LIKE 'bundle:%';

INSERT INTO entitlement_events
  (id,tenant_id,enrollment_id,subscriber_id,course_id,event_type,source,actor,meta_json)
SELECT UUID(),e.tenant_id,e.id,e.subscriber_id,e.course_id,'granted',
       'legacy_crm_backfill','migration-121',JSON_OBJECT('backfilled',TRUE)
FROM enrollments e
WHERE e.entitlement_source='legacy_crm_backfill'
  AND NOT EXISTS (
    SELECT 1 FROM entitlement_events x
    WHERE x.tenant_id=e.tenant_id AND x.enrollment_id=e.id AND x.event_type='granted'
  );

UPDATE subscribers
SET crm_json=JSON_REMOVE(crm_json,'$.enrolledCourseIds','$.courseAccess')
WHERE crm_json IS NOT NULL AND JSON_VALID(crm_json)
  AND JSON_CONTAINS_PATH(crm_json,'one','$.enrolledCourseIds','$.courseAccess');
