-- «نخلي كل كورس باكتر من سعر … سعر الدقي لوحدة وسعر الاونلاين للمصرين وسعر
-- الاونلاين لغير المصرين في مصر وسعر التجمع لوحدة … كمان يكون في سعر الخصم».
--
-- catalog_prices        one row per course or track (مسار) per price tier: the
--                       price at that branch, in that branch's currency, and an
--                       optional discount price the desk may offer. The tiers
--                       are in lib/priceTiers.js. The three online tiers keep
--                       courses/bundles.price_egp / price_sar / price_usd in
--                       step — the public site reads those — and a tier with no
--                       row of its own falls back to them.
-- booking_bonuses_json  «مكافأة حجز الكورس» for the rep who sold it, the desk
--                       (reception / collection / customer service) that served
--                       it, and the lecturer: {"sales":{"type":"fixed"|"percent",
--                       "value":n}, "service":{…}, "instructor":{…}}, paid once
--                       per client per course (lib/bookingBonuses.js).
--
-- Rollback:
--   DROP TABLE catalog_prices;
--   ALTER TABLE courses DROP COLUMN booking_bonuses_json;
--   ALTER TABLE bundles DROP COLUMN booking_bonuses_json;

CREATE TABLE IF NOT EXISTS catalog_prices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  item_type ENUM('course','bundle') NOT NULL,
  item_id VARCHAR(36) NOT NULL,
  tier VARCHAR(32) NOT NULL,
  price DECIMAL(12,2) DEFAULT NULL,
  discount_price DECIMAL(12,2) DEFAULT NULL,
  updated_by VARCHAR(36) DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalog_prices_item_tier (tenant_id, item_type, item_id, tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE courses ADD COLUMN IF NOT EXISTS booking_bonuses_json LONGTEXT DEFAULT NULL;
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS booking_bonuses_json LONGTEXT DEFAULT NULL;

-- The online prices as they stand today become the online tiers, so nothing a
-- customer pays changes the day this ships.
INSERT IGNORE INTO catalog_prices (tenant_id, item_type, item_id, tier, price)
  SELECT tenant_id, 'course', id, 'ONLINE_EGYPT', price_egp FROM courses WHERE price_egp > 0;
INSERT IGNORE INTO catalog_prices (tenant_id, item_type, item_id, tier, price)
  SELECT tenant_id, 'course', id, 'ONLINE_SAUDI', price_sar FROM courses WHERE price_sar > 0;
INSERT IGNORE INTO catalog_prices (tenant_id, item_type, item_id, tier, price)
  SELECT tenant_id, 'course', id, 'ONLINE_ABROAD', price_usd FROM courses WHERE price_usd > 0;
INSERT IGNORE INTO catalog_prices (tenant_id, item_type, item_id, tier, price)
  SELECT tenant_id, 'bundle', id, 'ONLINE_EGYPT', price_egp FROM bundles WHERE price_egp > 0;
INSERT IGNORE INTO catalog_prices (tenant_id, item_type, item_id, tier, price)
  SELECT tenant_id, 'bundle', id, 'ONLINE_SAUDI', price_sar FROM bundles WHERE price_sar > 0;
INSERT IGNORE INTO catalog_prices (tenant_id, item_type, item_id, tier, price)
  SELECT tenant_id, 'bundle', id, 'ONLINE_ABROAD', price_usd FROM bundles WHERE price_usd > 0;
