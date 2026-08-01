-- 181: WhatsApp number as a first-class login identity.
--
-- Authentication is email-keyed all the way down to the schema: users has only
-- an email (UNIQUE per tenant) and otp_codes requires an email with a type enum
-- that has no 'login' member. Signing in with a WhatsApp number and an OTP
-- therefore needs identity columns before any route can exist.
--
-- Deliberately ADDITIVE. Email + password sign-in keeps working untouched; the
-- WhatsApp path is added alongside it. An auth change that cannot be exercised
-- against a live database before release must not be able to lock anyone out,
-- so the new path is opt-in rather than a replacement.

-- ── users: the phone identity ────────────────────────────────────────────────
ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS phone VARCHAR(32) NULL DEFAULT NULL
    COMMENT 'Normalised WhatsApp number (digits only, no leading zeros)',
  ADD COLUMN IF NOT EXISTS phone_verified_at DATETIME NULL DEFAULT NULL;

-- UNIQUE so a number can only ever identify one account per tenant. NULLs are
-- exempt from UNIQUE in MySQL, so accounts without a phone are unaffected.
ALTER TABLE IF EXISTS users
  ADD UNIQUE INDEX IF NOT EXISTS uq_users_tenant_phone (tenant_id, phone);

-- ── otp_codes: allow a phone-addressed login code ────────────────────────────
-- email becomes nullable because a WhatsApp OTP has no email to address, and
-- 'login' joins the type enum. Existing rows and the password_reset/2fa flows
-- are untouched.
-- `attempts` lets a code be retired after too many wrong guesses; without it a
-- 6-digit code could be brute-forced within its lifetime.
ALTER TABLE IF EXISTS otp_codes
  ADD COLUMN IF NOT EXISTS phone VARCHAR(32) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  MODIFY COLUMN email VARCHAR(255) NULL DEFAULT NULL,
  MODIFY COLUMN type ENUM('password_reset','2fa','login') NOT NULL DEFAULT 'password_reset';

ALTER TABLE IF EXISTS otp_codes
  ADD INDEX IF NOT EXISTS idx_otp_phone_type (tenant_id, phone, type, used, expires_at);

-- ── Backfill from records that already hold a verified number ────────────────
-- subscribers is the authority for a paying client's contact number; leads is
-- the fallback for someone who registered but hasn't paid. Only fills accounts
-- that have no phone yet, and only when the digits look like a real number.
-- Each backfill skips a number already claimed by another account. Without this
-- guard a single shared number (a family using one phone, or a duplicate left by
-- an old import) would violate uq_users_tenant_phone and abort the whole
-- migration. A skipped account simply keeps signing in by email until someone
-- assigns it a number, which is the safe failure direction.
UPDATE users u
  JOIN subscribers s
    ON s.tenant_id = u.tenant_id
   AND LOWER(TRIM(s.email)) = LOWER(TRIM(u.email))
   SET u.phone = REGEXP_REPLACE(s.phone, '[^0-9]', '')
 WHERE u.phone IS NULL
   AND s.phone IS NOT NULL
   AND LENGTH(REGEXP_REPLACE(s.phone, '[^0-9]', '')) BETWEEN 9 AND 15
   AND NOT EXISTS (
     SELECT 1 FROM (SELECT tenant_id, phone FROM users) AS taken
      WHERE taken.tenant_id = u.tenant_id
        AND taken.phone = REGEXP_REPLACE(s.phone, '[^0-9]', '')
   );

UPDATE users u
  JOIN leads l
    ON l.tenant_id = u.tenant_id
   AND LOWER(TRIM(l.email)) = LOWER(TRIM(u.email))
   SET u.phone = REGEXP_REPLACE(l.phone, '[^0-9]', '')
 WHERE u.phone IS NULL
   AND l.phone IS NOT NULL
   AND LENGTH(REGEXP_REPLACE(l.phone, '[^0-9]', '')) BETWEEN 9 AND 15
   AND NOT EXISTS (
     SELECT 1 FROM (SELECT tenant_id, phone FROM users) AS taken
      WHERE taken.tenant_id = u.tenant_id
        AND taken.phone = REGEXP_REPLACE(l.phone, '[^0-9]', '')
   );
