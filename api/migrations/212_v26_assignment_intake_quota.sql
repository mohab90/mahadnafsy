-- A cap on how many leads a rep RECEIVES in a period, alongside the existing
-- cap on how many they may hold open at once.
--
-- crm_assignment_members already has max_open_leads, which asks "how many live
-- leads is this person carrying". That is a different question from "how many
-- new ones did they get this week". A rep who converts or closes quickly never
-- reaches the open cap and can be handed an unlimited stream; the owner asked
-- for a limit on the intake itself, per day, per fortnight, or per month.
--
-- Both caps apply. A rep is skipped when either one is reached.

ALTER TABLE crm_assignment_members
  ADD COLUMN IF NOT EXISTS intake_limit INT DEFAULT NULL
    COMMENT 'Max leads assigned per intake_period. NULL = no rate cap.',
  ADD COLUMN IF NOT EXISTS intake_period ENUM('day','fortnight','month') NOT NULL DEFAULT 'day'
    COMMENT 'Window intake_limit is counted over.';

-- leads.assigned_at has existed for a while and nothing ever wrote to it: all
-- 2,380 assigned leads have it NULL. The intake count is a COUNT over this
-- column, so it has to be populated from here on — assignLead sets it now.
--
-- Backfilling the existing rows is deliberately NOT done in SQL. The only
-- record of when a lead was assigned is its 'assigned' event in lead_timeline,
-- and leads assigned by paths that predate that event have no record at all.
-- A backfill that invented NOW() for those would start every rep's counter at
-- the same instant and make the first period after deploy behave strangely.
-- Leaving them NULL means the cap counts only assignments made from now on,
-- which is the honest reading of "how many did this rep receive this period".

CREATE INDEX IF NOT EXISTS idx_leads_assigned_at
  ON leads (tenant_id, assigned_sales_id, assigned_at);
