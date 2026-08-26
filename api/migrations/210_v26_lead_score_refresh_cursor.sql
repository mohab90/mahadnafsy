-- The lead-score refresh has been rescoring the same 2,000 rows since it was
-- written, and will never reach the rest.
--
-- lib/leadScoreRefresh.js selects `ORDER BY l.updated_at ASC LIMIT 2000`, then
-- writes `SET score = ?, updated_at = updated_at` — preserving updated_at on
-- purpose, so a machine rescore does not mark a neglected lead as freshly
-- worked. That part is right and its comment explains why.
--
-- But the sweep orders by the very column it refuses to touch. So the ordering
-- never changes, the same 2,000 rows come back every six hours, and once those
-- were scored correctly the comparison `next === row.score` skips all of them.
-- Measured on production: scanned 2000, updated 0. 14,403 open leads still
-- carry a score of 0 and are not reachable by the sweep at all.
--
-- The comment claims preserving updated_at avoids "re-selecting the same rows".
-- It causes it.
--
-- A separate cursor fixes both halves: updated_at keeps meaning "a human
-- touched this", and the sweep rotates on its own column, which it is free to
-- write on every pass whether or not the score changed.
--
-- NULL first is deliberate — leads never scored sort ahead of leads scored long
-- ago, so the 14,403 are drained before the rotation settles into a cycle.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS score_refreshed_at DATETIME NULL DEFAULT NULL;

-- The sweep's ORDER BY. Without it, the scan reverts to a filesort over the
-- whole table every six hours.
CREATE INDEX IF NOT EXISTS idx_leads_score_refreshed
  ON leads (tenant_id, score_refreshed_at);
