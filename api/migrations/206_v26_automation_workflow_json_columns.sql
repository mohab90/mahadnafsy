-- automation_workflows: the column names migrations build are not the ones the
-- code reads.
--
-- Migration 007 creates the table with `conditions` and `action_config`.
-- routes/automation.js reads and writes `conditions_json` and
-- `action_config_json` — every statement in that file, the SELECT and the
-- INSERT/UPDATE alike. Production carries the _json names and works, and
-- api/schema.sql declares the _json names too. Only the migration was left
-- behind, so the rename happened on the database without ever being recorded.
--
-- A database built from migrations alone therefore comes up with a table the
-- automation routes cannot query, and every automation screen fails on its
-- first request. Nobody has hit it because every environment so far was cloned
-- from a database that already had the right names.
--
-- The drift guard reported this the other way round — as schema.sql "missing"
-- conditions/action_config, flagged CRITICAL — because it treats migrations as
-- the source of truth and blames the snapshot whenever the two disagree. Here
-- the snapshot was right.
--
-- CHANGE ... IF EXISTS rather than ADD: adding the _json columns would leave
-- the two originals beside them with no way for a later reader to tell which
-- pair holds the data. MariaDB 10.11 supports IF EXISTS on CHANGE COLUMN, so
-- each of these is one idempotent statement — no session variables, which the
-- migration runner could not carry across a pooled connection anyway.
--
-- On production both are no-ops: the columns already have these names.
ALTER TABLE automation_workflows
  CHANGE COLUMN IF EXISTS `conditions` `conditions_json` TEXT DEFAULT NULL;

ALTER TABLE automation_workflows
  CHANGE COLUMN IF EXISTS `action_config` `action_config_json` TEXT DEFAULT NULL;

-- Belt and braces for a database built by some other route: whichever way it
-- arrived here, both columns exist afterwards.
ALTER TABLE automation_workflows
  ADD COLUMN IF NOT EXISTS conditions_json TEXT DEFAULT NULL;

ALTER TABLE automation_workflows
  ADD COLUMN IF NOT EXISTS action_config_json TEXT DEFAULT NULL;

-- description is on production and in schema.sql but likewise absent from 007;
-- 079 adds tenant_id, nothing ever adds this one.
ALTER TABLE automation_workflows
  ADD COLUMN IF NOT EXISTS description VARCHAR(500) DEFAULT NULL;

-- course_completions.email_sent — declared by 007, present nowhere.
--
-- Not on production, not in api/schema.sql, and no code in api/, admin/ or
-- client/ reads or writes it. 007 is baselined, so a fresh build never runs it
-- and never creates the column either: it exists only as a line in a migration
-- nobody replays, which is why the drift guard reported it as a CRITICAL column
-- missing from the snapshot on every single run.
--
-- Dropping it states the decision instead of leaving the guard to raise it
-- forever. A no-op on every database that exists today.
ALTER TABLE course_completions DROP COLUMN IF EXISTS email_sent;
