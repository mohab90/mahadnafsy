-- The daily archive job (api/lib/archiveJob.js) has been silently failing since
-- runtime DDL was locked down in api/lib/db.js: it tried to CREATE TABLE IF NOT
-- EXISTS activity_logs_archive on every run, which the DDL guard now no-ops,
-- so the INSERT INTO activity_logs_archive that follows has been erroring out
-- (caught and only console.error'd) with the table never created. Own it here.
CREATE TABLE IF NOT EXISTS activity_logs_archive LIKE activity_logs;
