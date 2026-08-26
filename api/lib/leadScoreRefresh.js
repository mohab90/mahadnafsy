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
      ORDER BY l.score_refreshed_at IS NOT NULL, l.score_refreshed_at ASC, l.id ASC
      LIMIT ?`,
    [...params, cap]
  );

  // Communications from the table, not from crm_json.
  //
  // crm_json.communications is a write-once snapshot taken when the lead was
  // created; the live record is the communications table. Scoring from the
  // snapshot gives a lead credit for the contacts it had on day one and none
  // for anything since — and it disagrees with LEAD_SCORE_SQL in
  // routes/admin/leads.js, which reads the table. Two scores for one lead
  // depending on who asked.
  //
  // One query for the batch: 2,000 correlated lookups would make a six-hourly
  // sweep expensive enough that someone turns it off.
  const commsByLead = new Map();
  if (rows.length) {
    const [commRows] = await pool.query(
      `SELECT lead_id, type, date FROM communications
        WHERE lead_id IN (${rows.map(() => '?').join(',')})`,
      rows.map(r => r.id)
    );
    for (const c of commRows) {
      const list = commsByLead.get(c.lead_id) || [];
      // calcLeadScoreServer slices the date as a string, so it is handed one.
      const d = c.date instanceof Date
        ? `${c.date.getFullYear()}-${String(c.date.getMonth() + 1).padStart(2, '0')}-${String(c.date.getDate()).padStart(2, '0')}`
        : String(c.date || '');
      list.push({ type: String(c.type || '').toLowerCase(), date: d });
      commsByLead.set(c.lead_id, list);
    }
  }

  let updated = 0;
  const scanned = [];
  for (const row of rows) {
    const crm = parseCrm(row.crm_json);
    const comms = commsByLead.get(row.id) || [];
    const courseIds = tryJson(row.interested_course_ids_json, crm.interestedCourseIds || []);
    const next = calcLeadScoreServer(
      row.status, row.interest_level, comms, row.next_follow_up_date, courseIds, row.created_at
    );
    // Stamped whether or not the score moved. This is the cursor: a row that
    // was scanned has been dealt with for this pass, and skipping the stamp on
    // unchanged rows would put them straight back at the front of the queue.
    scanned.push(row.id);
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
  // One statement for the whole batch rather than 2,000 round trips.
  if (scanned.length) {
    await pool.query(
      `UPDATE leads SET score_refreshed_at = NOW(), updated_at = updated_at
        WHERE id IN (${scanned.map(() => '?').join(',')})`,
      scanned
    );
  }
  return { scanned: rows.length, updated };
}

module.exports = { refreshLeadScores, CLOSED_STATUSES };
