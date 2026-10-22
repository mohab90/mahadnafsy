-- Lead numbers in the one form clients are kept in (20 Oct 2026 review, L8).
--
-- subscribers.phone is the identity (lib/phoneNumber.js toIdentity): the ten digits of an
-- Egyptian mobile, no trunk 0, no country code (migration 283). Leads kept the number as typed —
-- «+20 101 234 5678», «0101-234-5678» — so an existing client typed that way was filed as a new
-- lead, and «تحويل» then answered «الرقم مستخدم» for the client's own number. The code now stores
-- the identity on leads too (routes/admin/leads/write.js, lib/publicLead.js,
-- lib/facebookLeadEvents.js); this brings the leads already stored into the same form.
--
-- Only numbers written with digits, spaces, dashes, dots, brackets and a «+» are touched (anything
-- with a letter or Arabic digits is left as it is). A number whose identity another lead already
-- holds, or that two leads would both turn into, is left alone: that pair is a real duplicate, for
-- the duplicates screen to merge — never merged here. Every number changed is kept as it was
-- typed in backfill_305_lead_phones, for the rollback. Running it again changes nothing.
--
-- Rollback:
--   UPDATE leads l JOIN backfill_305_lead_phones b ON b.lead_id = l.id AND b.tenant_id = l.tenant_id
--      SET l.phone = b.old_phone WHERE l.phone = b.new_phone;
--   DROP TABLE backfill_305_lead_phones;

CREATE TABLE IF NOT EXISTS backfill_305_lead_phones (
  tenant_id VARCHAR(64) NOT NULL,
  lead_id VARCHAR(100) NOT NULL,
  old_phone VARCHAR(64) NOT NULL,
  new_phone VARCHAR(32) NOT NULL,
  applied TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, lead_id),
  KEY idx_backfill_305_target (tenant_id, new_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The candidates and their identity: digits only, then «00», then the country code 20, then any
-- trunk zero off the front — the steps toIdentity takes, in its order.
INSERT IGNORE INTO backfill_305_lead_phones (tenant_id, lead_id, old_phone, new_phone)
SELECT x.tenant_id, x.id, x.phone,
       TRIM(LEADING '0' FROM IF(x.d2 LIKE '20%', SUBSTRING(x.d2, 3), x.d2))
  FROM (
    SELECT l.tenant_id, l.id, l.phone,
           IF(REGEXP_REPLACE(l.phone, '[^0-9]', '') LIKE '00%',
              SUBSTRING(REGEXP_REPLACE(l.phone, '[^0-9]', ''), 3),
              REGEXP_REPLACE(l.phone, '[^0-9]', '')) AS d2
      FROM leads l
     WHERE l.phone IS NOT NULL AND l.phone <> ''
       AND l.phone REGEXP '^[-+0-9 ().]+$'
  ) x;

-- Already in the one form, or nothing a number could be: not candidates.
DELETE FROM backfill_305_lead_phones
 WHERE applied = 0 AND (new_phone = old_phone OR new_phone NOT REGEXP '^[0-9]{9,15}$');

-- Another lead already holds the identity: a duplicate pair, left for the duplicates screen.
DELETE b FROM backfill_305_lead_phones b
  JOIN leads o ON o.tenant_id = b.tenant_id AND o.phone = b.new_phone AND o.id <> b.lead_id
 WHERE b.applied = 0;

-- Two leads that would both become the same number: the same, left as they are.
CREATE TABLE IF NOT EXISTS backfill_305_lead_phone_clashes (
  tenant_id VARCHAR(64) NOT NULL,
  new_phone VARCHAR(32) NOT NULL,
  PRIMARY KEY (tenant_id, new_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO backfill_305_lead_phone_clashes (tenant_id, new_phone)
SELECT tenant_id, new_phone FROM backfill_305_lead_phones WHERE applied = 0
 GROUP BY tenant_id, new_phone HAVING COUNT(*) > 1;
DELETE b FROM backfill_305_lead_phones b
  JOIN backfill_305_lead_phone_clashes c ON c.tenant_id = b.tenant_id AND c.new_phone = b.new_phone
 WHERE b.applied = 0;
DROP TABLE IF EXISTS backfill_305_lead_phone_clashes;

UPDATE leads l
  JOIN backfill_305_lead_phones b ON b.lead_id = l.id AND b.tenant_id = l.tenant_id AND b.applied = 0
   SET l.phone = b.new_phone, l.updated_at = l.updated_at
 WHERE l.phone = b.old_phone;

UPDATE backfill_305_lead_phones SET applied = 1 WHERE applied = 0;
