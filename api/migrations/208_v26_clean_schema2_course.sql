-- One course carries a NULL slug and Word's markup in its description.
--
-- Reported by the v25 audit and verified: c-1774355346438, "العلاج بالمخططات
-- المعرفية Schema 2", is the only course on production with either problem —
-- 1 of 24 with no slug, 1 of 24 with MsoNormal in its text.
--
-- The slug is not cosmetic. Every other course resolves by a latinised slug
-- (act, behavior-modification, art-of-speaking-and-influencing), so this one
-- has no readable URL and no stable public identifier; anything linking to it
-- has to use the raw id.
--
-- 'schema-therapy-2' follows the same latinised pattern as its siblings rather
-- than transliterating the Arabic, which is what the English-titled courses do.
UPDATE courses
   SET slug = 'schema-therapy-2'
 WHERE id = 'c-1774355346438'
   AND (slug IS NULL OR slug = '');

-- Word pastes class="MsoNormal" and style="mso-…" into everything copied out of
-- it. The attributes are inert in a browser but they travel into every export,
-- feed and API response, and they are how you can tell the text was pasted
-- rather than written.
--
-- Attributes only — the tags and the text stay exactly as they are. Rewriting
-- the markup itself would be an editorial change to published course copy, and
-- that is the desk's to make, not a migration's.
UPDATE courses
   SET short_description = REGEXP_REPLACE(short_description, ' class="MsoNormal"', '')
 WHERE tenant_id IS NOT NULL
   AND short_description LIKE '%MsoNormal%';

UPDATE courses
   SET short_description = REGEXP_REPLACE(short_description, ' style="mso-[^"]*"', '')
 WHERE tenant_id IS NOT NULL
   AND short_description LIKE '%mso-%';

UPDATE courses
   SET description = REGEXP_REPLACE(description, ' class="MsoNormal"', '')
 WHERE tenant_id IS NOT NULL
   AND description LIKE '%MsoNormal%';

UPDATE courses
   SET description = REGEXP_REPLACE(description, ' style="mso-[^"]*"', '')
 WHERE tenant_id IS NOT NULL
   AND description LIKE '%mso-%';

-- Every statement is guarded, so a re-run matches nothing and changes nothing.
