-- How long a track (bundle) is open for the client who subscribes to it (2 Nov 2026: «صلاحية فتح الفيديوهات سنة لكل الكورسات والمسارات إلا
-- المعالج النفسي المحترف والعلاج النفسي المتكامل سنة ونص من تاريخ اشتراكهم»). A course is open for courses.access_months or a year
-- (lib/entitlements.js DEFAULT_ACCESS_MONTHS); a track can name a longer window, and the enrolments it creates get it. NULL = the course's own.
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS access_months INT NULL COMMENT 'Months of access a subscription to this track gets. NULL = each course''s own (default a year).';

-- The two tracks sold for a year and a half. By id, so it touches nothing where these ids do not exist (staging, a new tenant).
UPDATE bundles SET access_months = 18
 WHERE id IN ('b-1776608174758', 'b-1774353052042') AND (access_months IS NULL OR access_months = 0);
