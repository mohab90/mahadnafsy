-- Subscriber identity is unique per tenant, not per installation.
--
-- `subscribers` carried UNIQUE(phone) and UNIQUE(email(191)) with no tenant in
-- either key, while `users` and `leads` scope the same identity per tenant
-- (uq_users_tenant_phone, uq_leads_tenant_phone). One table therefore enforced a
-- rule the product does not have: that a phone number or an email address may
-- exist once across every tenant on the box.
--
-- What that costs, concretely: the second tenant to onboard a customer who is
-- already someone else's customer cannot create the subscriber at all. The
-- INSERT fails with a duplicate key on a row they are not permitted to see, so
-- the error cannot even be explained to them — and the natural "fix" is for
-- staff to mangle the number until it is accepted, which then breaks every
-- lookup that depends on it (see lib/leadMatching.js).
--
-- Safe by construction: this only ever WIDENS the constraint. Any row set that
-- satisfies UNIQUE(phone) also satisfies UNIQUE(tenant_id, phone) — the new key
-- is a superset of the old one, so no existing data can violate it and the
-- migration cannot fail on live rows. Nothing is deduplicated or deleted here.
--
-- Direction of risk if it is ever reverted: narrowing back would fail on any
-- number two tenants have since shared, which is the correct failure.

-- ── phone ────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS subscribers
  ADD UNIQUE INDEX IF NOT EXISTS uq_subs_tenant_phone (tenant_id, phone);

-- Dropped only after the replacement exists, so the column is never briefly
-- unconstrained. Standalone DROP INDEX form to match 034_drop_redundant_indexes.
DROP INDEX IF EXISTS uq_subs_phone ON subscribers;

-- ── email ────────────────────────────────────────────────────────────────────
-- Prefix length matches the index being replaced: utf8mb4 puts a 191-character
-- ceiling on an indexed VARCHAR under the 767-byte limit.
ALTER TABLE IF EXISTS subscribers
  ADD UNIQUE INDEX IF NOT EXISTS uq_subs_tenant_email (tenant_id, email(191));

DROP INDEX IF EXISTS uq_subs_email ON subscribers;

-- `idx_subs_phone (phone(20))` is deliberately left in place: it is a plain
-- lookup index, not a constraint, and the identity matching in
-- lib/leadMatching.js still reads that column directly.
