-- The hours of an إذن.
--
-- «يقدر يطلب اجازه او اذن تاخير صباحي او مسائي». A morning permission
-- (LATE_PERMIT) is arriving late, an evening one (EARLY_LEAVE) is leaving
-- early, and both are part of one day — the request has to say which part, or
-- HR approves an hour nobody named. start_time–end_time is that window, Cairo
-- time; NULL for every other leave type, which is counted in days.
ALTER TABLE leaves
  ADD COLUMN IF NOT EXISTS start_time varchar(5) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS end_time varchar(5) DEFAULT NULL;
