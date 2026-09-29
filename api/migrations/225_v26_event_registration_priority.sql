-- «لازم يكون في سؤال هل درست في المعهد من قبل ويجاوب نعم او لا عشان الطلبه
-- بتوعنا بيكون ليهم الاولويه» and «لينك الفعاليه لازم اقدر ادخله سلج
-- بالانجليزي».
--
--   studied_before  what the person answered when registering (NULL for the
--                   registrations made before the question was asked)
--   previous_slug   the event's address before it was changed, so a link
--                   already shared keeps opening the event
ALTER TABLE community_event_registrations
  ADD COLUMN IF NOT EXISTS studied_before TINYINT(1) DEFAULT NULL;

ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS previous_slug varchar(160) DEFAULT NULL;
