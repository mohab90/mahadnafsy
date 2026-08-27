-- A Dokki round without a start date was allowed by the column, and three of
-- them existed.
--
-- start_date has been `datetime DEFAULT NULL` since the table was created. The
-- API has required it on save for a while, but only in application code — so
-- rounds written before that rule, or by any path that skipped it, kept a NULL.
-- Three did: codes 3000, 3002 and 3003.
--
-- What that cost was not obvious from the column. Removing a client from a round
-- re-saved the whole round, so the roster change went through the round's own
-- validation and was refused — the desk was told "تعذر حذف العميل من الروند"
-- for a reason that had nothing to do with the client. Editing one of those
-- rounds gave a different message for the same refusal.
--
-- The API side is fixed: removing a client has its own route now, a zero date
-- can no longer be stored, and validation names the missing field in Arabic.
-- This closes the last half — the column itself.
--
-- Safe to apply as written because daqqi_rounds is empty at the time of writing
-- (the owner cleared all seven rounds). The UPDATE below is a belt-and-braces
-- guard: if any row somehow exists with no start date when this runs, it takes
-- the row's own creation date rather than failing the migration and blocking
-- every migration after it.
UPDATE daqqi_rounds
   SET start_date = DATE(created_at)
 WHERE start_date IS NULL
    OR CAST(start_date AS CHAR) LIKE '0000-00-00%';

-- The type stays datetime. Only the nullability changes: narrowing it to DATE
-- would also change what the driver hands back (mysql2 is configured with
-- dateStrings: ['DATE'], so a DATE column returns a string where a DATETIME
-- returns a JS Date), and that is a separate decision from requiring the field.
ALTER TABLE daqqi_rounds
  MODIFY COLUMN start_date DATETIME NOT NULL;
