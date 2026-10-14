-- The authenticator secret is sealed at rest now, so it no longer fits.
--
-- users.totp_secret and staff.totp_secret held the raw base32 secret: a copy of
-- either table was enough to generate every employee's sign-in codes (audit
-- finding, 11 Oct 2026). lib/twoFactor.js seals it with lib/secretBox.js, and
-- the sealed form — "v1:<iv>:<tag>:<ciphertext>" — is about 90 characters, past
-- the 64 these columns were cut to. Widening only: every plain value written
-- before keeps working and is sealed the next time its owner signs in.
--
-- Rollback (only once no sealed value remains, or they are truncated):
--   ALTER TABLE users MODIFY COLUMN totp_secret VARCHAR(64) NULL DEFAULT NULL;
--   ALTER TABLE staff MODIFY COLUMN totp_secret VARCHAR(64) NULL DEFAULT NULL;

ALTER TABLE users
  MODIFY COLUMN totp_secret VARCHAR(255) NULL DEFAULT NULL;

ALTER TABLE staff
  MODIFY COLUMN totp_secret VARCHAR(255) NULL DEFAULT NULL;
