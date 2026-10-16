-- «أكثر من 10 سنوات» was sent as «10+» by the staff application page (/join-us)
-- and the old admin join form, while every filter and label knows the band as
-- «10plus» (admin/.../applicantLabels.ts, EXPERIENCE_ORDER). Those applicants
-- matched no experience filter. The forms send «10plus» now; this brings the
-- rows already filed into line. Idempotent: a second run changes nothing.
UPDATE job_applicants SET experience_years = '10plus' WHERE experience_years = '10+';
UPDATE join_us_applications SET experience = '10plus' WHERE experience = '10+';
