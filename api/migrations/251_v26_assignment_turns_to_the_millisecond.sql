-- crm_assignment_members.last_assigned_at, to the millisecond.
--
-- The rotation hands each new lead to the rep whose turn came longest ago.
-- A run that serves several reps writes their turns a millisecond apart, in
-- the order it served them; at whole seconds they all read as the same moment
-- and the next run could not tell who came first.
--
-- Rollback: ALTER TABLE crm_assignment_members MODIFY COLUMN last_assigned_at DATETIME NULL;

ALTER TABLE crm_assignment_members MODIFY COLUMN last_assigned_at DATETIME(3) NULL;
