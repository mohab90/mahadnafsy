-- «زر تاجيل موعد يكون زر يظهر فيه هل المحاضرة اشتغلت في موعدها او لاء ،
-- اشتغلت تمام — مشتغلش نعمل تأجيل». A week was either postponed or said
-- nothing; the desk now confirms the weeks the lecture ran, the same way
-- postponed_weeks_json records the weeks it did not.
ALTER TABLE daqqi_rounds
  ADD COLUMN IF NOT EXISTS held_weeks_json text DEFAULT NULL;
