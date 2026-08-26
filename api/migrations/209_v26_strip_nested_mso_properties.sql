-- Migration 208 removed Word's own attributes — class="MsoNormal" and any
-- style="mso-…" — but left the mso- properties that sit *inside* an otherwise
-- ordinary style attribute:
--
--   style="font-size:12.0pt; mso-fareast-font-family:Calibri; mso-ansi-language:EN-US"
--
-- 208's pattern anchored on style attributes that begin with mso-, so a style
-- whose first property is real CSS kept every Word property after it. Seven
-- remained on the one affected course: mso-fareast-font-family,
-- mso-bidi-language, mso-ascii-font-family, mso-hansi-font-family,
-- mso-bidi-font-family, mso-ansi-language, mso-fareast-language.
--
-- Each is removed as a single property — name, value and its separator — so the
-- surrounding CSS is left exactly as it was. font-size:12.0pt stays; the Word
-- residue beside it goes.
UPDATE courses
   SET short_description = REGEXP_REPLACE(short_description, '\\s*mso-[a-zA-Z-]+\\s*:[^;"]*;?', '')
 WHERE short_description LIKE '%mso-%';

UPDATE courses
   SET description = REGEXP_REPLACE(description, '\\s*mso-[a-zA-Z-]+\\s*:[^;"]*;?', '')
 WHERE description LIKE '%mso-%';

-- Removing the last property in a style can leave a trailing separator behind,
-- and an emptied style attribute is worth removing rather than leaving as
-- style="".
UPDATE courses
   SET short_description = REGEXP_REPLACE(short_description, ';\\s*"', '"')
 WHERE short_description LIKE '%; "%' OR short_description LIKE '%;"%';

UPDATE courses
   SET description = REGEXP_REPLACE(description, ';\\s*"', '"')
 WHERE description LIKE '%; "%' OR description LIKE '%;"%';

UPDATE courses
   SET short_description = REGEXP_REPLACE(short_description, '\\s*style="\\s*"', '')
 WHERE short_description LIKE '%style=""%' OR short_description LIKE '%style=" "%';

UPDATE courses
   SET description = REGEXP_REPLACE(description, '\\s*style="\\s*"', '')
 WHERE description LIKE '%style=""%' OR description LIKE '%style=" "%';

-- Guarded throughout: a re-run matches nothing on clean data.
