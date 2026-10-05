'use strict';

// «تسكين»: seating one client in one Dokki round.
//
// Seating is a roster change and writes one row — never the whole round posted
// back from whatever the caller last loaded, which deleted any client another desk
// had seated in between. Done in one place for the three ways it is asked for: the
// clients screen, the schedule, and a booking («حجز ودفع») that names the round.

const { branchIdForBranch } = require('./branches');
const { writeAuditEvent } = require('./auditTrail');

/**
 * Seats the client. `conn` is a connection already inside a transaction — the
 * round row is locked for the duration.
 *
 * @returns {Promise<{status: 'seated'|'already'|'no_round'|'archived'|'no_subscriber', roundId?: string, code?: string, courseId?: string}>}
 */
async function seatSubscriberInRound(conn, { tenantId, roundId, subscriberId, req = null }) {
  const [[round]] = await conn.query(
    'SELECT id, course_id, code, branch FROM daqqi_rounds WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
    [roundId, tenantId]
  );
  if (!round) return { status: 'no_round' };
  const seat = { roundId: round.id, code: round.code, courseId: round.course_id };

  const [[already]] = await conn.query(
    'SELECT subscriber_id FROM daqqi_attendees WHERE tenant_id=? AND round_id=? AND subscriber_id=? LIMIT 1 FOR UPDATE',
    [tenantId, round.id, subscriberId]
  );
  if (already) return { status: 'already', ...seat };

  // The roster's phone is NOT NULL: a client with no number of their own is seated
  // all the same, with their other number or none. What they have already paid for
  // the round's course is the starting figure; the roster reads the live one.
  const [insert] = await conn.query(
    `INSERT INTO daqqi_attendees
       (round_id,subscriber_id,tenant_id,name,phone,booked_at,amount_paid,attended_lectures)
     SELECT ?,s.id,?,s.name,COALESCE(NULLIF(s.phone,''), NULLIF(s.whatsapp,''), ''),NOW(),
       COALESCE((
         SELECT SUM(COALESCE(p.amount_egp, p.amount)) FROM payments p
          WHERE p.tenant_id=s.tenant_id AND p.subscriber_id=s.id
            AND p.status='paid' AND p.deleted_at IS NULL
            AND (p.course_id=? OR EXISTS (
              SELECT 1 FROM bundle_courses bc
               WHERE bc.tenant_id=p.tenant_id AND bc.bundle_id=p.bundle_id AND bc.course_id=?
            ))
       ),0),0
     FROM subscribers s
    WHERE s.id=? AND s.tenant_id=? AND s.deleted_at IS NULL`,
    [round.id, tenantId, round.course_id, round.course_id, subscriberId, tenantId]
  );
  if (insert.affectedRows !== 1) {
    const [[known]] = await conn.query(
      'SELECT deleted_at FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1', [subscriberId, tenantId]);
    return { status: known?.deleted_at ? 'archived' : 'no_subscriber', ...seat };
  }
  // A client housed in a round is a client of its branch — «عملاء الدقي» (and the
  // Tagamoa list) read the branch.
  const roundBranch = round.branch || 'DAQQI';
  await conn.query(
    `UPDATE subscribers SET branch=?, branch_id=?, updated_at=NOW()
      WHERE id=? AND tenant_id=? AND (branch IS NULL OR branch<>?)`,
    [roundBranch, branchIdForBranch(roundBranch), subscriberId, tenantId, roundBranch]
  );
  await writeAuditEvent({
    action: 'DAQQI_ATTENDEE_BOOKED',
    entityType: 'DAQQI_ROUND',
    entityId: round.id,
    metadata: { subscriberId, courseId: round.course_id },
    req,
    db: conn,
  });
  return { status: 'seated', ...seat };
}

/** The same, in a transaction of its own — for a caller that has none open. */
async function seatInOwnTransaction(pool, args) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await seatSubscriberInRound(conn, args);
    if (result.status === 'seated') await conn.commit(); else await conn.rollback();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { seatSubscriberInRound, seatInOwnTransaction };
