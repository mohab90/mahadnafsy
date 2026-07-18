-- Moves the legacy startup branch-taxonomy repair into an idempotent migration.
-- The content value intentionally stores institute.branches as a JSON string
-- because the application reads this key with JSON.parse(content['institute.branches']).

UPDATE site_config
SET `value` = JSON_SET(
  `value`,
  '$."institute.branches"',
  '[{"id":"DAQQI","label":"الدقي"},{"id":"TAGAMOA","label":"التجمع"},{"id":"ONLINE_EGYPT","label":"أونلاين مصر"},{"id":"ONLINE_SAUDI","label":"أونلاين السعودية"},{"id":"ONLINE_ABROAD","label":"أونلاين الخارج"},{"id":"OTHER","label":"أخرى"}]'
)
WHERE `key` = 'content'
  AND JSON_SEARCH(`value`, 'one', 'ONLINE_LOCAL_NEW', NULL, '$."institute.branches"') IS NOT NULL;
