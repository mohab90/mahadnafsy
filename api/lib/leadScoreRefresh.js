'use strict';

// Keeps leads.score equal to the score formula, for every visible lead.
//
// The formula decays with time (days since the last contact, days since the
// lead arrived), so a stored score drifts unless something recomputes it. The
// first version of this job recomputed 2,000 leads every six hours in
// JavaScript: at 29k leads that is a full pass every few days, at 500k it is
// never — and the CRM screens could not trust the column, so they computed the
// formula live for every lead on every load. At 500k leads that took the KPI
// screen 45 seconds and the scoring screen over a minute.
//
// Now the database does the work in one statement per batch, with the same
// LEAD_SCORE_SQL the screens used, over every visible lead, every hour. The
// screens read the column. The numbers are the formula's, at most an hour old —
// and the formula only moves in whole days, plus whatever a rep logged in that
// hour.
//
// Closed leads are included on purpose: the KPI screen averages over every
// visible lead, and 'closed' and 'archived' still decay.

const { LEAD_SCORE_SQL } = require('./leadScoreSql');

const DEFAULT_BATCH = 5000;

/**
 * Recompute leads.score for every visible lead, in primary-key batches.
 * Writes only the rows whose score changed.
 *
 * @returns {Promise<{scanned: number, updated: number}>}
 */
async function refreshLeadScores(pool, { tenantId = null, batch = DEFAULT_BATCH } = {}) {
  const requested = Number(batch);
  const size = Math.min(Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_BATCH, 20000);
  let after = '';
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const params = [after];
    let where = 'id > ? AND hidden = 0 AND deleted_at IS NULL';
    if (tenantId) { where += ' AND tenant_id = ?'; params.push(tenantId); }
    const [rows] = await pool.query(`SELECT id FROM leads WHERE ${where} ORDER BY id LIMIT ?`, [...params, size]);
    if (!rows.length) break;
    const ids = rows.map(r => r.id);
    after = ids.at(-1);
    scanned += ids.length;
    // `updated_at = updated_at` is load-bearing: the column is ON UPDATE
    // current_timestamp(), and a machine rescore is not human activity. Letting
    // it bump the timestamp would mark every neglected lead as freshly worked
    // and hide exactly the leads the stale-lead reports exist to surface.
    //
    // The communications rollup is the same one the screens joined, narrowed to
    // this batch and matched on tenant as theirs was.
    const [result] = await pool.query(
      `UPDATE leads l
         LEFT JOIN (
           SELECT lead_id, tenant_id, COUNT(*) AS comm_count, MAX(date) AS last_comm
             FROM communications WHERE lead_id IN (?)
            GROUP BY lead_id, tenant_id
         ) lc ON lc.lead_id = l.id AND lc.tenant_id = l.tenant_id
          SET l.score = ${LEAD_SCORE_SQL},
              l.score_refreshed_at = NOW(),
              l.updated_at = l.updated_at
        WHERE l.id IN (?) AND l.score <> ${LEAD_SCORE_SQL}`,
      [ids, ids],
    );
    updated += Number(result?.affectedRows || 0);
    if (ids.length < size) break;
  }
  return { scanned, updated };
}

module.exports = { refreshLeadScores };
