-- 035_leads_email_nullable.sql
-- leads.email was NOT NULL with no default, but the public/chatbot intake
-- (POST /api/leads-public) legitimately captures phone-only leads and its INSERT
-- omitted email — so every such submission 500'd and the lead was lost (confirmed
-- 2026-07-12 against a schema copy of prod). Phone is the required identifier for a
-- lead; email is optional. Make it nullable so intake succeeds. Idempotent.
ALTER TABLE leads MODIFY COLUMN email VARCHAR(255) NULL DEFAULT NULL;
