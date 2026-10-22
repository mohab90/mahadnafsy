-- Where a visitor came from, kept on the lead and on the order (21 Oct 2026).
--
-- leads already had utm_source/medium/campaign/content/term, but nothing on the site
-- filled them: the visit's ad parameters were dropped at the first page, so «مصدر العميل»
-- read «فيسبوك» for a campaign click and an organic post alike. The site keeps the first
-- visit's parameters (client/lib/attribution.ts) and every lead form, sign-up and order
-- sends them; the server writes them here (lib/visitAttribution.js). The click ids are
-- what an ad platform matches a sale back to its click with.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fbclid VARCHAR(255) NULL AFTER utm_term;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS gclid VARCHAR(255) NULL AFTER fbclid;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_source VARCHAR(200) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(200) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(200) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_content VARCHAR(200) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_term VARCHAR(200) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fbclid VARCHAR(255) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gclid VARCHAR(255) NULL;
