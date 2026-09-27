-- leads.assigned_at, written by the database whenever a lead gets a rep.
--
-- The per-rep intake cap (212) counts assigned_at inside the period, so a lead
-- only counts against «دي بتاخد 5 في اليوم» if the path that assigned it wrote
-- that column. Two did: the scheduled sheet sync and «توزيع تلقائي». The other
-- ten did not — the site's registration form, the chatbot, Facebook Lead Ads,
-- WhatsApp and Messenger inbound, the course-page form, the manual sheet import,
-- bulk assignment, smart routing and a rep chosen by hand — so every lead from
-- them was invisible to the cap, and a rep could be handed any number of them.
--
-- Here rather than in twelve INSERTs and UPDATEs, so the thirteenth path cannot
-- forget it. A path that sets the column itself (the sheet sync) keeps its own
-- value; a rewrite that leaves the rep unchanged leaves the time unchanged, so
-- editing a lead does not restart its clock.
--
-- Nothing is backfilled, for the reason 212 gives: there is no record of when
-- the older assignments happened.

CREATE OR REPLACE TRIGGER trg_leads_assigned_at_insert BEFORE INSERT ON leads FOR EACH ROW
  SET NEW.assigned_at = IF(COALESCE(NEW.assigned_sales_id, '') <> '' AND NEW.assigned_at IS NULL, NOW(), NEW.assigned_at);

CREATE OR REPLACE TRIGGER trg_leads_assigned_at_update BEFORE UPDATE ON leads FOR EACH ROW
  SET NEW.assigned_at = IF(COALESCE(NEW.assigned_sales_id, '') <> ''
      AND NOT (NEW.assigned_sales_id <=> OLD.assigned_sales_id)
      AND NEW.assigned_at <=> OLD.assigned_at,
    NOW(), NEW.assigned_at);
