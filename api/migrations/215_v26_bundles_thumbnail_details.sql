-- The three columns every bundle save has been writing to a table that has none
-- of them.
--
-- POST /api/admin/bundles inserts thumbnail, details_content_json and
-- updated_at; mapBundle reads r.thumbnail and r.details_content_json back out;
-- /bundles and /bundles/:slug render both — the card image on Bundles.tsx and
-- the og:image on BundleDetails.tsx. Only the columns were missing, so the
-- INSERT failed on the first of them and saving any bundle answered 500. The
-- seven bundles in production predate the column list and were written by
-- something else.
--
-- courses carries the same three and is the shape copied here: thumbnail is a
-- URL of no fixed length, details_content_json is the page-builder blob, and
-- updated_at is set by the ON DUPLICATE KEY UPDATE branch on every save.

ALTER TABLE bundles
  ADD COLUMN IF NOT EXISTS thumbnail TEXT DEFAULT NULL
    COMMENT 'Card and og:image URL, as courses.thumbnail.',
  ADD COLUMN IF NOT EXISTS details_content_json LONGTEXT DEFAULT NULL
    COMMENT 'Page-builder content for the bundle detail page.',
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL
    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    COMMENT 'Touched by the ON DUPLICATE KEY UPDATE branch of a bundle save.';
