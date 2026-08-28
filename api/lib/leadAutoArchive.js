'use strict';

/**
 * Moving cold leads out of the active queue.
 *
 * 11,257 leads were sitting in "new", older than thirty days, with no contact
 * recorded against them. They are not a work list — they are what makes the
 * work list unreadable, and they drag every conversion and coverage figure with
 * them.
 *
 * This archives them rather than deleting anything: status becomes 'archived',
 * which is terminal and out of the pipeline, and the row keeps everything else.
 * Un-archiving is a status change like any other.
 *
 * Off unless the owner turns it on. crm_settings.autoArchiveDays holds the age
 * in days; absent, zero or negative means the job does nothing. Archiving
 * thousands of leads is a decision about how the desk works, not a default to
 * inherit — and the first run after enabling it will be the large one.
 *
 * Deliberately narrow about what qualifies:
 *   - never contacted. One recorded communication and the lead is somebody's
 *     work, however old.
 *   - never given a follow-up date. Someone intended to come back to it.
 *   - still in an opening status. Anything further along is being worked.
 */

const { logLeadEventStrict } = require('./crm');

/** Statuses that mean nobody has got anywhere yet. */
const COLD_STATUSES = ['new', 'no_answer', 'no_answer_wa', 'no_answer_nowa'];

const BATCH = 500;

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {object} options
 * @param {number} options.olderThanDays
 * @param {string} [options.tenantId]
 * @param {number} [options.limit] safety ceiling for one run
 * @returns {Promise<{eligible: number, archived: number}>}
 */
async function archiveColdLeads(pool, { olderThanDays, tenantId = 'tenant-default', limit = 5000 } = {}) {
  const days = Number(olderThanDays);
  if (!Number.isFinite(days) || days <= 0) return { eligible: 0, archived: 0 };

  const where = `
      l.tenant_id = ?
      AND l.deleted_at IS NULL
      AND l.hidden = 0
      AND l.status IN (${COLD_STATUSES.map(() => '?').join(',')})
      AND l.next_follow_up_date IS NULL
      AND l.created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
      AND NOT EXISTS (SELECT 1 FROM communications c WHERE c.lead_id = l.id)`;
  const params = [tenantId, ...COLD_STATUSES, days];

  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS eligible FROM leads l WHERE ${where}`, params);
  const eligible = Number(count.eligible) || 0;
  if (!eligible) return { eligible: 0, archived: 0 };

  const cap = Math.min(eligible, Math.max(1, Number(limit) || 5000));
  let archived = 0;

  while (archived < cap) {
    const take = Math.min(BATCH, cap - archived);
    const [rows] = await pool.query(
      `SELECT l.id FROM leads l WHERE ${where} ORDER BY l.created_at ASC LIMIT ?`,
      [...params, take]);
    if (!rows.length) break;

    const ids = rows.map(row => row.id);
    // updated_at is pinned: a machine archiving a neglected lead is not someone
    // working it, and letting the timestamp move would hide it from the very
    // reports that exist to surface neglect.
    //
    // The status is re-checked inside the UPDATE rather than trusted from the
    // SELECT above. Without it a second run overlapping this one reported rows
    // it had not actually transitioned — which is how 4,000 leads ended up with
    // the same archive note twice.
    const [result] = await pool.query(
      `UPDATE leads SET status='archived', updated_at=updated_at
        WHERE tenant_id=? AND id IN (${ids.map(() => '?').join(',')})
          AND status IN (${COLD_STATUSES.map(() => '?').join(',')})`,
      [tenantId, ...ids, ...COLD_STATUSES]);
    archived += result.affectedRows;

    // Only this run may narrate what only this run did. When another run took
    // part of the batch the count comes back short, and the note is skipped for
    // the whole batch rather than written for leads somebody else archived: a
    // missing courtesy note is a smaller wrong than a duplicated one, and the
    // status change itself is already recorded on the lead.
    if (result.affectedRows !== ids.length) continue;

    for (const id of ids) {
      await logLeadEventStrict(
        id, 'status', `أُرشف تلقائياً — بدون تواصل منذ ${days} يوم`,
        { from: 'cold', to: 'archived', actor: 'system', olderThanDays: days }, tenantId
      ).catch(() => { /* the archive itself is the point; the note is a courtesy */ });
    }
  }

  return { eligible, archived };
}

module.exports = { archiveColdLeads, COLD_STATUSES };
