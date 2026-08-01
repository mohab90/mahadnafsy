'use strict';

// Keeps lead scores honest over time.
//
// calcLeadScoreServer() factors in recency — how long ago the lead arrived and
// whether a follow-up is overdue — but it only ever ran when someone SAVED a
// lead. So a lead that nobody touches keeps the score it earned on day one:
// a month-old untouched lead still reads as hot, and the sales team prioritises
// by a number that stopped being true. Nothing in the system decayed it.
//
// This recomputes scores for open leads on a schedule, so the ordering the reps
// work from reflects the lead's age rather than the last time a human clicked
// save.

const { calcLeadScoreServer } = require('./helpers');
const { tryJson, parseCrm } = require('./helpers');

// Terminal states can't improve, so re-scoring them is pure write cost on the
// busiest table in the CRM.
const CLOSED_STATUSES = [
  'converted', 'lost', 'closed', 'won', 'not_interested', 'not_interested_hidden',
  'wrong_number', 'unqualified', 'disqualified', 'archived',
];

/**
 * Recompute scores for leads whose stored value has gone stale.
 * Batched and capped so it can never turn into an unbounded table rewrite.
 *
 * @returns {Promise<{scanned: number, updated: number}>}
 */
async function refreshLeadScores(pool, { tenantId = null, limit = 2000 } = {}) {
  // Any non-positive or unparseable limit falls back to the default. Clamping
  // with Math.max(n, 1) instead would turn a negative into a batch of ONE, so a
  // bad argument would leave the job silently doing nothing at all.
  const requested = Number(limit);
  const cap = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 2000, 10000);
  const params = [];
  let where = 'l.hidden = 0 AND l.deleted_at IS NULL';
  if (tenantId) { where += ' AND l.tenant_id = ?'; params.push(tenantId); }
  where += ` AND l.status NOT IN (${CLOSED_STATUSES.map(() => '?').join(',')})`;
  params.push(...CLOSED_STATUSES);

  const [rows] = await pool.query(
    `SELECT l.id, l.tenant_id, l.status, l.interest_level, l.next_follow_up_date,
            l.interested_course_ids_json, l.created_at, l.score, l.crm_json
       FROM leads l
      WHERE ${where}
      ORDER BY l.updated_at ASC
      LIMIT ?`,
    [...params, cap]
  );

  let updated = 0;
  for (const row of rows) {
    const crm = parseCrm(row.crm_json);
    const comms = Array.isArray(crm.communications) ? crm.communications : [];
    const courseIds = tryJson(row.interested_course_ids_json, crm.interestedCourseIds || []);
    const next = calcLeadScoreServer(
      row.status, row.interest_level, comms, row.next_follow_up_date, courseIds, row.created_at
    );
    if (Number(next) === Number(row.score)) continue;
    // `updated_at = updated_at` is load-bearing, not redundant: the column is
    // declared ON UPDATE current_timestamp(), so any write bumps it unless it is
    // assigned explicitly. A machine rescore is not human activity — letting it
    // touch the timestamp would mark every neglected lead as freshly worked,
    // hiding exactly the leads the stale-lead reports exist to surface, and
    // would keep re-selecting the same rows in the ORDER BY updated_at sweep
    // above instead of moving through the table.
    await pool.query(
      'UPDATE leads SET score = ?, updated_at = updated_at WHERE id = ? AND tenant_id = ?',
      [next, row.id, row.tenant_id]
    );
    updated++;
  }
  return { scanned: rows.length, updated };
}

module.exports = { refreshLeadScores, CLOSED_STATUSES };
