-- The «LinkedIn / الموقع» box of the join-us form took any text, and the HR screen opens it in one click:
-- a `javascript:` link there ran as a script in the officer's session. The routes now keep web links only
-- (lib/joinApplication.js webAddress); this empties the ones already stored that are not.
UPDATE join_us_applications SET linkedin = NULL
 WHERE linkedin IS NOT NULL AND linkedin REGEXP '^[[:space:]]*(javascript|data|vbscript|file|blob):';
UPDATE job_applicants SET linkedin = NULL
 WHERE linkedin IS NOT NULL AND linkedin REGEXP '^[[:space:]]*(javascript|data|vbscript|file|blob):';
