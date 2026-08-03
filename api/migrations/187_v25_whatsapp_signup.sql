-- 187: let a WhatsApp code exist before the account does.
--
-- Registration and sign-in are now one flow: type your number, get a code,
-- you're in — whether you have an account or not. That is better for the
-- customer (no register-vs-login decision) and better for security, because the
-- two paths become indistinguishable from outside. Today an unknown number
-- silently gets no code at all, which both makes signup impossible and leaks
-- which numbers are registered to anyone watching the response.
--
-- The code therefore has to be storable before a users row exists, so user_id
-- becomes nullable. Existing rows are unaffected.

ALTER TABLE IF EXISTS otp_codes
  MODIFY COLUMN user_id VARCHAR(36) NULL DEFAULT NULL;

-- Per-number throttle for the new signup path.
--
-- The IP limiter alone is not enough once codes go to numbers with no account:
-- rotating IPs would let someone use the institute's own WhatsApp to send
-- unsolicited messages to any number they like. This index makes "how many
-- codes has this number been sent lately" a cheap question, which is what the
-- throttle in lib/whatsappOtp.js asks before issuing one.
ALTER TABLE IF EXISTS otp_codes
  ADD INDEX IF NOT EXISTS idx_otp_phone_recent (tenant_id, phone, created_at);
