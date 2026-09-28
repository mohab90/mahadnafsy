-- subscribers.assigned_cs_at: when the client was handed to their collection
-- officer, written by the database whenever the officer changes.
--
-- «في توزيع الداتا علي التحصيل لازم تحدد اقصي عدد في مدة اد ايه يوميا ولا
-- اسبوعيا ولا 15 يوم ولا في الشهر». A cap on what an officer receives in a
-- period needs to know when each client arrived; nothing recorded it. The same
-- approach as leads.assigned_at (216): a trigger, so no path that assigns an
-- officer can forget it, and a rewrite that keeps the officer keeps the time.
--
-- Nothing is backfilled: there is no record of when older assignments happened,
-- so they count towards no period.

ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS assigned_cs_at DATETIME NULL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_subscribers_cs_at ON subscribers (tenant_id, assigned_cs_id, assigned_cs_at);

CREATE OR REPLACE TRIGGER trg_subscribers_cs_at_insert BEFORE INSERT ON subscribers FOR EACH ROW
  SET NEW.assigned_cs_at = IF(COALESCE(NEW.assigned_cs_id, '') <> '' AND NEW.assigned_cs_at IS NULL, NOW(), NEW.assigned_cs_at);

CREATE OR REPLACE TRIGGER trg_subscribers_cs_at_update BEFORE UPDATE ON subscribers FOR EACH ROW
  SET NEW.assigned_cs_at = IF(COALESCE(NEW.assigned_cs_id, '') <> ''
      AND NOT (NEW.assigned_cs_id <=> OLD.assigned_cs_id)
      AND NEW.assigned_cs_at <=> OLD.assigned_cs_at,
    NOW(), NEW.assigned_cs_at);
