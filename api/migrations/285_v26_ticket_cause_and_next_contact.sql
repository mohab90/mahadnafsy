-- A problem's real cause, and when the client is to be contacted again.
--
-- «زر التواصل … كان ايه سبب المشكلة الحقيقي عمل ايه؟ يختار من قايمة: المشكلة انتهت ولا لسه فى
-- تواصل تانى ولا هيرجع للادارة ولا هيسترد» (15 Oct 2026). The cause is kept on the ticket for the
-- reports; the next contact date makes the ticket show in its owner's follow-ups (lib/followUpDigest.js).
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS root_cause TEXT NULL AFTER resolution_note;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS next_contact_at DATE NULL AFTER root_cause;
