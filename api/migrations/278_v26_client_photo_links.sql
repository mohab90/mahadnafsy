-- The links of the pictures asked for with a certificate or a carnet.
--
-- «رفع الصور مربوط بجوجل درايف … ويبقى على السيستم لينك الصورة فقط عشان لما بنعمل
-- شهادة البورد لازم بنطلب صورة والكارنيه لازم بنطلب صورة واي توثيق لازم صورة
-- الهوية» (13 Oct 2026). The picture itself lives in Google Drive
-- (lib/googleDrive.js); the client's file keeps its link: one personal photo
-- (the board certificate, the carnet) and one identity photo (documentation),
-- asked for once and reused by every later request. Exports end with both links.
--
-- Rollback:
--   ALTER TABLE subscribers DROP COLUMN personal_photo_url, DROP COLUMN id_photo_url;

ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS personal_photo_url VARCHAR(500) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS id_photo_url VARCHAR(500) NULL DEFAULT NULL;
