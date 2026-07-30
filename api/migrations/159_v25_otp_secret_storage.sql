-- OTP values are bearer credentials. Store only an HMAC digest so a database
-- read cannot expose still-valid password reset codes.

ALTER TABLE otp_codes
  MODIFY COLUMN code CHAR(64) NOT NULL;

-- Codes issued before this migration used a different representation and must
-- not remain usable after the application switches to HMAC comparison.
UPDATE otp_codes
   SET used=1
 WHERE used=0;
