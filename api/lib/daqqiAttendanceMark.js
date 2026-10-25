'use strict';

// Marking one client present at one session of a Dokki round — one function for the two doors it is asked at: the branch
// desk (routes/daqqi-rounds.js) and the round's own lecturer (routes/lecturer-portal.js). `conn` is a connection already
// inside a transaction; the caller commits. A refusal is thrown as an error carrying { statusCode, code, attendance: true }.

const { uuidv4 } = require('./id');
const { ymd } = require('./helpers');
const { lectureToday } = require('./daqqiLecture');
const { writeAuditEvent } = require('./auditTrail');
const { inviteToRate } = require('./selfRating');

const refuse = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code, attendance: true });

/**
 * @returns {Promise<{ id: string, sessionNumber: number, attendedLectures: number }>}
 */
async function markRoundAttendance(conn, { tenantId, roundId, subscriberId, sessionNumber: requested, markedBy = null, req = null }) {
  const [[round]] = await conn.query(
    `SELECT id,status,current_lecture,start_date,postponed_weeks_json FROM daqqi_rounds
      WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
    [roundId, tenantId]
  );
  if (!round) throw refuse('Round not found', 404);
  // A round is created NEW with current_lecture 0, and nothing in the schedule
  // tab moves it on — so taking attendance was impossible for every round the
  // desk had actually made: always 409, "active round with a current lecture".
  //
  // Marking attendance IS the act of starting the session, so treat it that
  // way instead of demanding someone first find a separate control that does
  // not exist. A NEW round becomes ACTIVE on its first attendance, and a round
  // still on lecture 0 moves to lecture 1. A FINISHED round is still refused:
  // that one is a real state, not a missing step.
  if (round.status === 'FINISHED') throw refuse('Attendance cannot be marked for a finished round', 409, 'ROUND_FINISHED');
  if (round.status !== 'ACTIVE' || Number(round.current_lecture) < 1) {
    await conn.query(
      `UPDATE daqqi_rounds
          SET status='ACTIVE', current_lecture=GREATEST(COALESCE(current_lecture,0),1)
        WHERE id=? AND tenant_id=?`,
      [round.id, tenantId]
    );
    round.status = 'ACTIVE';
    round.current_lecture = Math.max(Number(round.current_lecture) || 0, 1);
  }
  // The lecture the round is on is its dates' (lib/daqqiLecture.js, the
  // schedule's own count). current_lecture never moved past 1, so the button —
  // which names no session — marked lecture 1 forever: from the second week on
  // every tap answered «already recorded», and on 9 Oct 2026 eleven rounds
  // running since August held four marks between them.
  let postponed = [];
  try { postponed = JSON.parse(round.postponed_weeks_json || '[]'); } catch { postponed = []; }
  const onDates = Math.max(1, lectureToday(ymd(round.start_date), postponed));
  if (onDates > Number(round.current_lecture)) {
    await conn.query('UPDATE daqqi_rounds SET current_lecture=? WHERE id=? AND tenant_id=?', [onDates, round.id, tenantId]);
    round.current_lecture = onDates;
  }
  const sessionNumber = requested === undefined ? onDates : Number(requested);
  if (!Number.isInteger(sessionNumber) || sessionNumber < 1 || sessionNumber > Number(round.current_lecture)) {
    throw refuse('Invalid sessionNumber', 400);
  }
  const [[attendee]] = await conn.query(
    `SELECT attended_lectures FROM daqqi_attendees
      WHERE tenant_id=? AND round_id=? AND subscriber_id=? LIMIT 1 FOR UPDATE`,
    [tenantId, roundId, subscriberId]
  );
  if (!attendee) throw refuse('Attendee not found in round', 404);
  // Has THIS session been marked for this person? The check used to be
  // `attended_lectures >= sessionNumber`, treating the counter as "the last
  // session attended". It is a count, not a position: someone who attended
  // sessions 1 and 3 (count 2) was refused session 2, and marking 2 before 1
  // refused 1 later — so a late correction was impossible. The events are what
  // say which sessions were marked.
  //
  // A client with no events at all predates them and keeps the old rule, so
  // their carried-over count is not marked a second time.
  const [[marked]] = await conn.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(session_number=?),0) AS this_session
       FROM daqqi_attendance_events WHERE tenant_id=? AND round_id=? AND subscriber_id=?`,
    [sessionNumber, tenantId, roundId, subscriberId]
  );
  const alreadyMarked = Number(marked?.this_session) > 0
    || (Number(marked?.total) === 0 && Number(attendee.attended_lectures || 0) >= sessionNumber);
  if (alreadyMarked) throw refuse(`حضور العميل ده في المحاضرة ${sessionNumber} متسجل قبل كده`, 409, 'ATTENDANCE_ALREADY_MARKED');
  const eventId = uuidv4();
  await conn.query(
    `INSERT INTO daqqi_attendance_events
      (id,tenant_id,round_id,subscriber_id,session_number,status,source,marked_by)
     VALUES (?,?,?,?,?,'PRESENT','MANUAL',?)`,
    [eventId, tenantId, roundId, subscriberId, sessionNumber, markedBy]
  );
  await conn.query(
    `UPDATE daqqi_attendees SET attended_lectures=attended_lectures+1
      WHERE tenant_id=? AND round_id=? AND subscriber_id=?`,
    [tenantId, roundId, subscriberId]
  );
  await writeAuditEvent({
    action: 'DAQQI_ATTENDANCE_MARKED',
    entityType: 'DAQQI_ATTENDANCE',
    entityId: eventId,
    metadata: { roundId, subscriberId, sessionNumber },
    req,
    db: conn,
  });
  const attendedLectures = Number(attendee.attended_lectures || 0) + 1;
  // Present at their third lecture: their own link to rate it.
  if (attendedLectures === 3) {
    await inviteToRate(conn, { tenantId, roundId, subscriberIds: [subscriberId], stage: 'third' });
  }
  return { id: eventId, sessionNumber, attendedLectures };
}

/** Takes back a session marked by mistake. Returns the removed event's id. */
async function unmarkRoundAttendance(conn, { tenantId, roundId, subscriberId, sessionNumber, req = null }) {
  if (!Number.isInteger(sessionNumber) || sessionNumber < 1) throw refuse('Invalid sessionNumber', 400);
  const [[event]] = await conn.query(
    `SELECT id,status FROM daqqi_attendance_events
      WHERE tenant_id=? AND round_id=? AND subscriber_id=? AND session_number=? LIMIT 1 FOR UPDATE`,
    [tenantId, roundId, subscriberId, sessionNumber]
  );
  if (!event) throw refuse('لا يوجد تسجيل حضور لهذه المحاضرة', 404);
  await conn.query('DELETE FROM daqqi_attendance_events WHERE id=? AND tenant_id=?', [event.id, tenantId]);
  if (event.status === 'PRESENT') {
    await conn.query(
      `UPDATE daqqi_attendees SET attended_lectures=GREATEST(attended_lectures-1,0)
        WHERE tenant_id=? AND round_id=? AND subscriber_id=?`,
      [tenantId, roundId, subscriberId]
    );
  }
  await writeAuditEvent({
    action: 'DAQQI_ATTENDANCE_UNMARKED',
    entityType: 'DAQQI_ATTENDANCE',
    entityId: event.id,
    metadata: { roundId, subscriberId, sessionNumber },
    req,
    db: conn,
  });
  return event.id;
}

module.exports = { markRoundAttendance, unmarkRoundAttendance };
