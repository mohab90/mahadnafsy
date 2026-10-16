-- Two people, one number — on purpose, and linked.
--
-- «العميل بيجيب صاحبه ومش بيوصلنا بصاحبه وعاوزنا نتعامل معاه هو، فبيبقى نفس رقم التليفون لحسابين،
-- واحنا مانعين نكرر رقم التليفون» (15 Oct 2026). A number still belongs to one client; the exception is a
-- second person who really uses the same number (a friend, a relative), opened by a member of staff
-- with a stated reason and linked to the first (phone_shared_with). The second account takes the next
-- slot, so the unique key is now (tenant, phone, slot): every account made the ordinary way is slot 0 and
-- behaves exactly as before — a second slot-0 account with the same number is still refused.
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS phone_slot TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER phone2;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS phone_shared_with VARCHAR(36) NULL AFTER phone_slot;
CREATE UNIQUE INDEX IF NOT EXISTS uq_subs_tenant_phone_slot ON subscribers (tenant_id, phone, phone_slot);
DROP INDEX IF EXISTS uq_subs_tenant_phone ON subscribers;
