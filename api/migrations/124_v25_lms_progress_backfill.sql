INSERT INTO lecture_completions
  (id,tenant_id,subscriber_id,lecture_id,course_id,progress_pct,completed_at)
SELECT UUID(),s.tenant_id,s.id,cl.id,cl.course_id,
       LEAST(100,GREATEST(0,CAST(JSON_UNQUOTE(JSON_EXTRACT(
         JSON_EXTRACT(s.crm_json,'$.lectureProgress'),
         CONCAT('$."',REPLACE(j.lecture_id,'"','\\"'),'"')
       )) AS DECIMAL(6,2)))),
       CASE WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(
         JSON_EXTRACT(s.crm_json,'$.lectureProgress'),
         CONCAT('$."',REPLACE(j.lecture_id,'"','\\"'),'"')
       )) AS DECIMAL(6,2)) >= 90 THEN NOW() ELSE NULL END
FROM subscribers s
JOIN JSON_TABLE(
  COALESCE(JSON_KEYS(JSON_EXTRACT(s.crm_json,'$.lectureProgress')),JSON_ARRAY()),
  '$[*]' COLUMNS(lecture_id VARCHAR(36) PATH '$')
) j
JOIN course_lectures cl ON cl.id=j.lecture_id
JOIN courses c ON c.id=cl.course_id AND c.tenant_id=s.tenant_id
WHERE s.crm_json IS NOT NULL AND JSON_VALID(s.crm_json)
ON DUPLICATE KEY UPDATE
  progress_pct=GREATEST(lecture_completions.progress_pct,VALUES(progress_pct)),
  completed_at=CASE
    WHEN GREATEST(lecture_completions.progress_pct,VALUES(progress_pct))>=90
    THEN COALESCE(lecture_completions.completed_at,VALUES(completed_at),NOW())
    ELSE lecture_completions.completed_at
  END;

UPDATE subscribers
SET crm_json=JSON_REMOVE(crm_json,'$.lectureProgress')
WHERE crm_json IS NOT NULL AND JSON_VALID(crm_json)
  AND JSON_CONTAINS_PATH(crm_json,'one','$.lectureProgress');
