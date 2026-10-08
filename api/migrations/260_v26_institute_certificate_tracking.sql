-- «تاب في صفحه الشهادات اسمه شهادات المعهد ودا بيكون اتوماتك ومجاني لاي عميل
-- خلص فلوسه او 90 % من فلوسه … يمشي في خطوات اتشحنت او في الفرع … لو العميل عمل
-- تحميل للشهاده pdf من الموقع يظهر انه العميل عملها تحميل» (8 Oct 2026).
--
-- The institute certificate is the digital one the client already has on the site
-- (course_completions); these columns follow the printed copy to the client.
--
-- course_completions.delivery_status      READY · PRINTED · AT_BRANCH · SHIPPED · DELIVERED · RETURNED
-- course_completions.delivery_updated_at / delivery_updated_by   the last step and who took it
-- course_completions.downloaded_at / download_count               the client opened or printed it from the site
--
-- Rollback:
--   ALTER TABLE course_completions DROP COLUMN delivery_status, DROP COLUMN delivery_updated_at,
--     DROP COLUMN delivery_updated_by, DROP COLUMN downloaded_at, DROP COLUMN download_count;

ALTER TABLE course_completions
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS delivery_updated_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delivery_updated_by VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS downloaded_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS download_count INT NOT NULL DEFAULT 0;
