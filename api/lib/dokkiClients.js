'use strict';

// The Dokki (and Tagamoa) screens' clients, chosen on the server (GET /api/admin/dokki/overview and /candidates).
//
// «جدول الدقي» streamed every client of the branch with their payments into the browser (7,400 on the production-scale
// lab, 300 at a time) to count two figures above the schedule and to fill two pickers: the clients still waiting for a
// seat, and the ones to seat in a round. The rules below are the screen's own — admin/pages/dashboard/tabs/daqqi/
// daqqiHousingNeeds.ts, daqqiScheduleUtils.ts (daqqiOverview, isEnrolledInCourse) and the two pickers' filters — written
// once more in JavaScript over the few facts they read (who the branch's clients are, which courses each holds, who sits
// in which round). api/tests/dokkiClients.test.js runs both on the same clients, so a change to one fails there.

// Above this many clients the enrolments are read once for the tenant and picked out here, not asked for by id.
const READ_WHOLE_TABLE_ABOVE = 2000;

/**
 * `base`: { where, params } on `subscribers s` — the branch's clients the person may see (routes/admin/dokkiclients.js).
 * Returns { clients: [{id, name, phone, clientCode, createdAt}] newest first, courses: Map(id → Set(courseId)),
 * rounds: [{id, courseId, finished, attendees: Set}] }.
 */
async function readBranchFacts(db, tenantId, base, branch) {
  const [clients] = await db.query(
    `SELECT s.id, s.name, s.phone, s.client_code, s.created_at
       FROM subscribers s
      WHERE s.tenant_id = ? AND (${base.where}) AND s.branch = ?
      ORDER BY s.created_at DESC, s.id DESC`,
    [tenantId, ...base.params, branch]
  );
  const ids = clients.map(row => row.id);
  const wholeTable = ids.length > READ_WHOLE_TABLE_ABOVE;
  const inBranch = wholeTable ? new Set(ids) : null;
  const [enrolRows] = ids.length ? await db.query(
    `SELECT x.subscriber_id, x.course_id FROM enrollments x
      WHERE x.tenant_id = ? AND x.status = 'active' AND x.course_id IS NOT NULL${wholeTable ? '' : ` AND x.subscriber_id IN (${ids.map(() => '?').join(',')})`}`,
    [tenantId, ...(wholeTable ? [] : ids)]
  ) : [[]];
  const [roundRows] = await db.query(
    'SELECT id, course_id, status FROM daqqi_rounds WHERE tenant_id = ? AND branch = ?', [tenantId, branch]);
  const [seatRows] = roundRows.length ? await db.query(
    `SELECT da.round_id, da.subscriber_id FROM daqqi_attendees da
       JOIN daqqi_rounds r ON r.id = da.round_id AND r.tenant_id = da.tenant_id
      WHERE da.tenant_id = ? AND r.branch = ?`,
    [tenantId, branch]
  ) : [[]];

  const courses = new Map();
  for (const row of enrolRows) {
    if (inBranch && !inBranch.has(row.subscriber_id)) continue;
    if (!courses.has(row.subscriber_id)) courses.set(row.subscriber_id, new Set());
    courses.get(row.subscriber_id).add(String(row.course_id));
  }
  const rounds = roundRows.map(row => ({ id: row.id, courseId: row.course_id, finished: String(row.status || '').toLowerCase() === 'finished', attendees: new Set() }));
  const roundById = new Map(rounds.map(round => [round.id, round]));
  for (const seat of seatRows) roundById.get(seat.round_id)?.attendees.add(seat.subscriber_id);
  return {
    clients: clients.map(row => ({ id: row.id, name: row.name, phone: row.phone, clientCode: row.client_code, createdAt: row.created_at })),
    courses, rounds,
  };
}

/** Which courses each client sits in a round of (the rounds of the branch, finished ones included). */
function seatsOf(rounds) {
  const seats = new Map();
  for (const round of rounds) {
    for (const id of round.attendees) {
      if (!seats.has(id)) seats.set(id, new Set());
      seats.get(id).add(round.courseId);
    }
  }
  return seats;
}

const coursesOf = (facts, id) => facts.courses.get(id) || new Set();

/**
 * The strip above the schedule: how many clients the branch has, and how many of them hold a course that has an open
 * round and sit in no round of it (each person once, however many courses wait — daqqiOverview's `waiting`).
 */
function overviewOf(facts) {
  const seats = seatsOf(facts.rounds);
  const openCourses = [...new Set(facts.rounds.filter(round => !round.finished).map(round => round.courseId))];
  const waiting = facts.clients.filter(client => {
    const held = coursesOf(facts, client.id);
    const seated = seats.get(client.id) || new Set();
    return openCourses.some(courseId => !seated.has(courseId) && held.has(courseId));
  }).length;
  return { clients: facts.clients.length, waiting };
}

/** Seated in a round for every course of theirs that has one (daqqiHousingNeeds.ts isFullyHoused over housingNeedOf). */
function fullyHoused(facts, seats, id) {
  const housed = seats.get(id) || new Set();
  if (housed.size === 0) return false;
  const held = coursesOf(facts, id);
  const withRounds = new Set(facts.rounds.map(round => round.courseId));
  for (const courseId of withRounds) if (!housed.has(courseId) && held.has(courseId)) return false;
  return true;
}

/**
 * The clients the two pickers offer — «إضافة عملاء للروند» and «اختر الحاضرين» of a new round — newest first.
 *   enrolled   a course the client must hold ('' for any)
 *   housing    unhoused | housed | any
 *   housedFor  the course "housed" is judged for; '' judges every course the client holds (fully housed)
 *   roundId    leave out whoever already sits in this round
 *   q          the modal's search: a name or a code containing it, or a phone containing its digits (three or more)
 */
function candidatesOf(facts, { enrolled = '', housing = 'any', housedFor = '', roundId = '', q = '' } = {}) {
  const seats = seatsOf(facts.rounds);
  const alreadyIn = roundId ? facts.rounds.find(round => round.id === roundId)?.attendees : null;
  const term = String(q).trim().toLowerCase();
  const digits = term.replace(/\D/g, '');
  return facts.clients.filter(client => {
    if (alreadyIn?.has(client.id)) return false;
    if (enrolled && !coursesOf(facts, client.id).has(enrolled)) return false;
    if (housing !== 'any') {
      const housed = housedFor ? (seats.get(client.id) || new Set()).has(housedFor) : fullyHoused(facts, seats, client.id);
      if (housing === 'housed' && !housed) return false;
      if (housing === 'unhoused' && housed) return false;
    }
    if (term) {
      const byName = String(client.name || '').toLowerCase().includes(term) || String(client.clientCode || '').toLowerCase().includes(term);
      const byPhone = digits.length >= 3 && String(client.phone || '').replace(/\D/g, '').includes(digits);
      if (!byName && !byPhone) return false;
    }
    return true;
  });
}

module.exports = { readBranchFacts, overviewOf, candidatesOf };
