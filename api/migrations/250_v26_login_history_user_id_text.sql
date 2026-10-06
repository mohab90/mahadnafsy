-- login_history.user_id, as text.
--
-- Account ids are text («b6d80d2e-…», «user-owner-admin», «s-…»), and the
-- column was an integer, so the sign-in audit refused every row it was handed:
-- «Incorrect integer value» or «Data truncated for column 'user_id'» about 300
-- times between 29 Sep and 6 Oct. No sign-in has been recorded since the
-- column was created.
--
-- Rollback: ALTER TABLE login_history MODIFY COLUMN user_id INT NULL;
--   (only on an empty table — a text id does not fit back)

ALTER TABLE login_history MODIFY COLUMN user_id VARCHAR(100) NULL;
