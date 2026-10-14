-- طلبات الانضمام: fill the form and branch on the rows already filed, and give
-- back «جديد» to the applications nobody has touched.
--
-- «لازم تفرق بيينهم بشكل كبير … لازم اي طلب بيكون جديد مش قيد المراجعه»
-- (12 Oct 2026). See 276 for the columns.
--
-- 1. branch — the applicant's own choice from the converted applicant row, else
--    the branch of the posting they applied to. Lower-case, as the forms send it.
--
-- 2. source_form — derived from which public page could have produced the row:
--    * EMPLOYEE is the /join-us (staff) page's type; CONSULTANT only /join offers.
--    * Only /join-us attaches an application to a real posting (/join never sends
--      a jobId), and only /join-us offers the experience bands below three years.
--      An INSTRUCTOR row with either of those came through the staff page and was
--      filed as a lecturer by the route's INSTRUCTOR fallback — it is corrected to
--      EMPLOYEE, which is what the applicant asked to be.
--    * Everything else came through /join.
--
-- 3. status — every website application was stamped REVIEWED («قيد المراجعة») the
--    moment it arrived, by the automatic conversion into the hiring pipeline. A row
--    goes back to NEW only when nothing shows that anyone has acted on it:
--      - REVIEWED with reviewed_at within a minute of created_at (the stamp the
--        conversion made, not a later review);
--      - never contacted, no interview date, no HR note;
--      - no recruitment note of any kind against it;
--      - its applicant row still at 'applied', never edited (updated_by NULL), no
--        interview date, no phone screen;
--      - no audit event against the application or its applicant — the status
--        dropdown and every pipeline move write one, in the same transaction.
--    Any row with one of those traces keeps REVIEWED.
--
-- Rollback: none needed for (1) and (2) beyond 276's; (3) is not reversible row by
-- row, and the rows it touches had no reviewer action to lose.

UPDATE join_us_applications j
  LEFT JOIN job_applicants a ON a.id = j.converted_applicant_id AND a.tenant_id = j.tenant_id
  LEFT JOIN job_postings p ON p.id = a.job_id AND p.tenant_id = a.tenant_id
   SET j.branch = LOWER(COALESCE(NULLIF(a.branch, ''), NULLIF(p.branch, '')))
 WHERE j.branch IS NULL
   AND COALESCE(NULLIF(a.branch, ''), NULLIF(p.branch, '')) IS NOT NULL;

UPDATE join_us_applications j
  LEFT JOIN job_applicants a ON a.id = j.converted_applicant_id AND a.tenant_id = j.tenant_id
   SET j.source_form = 'staff', j.type = 'EMPLOYEE'
 WHERE j.source_form IS NULL
   AND j.type = 'INSTRUCTOR'
   AND ((a.job_id IS NOT NULL AND a.job_id NOT LIKE 'talent-%')
     OR j.experience IN ('none', 'under_1', '1-3')
     OR a.experience_years IN ('none', 'under_1', '1-3'));

UPDATE job_applicants a
  JOIN join_us_applications j ON j.converted_applicant_id = a.id AND j.tenant_id = a.tenant_id
   SET a.applicant_type = 'EMPLOYEE'
 WHERE j.source_form = 'staff' AND j.type = 'EMPLOYEE' AND a.applicant_type = 'INSTRUCTOR';

UPDATE join_us_applications
   SET source_form = CASE WHEN type = 'EMPLOYEE' THEN 'staff' ELSE 'teaching' END
 WHERE source_form IS NULL;

UPDATE join_us_applications j
  LEFT JOIN job_applicants a ON a.id = j.converted_applicant_id AND a.tenant_id = j.tenant_id
   SET j.status = 'NEW', j.reviewed_at = NULL
 WHERE j.status = 'REVIEWED'
   AND j.reviewed_at IS NOT NULL
   AND ABS(TIMESTAMPDIFF(SECOND, j.created_at, j.reviewed_at)) <= 60
   AND j.contacted_at IS NULL
   AND j.interview_at IS NULL
   AND (j.admin_note IS NULL OR j.admin_note = '')
   AND NOT EXISTS (SELECT 1 FROM recruitment_notes n
                    WHERE n.tenant_id = j.tenant_id AND n.ref_type = 'join_us' AND n.ref_id = j.id)
   AND (j.converted_applicant_id IS NULL OR (
         a.id IS NOT NULL AND a.stage = 'applied' AND a.updated_by IS NULL
         AND a.interview_at IS NULL AND a.phone_interview_result IS NULL
         AND NOT EXISTS (SELECT 1 FROM recruitment_notes n
                          WHERE n.tenant_id = a.tenant_id AND n.ref_type = 'applicant' AND n.ref_id = a.id)))
   AND NOT EXISTS (SELECT 1 FROM audit_logs l
                    WHERE l.tenant_id = j.tenant_id
                      AND l.entity_id IN (j.id, COALESCE(j.converted_applicant_id, j.id)));
