-- Migration 208 removed Word's own attributes — class="MsoNormal" and any
-- style="mso-…" — but left the mso- properties that sit *inside* an otherwise
-- ordinary style attribute:
--
--   style="font-size:12.0pt; mso-fareast-font-family:Calibri; mso-ansi-language:EN-US"
--
-- 208 anchored on style attributes beginning with mso-, so a style whose first
-- property is genuine CSS kept every Word property after it. Seven survived on
-- the one affected course: mso-fareast-font-family, mso-bidi-language,
-- mso-ascii-font-family, mso-hansi-font-family, mso-bidi-font-family,
-- mso-ansi-language, mso-fareast-language.
--
-- \x{3B} is a semicolon, written that way on purpose. The migration runner
-- splits a file into statements on a literal ';', so a regex containing one is
-- cut in half — which is exactly how the first version of this migration failed,
-- and a failed migration stops the runner for everything after it.
--
-- Verified against MariaDB before shipping:
--   style="font-size:12.0pt; mso-fareast-font-family:Calibri; mso-ansi-language:EN-US"
-- becomes
--   style="font-size:12.0pt;"
-- Each Word property goes as a whole — name, value, separator — and the real CSS
-- beside it is untouched.
UPDATE courses
   SET short_description = REGEXP_REPLACE(short_description, '\\s*mso-[a-zA-Z-]+\\s*:[^\\x{3B}"]*\\x{3B}?', '')
 WHERE short_description LIKE '%mso-%';

UPDATE courses
   SET description = REGEXP_REPLACE(description, '\\s*mso-[a-zA-Z-]+\\s*:[^\\x{3B}"]*\\x{3B}?', '')
 WHERE description LIKE '%mso-%';

-- An emptied style attribute is worth removing rather than leaving as style="".
UPDATE courses
   SET short_description = REGEXP_REPLACE(short_description, '\\s*style="\\s*"', '')
 WHERE short_description LIKE '%style=""%' OR short_description LIKE '%style=" "%';

UPDATE courses
   SET description = REGEXP_REPLACE(description, '\\s*style="\\s*"', '')
 WHERE description LIKE '%style=""%' OR description LIKE '%style=" "%';

-- Guarded throughout: a re-run matches nothing on clean data.
