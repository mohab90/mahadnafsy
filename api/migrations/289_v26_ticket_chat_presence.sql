-- «انا بجرب وانا فاتح الرساله ومع ذلك عمل كدا الشات مقفول — العميل مش فاتحه دلوقتي» (16 Oct 2026).
-- Whether the client has a ticket's conversation open used to be read from a general «signed in
-- somewhere on the dashboard» beat kept in the server's memory, matched to the ticket through the
-- client's e-mail — so a client who was reading the conversation could still show as away
-- (a beat a minute, none from a background tab, an account the e-mail did not find).
-- The conversation itself now reports in: one row per ticket, written while it is open on the
-- client's screen, and the staff side reads it.
CREATE TABLE IF NOT EXISTS ticket_chat_presence (
  tenant_id VARCHAR(64) NOT NULL,
  ticket_id VARCHAR(36) NOT NULL,
  seen_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
