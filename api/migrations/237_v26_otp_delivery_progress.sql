-- Sign-in and reset codes can now follow their message past 'accepted'.
--
-- The provider's delivery callbacks (lib/whatsappDelivery.js) only updated
-- message_outbox, and codes are sent directly, not through the outbox — so a
-- code stayed 'accepted' whether it reached the phone or bounced. A bounce
-- left a live, undelivered code holding the resend cooldown: the customer was
-- told a code was on its way and could not ask for another one.
--
-- Widening only: every existing value stays valid. Readers that meant "sent"
-- by 'accepted' now accept the three later states too (routes/auth.js).
-- Rollback: map sent/delivered/read back to 'accepted', then MODIFY back.

ALTER TABLE otp_codes
  MODIFY COLUMN delivery_status enum('pending','accepted','sent','delivered','read','failed') NOT NULL DEFAULT 'pending',
  ADD INDEX IF NOT EXISTS idx_otp_provider_message (provider_message_id(64));
