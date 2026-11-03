-- The price one client agreed for one course or track, and the money they paid for it before the system (3 Nov 2026: «انقل الأسعار المتفق عليها ومدفوع قبل السيستم من
-- crm_json لجدول»). They lived inside subscribers.crm_json (customPrices / priorPaid, keyed by course id or 'bundle:<id>') and were read from about twenty places —
-- some of them as JSON paths inside SQL — and overwritten by any whole-client save from a screen that held an older copy. One row per client and item now;
-- lib/itemMoney.js is the only code that reads or writes it.
CREATE TABLE IF NOT EXISTS client_item_money (
  tenant_id VARCHAR(64) NOT NULL,
  subscriber_id VARCHAR(36) NOT NULL,
  item_key VARCHAR(190) NOT NULL COMMENT 'A course id, or bundle:<id> for a track.',
  agreed_price DECIMAL(14,2) NULL COMMENT 'The price this client agreed for the item (was crm_json.customPrices).',
  prior_paid DECIMAL(14,2) NULL COMMENT 'Paid for the item before the system recorded payments (was crm_json.priorPaid); not revenue.',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, subscriber_id, item_key),
  KEY idx_item_money_item (tenant_id, item_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Copy what the clients already have. A value that is not a number is skipped (it never counted: every reader took Number(x) || 0).
INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, agreed_price)
SELECT s.tenant_id, s.id, k.item_key,
       CAST(JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, CONCAT('$.customPrices."', k.item_key, '"'))) AS DECIMAL(14,2))
  FROM subscribers s,
       JSON_TABLE(JSON_KEYS(s.crm_json, '$.customPrices'), '$[*]' COLUMNS (item_key VARCHAR(190) PATH '$')) k
 WHERE JSON_VALID(s.crm_json) AND JSON_TYPE(JSON_EXTRACT(s.crm_json, '$.customPrices')) = 'OBJECT'
   AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, CONCAT('$.customPrices."', k.item_key, '"'))) REGEXP '^-?[0-9]+(\\.[0-9]+)?$'
ON DUPLICATE KEY UPDATE agreed_price = VALUES(agreed_price);

INSERT INTO client_item_money (tenant_id, subscriber_id, item_key, prior_paid)
SELECT s.tenant_id, s.id, k.item_key,
       CAST(JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, CONCAT('$.priorPaid."', k.item_key, '"'))) AS DECIMAL(14,2))
  FROM subscribers s,
       JSON_TABLE(JSON_KEYS(s.crm_json, '$.priorPaid'), '$[*]' COLUMNS (item_key VARCHAR(190) PATH '$')) k
 WHERE JSON_VALID(s.crm_json) AND JSON_TYPE(JSON_EXTRACT(s.crm_json, '$.priorPaid')) = 'OBJECT'
   AND JSON_UNQUOTE(JSON_EXTRACT(s.crm_json, CONCAT('$.priorPaid."', k.item_key, '"'))) REGEXP '^-?[0-9]+(\\.[0-9]+)?$'
ON DUPLICATE KEY UPDATE prior_paid = VALUES(prior_paid);
