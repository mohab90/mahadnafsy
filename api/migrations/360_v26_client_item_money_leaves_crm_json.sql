-- The two maps leave subscribers.crm_json now that client_item_money holds them (359 copied them; the release takes a database backup first). Only a client whose every
-- number is already in the table loses its copy, so a value the copy skipped (not a number) is not dropped silently with it.
UPDATE subscribers s
   SET s.crm_json = JSON_REMOVE(s.crm_json, '$.customPrices', '$.priorPaid')
 WHERE JSON_VALID(s.crm_json) AND JSON_CONTAINS_PATH(s.crm_json, 'one', '$.customPrices', '$.priorPaid')
   AND NOT EXISTS (
     SELECT 1 FROM JSON_TABLE(JSON_KEYS(s.crm_json, '$.customPrices'), '$[*]' COLUMNS (item_key VARCHAR(190) PATH '$')) k
      WHERE JSON_TYPE(JSON_EXTRACT(s.crm_json, '$.customPrices')) = 'OBJECT'
        AND NOT EXISTS (SELECT 1 FROM client_item_money m WHERE m.tenant_id = s.tenant_id AND m.subscriber_id = s.id AND m.item_key = k.item_key AND m.agreed_price IS NOT NULL))
   AND NOT EXISTS (
     SELECT 1 FROM JSON_TABLE(JSON_KEYS(s.crm_json, '$.priorPaid'), '$[*]' COLUMNS (item_key VARCHAR(190) PATH '$')) k
      WHERE JSON_TYPE(JSON_EXTRACT(s.crm_json, '$.priorPaid')) = 'OBJECT'
        AND NOT EXISTS (SELECT 1 FROM client_item_money m WHERE m.tenant_id = s.tenant_id AND m.subscriber_id = s.id AND m.item_key = k.item_key AND m.prior_paid IS NOT NULL));
