-- Training room for a Dokki round, plus the one-time cleanup of the start dates
-- that were written through the old toMysqlDt.
--
-- ROOM: daqqi_rounds had no room at all, so nothing recorded where a round
-- physically happens and nothing could tell that two rounds had been booked into
-- the same hall at the same time. The API refuses a clashing booking now; this
-- adds the column it checks.
--
-- Nullable on purpose: every existing round predates the field and none of them
-- can be given a room retroactively without guessing. A round with no room set
-- takes part in no clash — you cannot conflict over a hall nobody named.
ALTER TABLE daqqi_rounds
  ADD COLUMN IF NOT EXISTS room VARCHAR(60) NULL DEFAULT NULL;

-- Not UNIQUE: the clash rule is (room, day_of_week, time_slot) among rounds that
-- are still running, which no single unique index expresses — a finished round
-- must be free to have used the same hall. The index is here to make the check
-- the API runs before every save cheap.
ALTER TABLE daqqi_rounds
  ADD INDEX IF NOT EXISTS idx_daqqi_round_room_slot (tenant_id, room, day_of_week, time_slot, status);

-- DATES: rows saved through the old date handling hold values like
-- 'Wed Jun 17 2026 14:' — the 19-character truncation of a Date.toString().
-- MySQL stores those as NULL or 0000-00-00 in a datetime column, which is what
-- renders as "Invalid Date" on the schedule. They cannot be repaired (the
-- original value is gone), so they are cleared to NULL: an empty start date
-- reads as "not set" and can be corrected from the UI, where "Invalid Date"
-- looked like a broken page.
UPDATE daqqi_rounds
   SET start_date = NULL
 WHERE start_date IS NOT NULL
   AND (start_date = '0000-00-00 00:00:00' OR YEAR(start_date) < 2000);
