-- leads.assigned_sales_name and assigned_cs_name, written by the database from
-- the staff row whenever a lead has someone on it.
--
-- The name column was whatever the path that assigned the lead happened to
-- send. On 6 Oct 2026 about 8,000 leads carried a rep's old short name
-- («sama», «donia», «shimaa») while assigned_sales_id named someone else
-- entirely — 3,224 «donia» rows belonged to Donia Wael, 283 to Rodina, and so
-- on — and screens that print the column instead of joining staff showed the
-- wrong person. Here rather than in every INSERT and UPDATE, as 216 does for
-- assigned_at; the two triggers below replace 216's and keep what they did.
--
-- Rollback: re-run 216 (it restores the assigned_at-only triggers).

CREATE OR REPLACE TRIGGER trg_leads_assigned_at_insert BEFORE INSERT ON leads FOR EACH ROW
  SET NEW.assigned_at = IF(COALESCE(NEW.assigned_sales_id, '') <> '' AND NEW.assigned_at IS NULL, NOW(), NEW.assigned_at),
      NEW.assigned_sales_name = IF(COALESCE(NEW.assigned_sales_id, '') = '', NEW.assigned_sales_name,
        COALESCE((SELECT s.name FROM staff s WHERE s.id = NEW.assigned_sales_id LIMIT 1), NEW.assigned_sales_name)),
      NEW.assigned_cs_name = IF(COALESCE(NEW.assigned_cs_id, '') = '', NEW.assigned_cs_name,
        COALESCE((SELECT s.name FROM staff s WHERE s.id = NEW.assigned_cs_id LIMIT 1), NEW.assigned_cs_name));

CREATE OR REPLACE TRIGGER trg_leads_assigned_at_update BEFORE UPDATE ON leads FOR EACH ROW
  SET NEW.assigned_at = IF(COALESCE(NEW.assigned_sales_id, '') <> ''
      AND NOT (NEW.assigned_sales_id <=> OLD.assigned_sales_id)
      AND NEW.assigned_at <=> OLD.assigned_at,
    NOW(), NEW.assigned_at),
      NEW.assigned_sales_name = IF(COALESCE(NEW.assigned_sales_id, '') = '', NEW.assigned_sales_name,
        COALESCE((SELECT s.name FROM staff s WHERE s.id = NEW.assigned_sales_id LIMIT 1), NEW.assigned_sales_name)),
      NEW.assigned_cs_name = IF(COALESCE(NEW.assigned_cs_id, '') = '', NEW.assigned_cs_name,
        COALESCE((SELECT s.name FROM staff s WHERE s.id = NEW.assigned_cs_id LIMIT 1), NEW.assigned_cs_name));

-- The names already out of step. updated_at is kept: nothing about the lead
-- changed, and lists sorted by it should not reshuffle.
UPDATE leads l JOIN staff s ON s.id = l.assigned_sales_id
   SET l.assigned_sales_name = s.name, l.updated_at = l.updated_at
 WHERE NOT (l.assigned_sales_name <=> s.name);

UPDATE leads l JOIN staff s ON s.id = l.assigned_cs_id
   SET l.assigned_cs_name = s.name, l.updated_at = l.updated_at
 WHERE NOT (l.assigned_cs_name <=> s.name);
