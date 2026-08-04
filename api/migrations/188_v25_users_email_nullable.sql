-- 188: users.email can no longer be required — a WhatsApp-only signup has
-- none.
--
-- Migration 181 gave users a phone identity and 187 let an OTP code exist
-- before the account row does, but users.email stayed NOT NULL the whole
-- time. lib/whatsappOtp.js's account-creation INSERT already writes
-- `email = NULL` for a brand-new WhatsApp signup (it has since the feature
-- was built) — that statement has been failing outright on every real
-- database, since none of them ever had this column relaxed. Found before
-- it could actually break a live signup: the production WhatsApp channel
-- has been disconnected since deploy, so this path had never actually run
-- end to end against a real NOT NULL email column until this was checked.
--
-- uq_users_tenant_email is unaffected: MySQL/InnoDB unique indexes treat
-- NULL as distinct from every other NULL, so any number of phone-only
-- accounts can coexist with email=NULL under the same unique index.
ALTER TABLE IF EXISTS users
  MODIFY COLUMN email VARCHAR(255) NULL DEFAULT NULL;
