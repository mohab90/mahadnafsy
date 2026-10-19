-- «محضروش الانترفيو» and «المرفوضين» on the interviews page (19 Oct 2026).
--
-- A candidate who took an appointment and did not come is marked «لم يحضر»: no_show_at holds when, and the interviews page
-- lists them under their own tab (the candidate stays at the interview stage, so the pipeline is untouched, and a new
-- appointment brings them back to «القادم»). A candidate rejected from the interviews screen is flagged
-- rejected_from_interview, so the «المرفوضون» tab lists the people turned down after (or at) an interview, not every
-- applicant ever rejected at the screening stage.
ALTER TABLE job_applicants ADD COLUMN IF NOT EXISTS no_show_at DATETIME NULL;
ALTER TABLE job_applicants ADD COLUMN IF NOT EXISTS rejected_from_interview TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE job_applicants ADD INDEX IF NOT EXISTS idx_applicants_tenant_noshow (tenant_id, stage, no_show_at);
-- Those already rejected who had an interview date, a held interview or a grade.
UPDATE job_applicants SET rejected_from_interview = 1
 WHERE stage = 'rejected' AND rejected_from_interview = 0
   AND (interview_at IS NOT NULL OR interviewed_at IS NOT NULL OR interview_grade IS NOT NULL OR second_interview_grade IS NOT NULL);
