-- login_history.user_id held an INT, and users.id is a UUID string. Every
-- successful sign-in wrote the user's id into it and was refused — "Incorrect
-- integer value" or "Data truncated for column 'user_id'", 94 times on 26 and
-- 27 September alone — so «سجل تسجيل الدخول» recorded failed attempts, which
-- carry no id, and no successful sign-in since the ids became UUIDs.
--
-- Widening to text keeps every row already there: an integer converts to its
-- digits.

ALTER TABLE login_history
  MODIFY COLUMN user_id VARCHAR(100) NULL DEFAULT NULL;
