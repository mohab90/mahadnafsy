'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');
const { requireDaqqiAccess } = require('../lib/daqqiAccess');
const { writeAuditEvent } = require('../lib/auditTrail');
const { getDaqqiAttendees } = require('../lib/daqqiAttendees');
const { ymd } = require('../lib/helpers');

// Arabic weekday name → MySQL DAYOFWEEK (1 = Sunday … 7 = Saturday).
//
// daqqi_rounds.day_of_week is a recurring weekday written in Arabic;
// classroom_bookings holds absolute start_time/end_time. Comparing the two
// needs this one translation, and there is nowhere else in the codebase that
// already does it.
//
// Both spellings of Monday are listed because both appear in Arabic UIs and
// neither is wrong.
const ARABIC_WEEKDAY_TO_MYSQL = Object.freeze({
  '\u0627\u0644\u0623\u062d\u062f': 1,
  '\u0627\u0644\u0625\u062b\u0646\u064a\u0646': 2,
  '\u0627\u0644\u0627\u062b\u0646\u064a\u0646': 2,
  '\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621': 3,
  '\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621': 4,
  '\u0627\u0644\u062e\u0645\u064a\u0633': 5,
  '\u0627\u0644\u062c\u0645\u0639\u0629': 6,
  '\u0627\u0644\u0633\u0628\u062a': 7,
});

function sendRouteError(res, err) {
  if (res.headersSent) return;
  const dbCodes = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_SERVER_LOST']);
  const status = err && dbCodes.has(err.code) ? 503 : (err?.statusCode || 500);
  res.status(status).json({
    error: status === 503 ? 'Database unavailable' : (status < 500 ? err.message : 'Internal server error'),
  });
}


// MariaDB DATETIME columns reject ISO-8601 strings ("2026-07-12T03:25:31.525Z")
// under STRICT_TRANS_TABLES. Normalise any date-ish value to "YYYY-MM-DD HH:MM:SS"
// (a bare "YYYY-MM-DD" is left as-is, which the column accepts as midnight).
// Blind slicing was the bug behind "Valid course, start date, lecture count and
// postponed weeks are required" on every attempt to add clients to a round.
//
// The old body was `String(v).slice(0, 19).replace('T', ' ')`, which only works
// on an ISO string. The schedule tab round-trips a round through the client and
// sends startDate back as a Date.toString() — "Wed Jun 17 2026 14:14:30
// GMT+0000 (Coordinated Universal Time)". Slicing that to 19 characters gives
// "Wed Jun 17 2026 14:", Date.parse rejects it, and the round-level validator
// then fails the entire save. The desk was only adding attendees; it never
// touched the course or the start date.
//
// Those same mangled values are what render as "Invalid Date" in the list, and
// why other rows show a raw GMT string — whatever shape went in came back out.
//
// Parse properly and emit a real MySQL datetime whatever the input shape is.
function toMysqlDt(v) {
  if (v == null || v === '') return null;
  const text = String(v).trim();
  // Already 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' — return as-is, so a date-only
  // value is not shifted a day by the timezone of whoever happens to be saving.
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(text)) {
    return text.slice(0, 19).replace('T', ' ');
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

// mysql2 here is configured with dateStrings: ['DATE'], so a DATE column arrives
// as a string but a DATETIME - which start_date and booked_at both are - arrives
// as a JS Date. String(date) is the human form, 'Wed Jun 17 2026 14:00:00 GMT+0200',
// and the first ten characters of that are 'Wed Jun 17'. That is the string the
// schedule was rendering as a start date, and the string the UI posted back on the
// next edit for the old toMysqlDt to truncate into the column. Migration 205
// cleared the rows already damaged; these stop new ones being produced.

function isoDt(v) {
  if (!v) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v);
}

// Shared by every Dokki-schedule route below — was only actually applied to
// GET /api/admin/daqqi-rounds; the attendance-report/export/monthly routes had no
// role check at all, so e.g. a SALES or HR account could pull every Dokki attendee's
// name/phone/payments via CSV export.
router.get('/api/admin/daqqi-rounds', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  try {
    const [rounds] = await pool.query(
      `SELECT id, code, course_id, instructor_id, instructor_name, reception_id, reception_name,
       day_of_week, start_date, time_slot, status, current_lecture, postponed_weeks_json, created_at, room
       FROM daqqi_rounds WHERE tenant_id=? ORDER BY created_at DESC LIMIT 500`,
      [req.tenantId]
    );
    if (rounds.length === 0) return res.json([]);

    const attendees = await getDaqqiAttendees(pool, req.tenantId, rounds.map(round => round.id));
    const attendeesMap = {};
    for (const a of attendees) {
      if (!attendeesMap[a.round_id]) attendeesMap[a.round_id] = [];
      attendeesMap[a.round_id].push(a);
    }

    const tsMap = { MORNING: 'صباحاً', NOON: 'ظهراً', EVENING: 'مساءً' };
    const result = rounds.map(r => ({
      id: r.id,
      code: r.code,
      courseId: r.course_id,
      instructorId: r.instructor_id || '',
      instructorName: r.instructor_name,
      receptionId: r.reception_id || '',
      receptionName: r.reception_name,
      dayOfWeek: r.day_of_week,
      room: r.room || '',
      startDate: ymd(r.start_date),
      timeSlot: tsMap[r.time_slot] || 'مساءً',
      status: (r.status || 'NEW').toLowerCase(),
      currentLecture: Number(r.current_lecture || 0),
      postponedWeeks: r.postponed_weeks_json ? (() => {
        try { return JSON.parse(r.postponed_weeks_json); } catch { return []; }
      })() : [],
      createdAt: isoDt(r.created_at),
      attendees: (attendeesMap[r.id] || []).map(a => ({
        subscriberId: a.subscriber_id,
        name: a.name,
        phone: a.phone,
        bookedAt: ymd(a.booked_at),
        amountPaid: Number(a.amount_paid || 0),
        attendedLectures: Number(a.attended_lectures || 0),
        // The client is archived but their attendance stands — see lib/daqqiAttendees.js.
        archived: Boolean(Number(a.archived || 0)),
      })),
    }));
    res.json(result);
  } catch (e) {
    logger.error('[route]', e.message);
    sendRouteError(res, e);
  }
});

router.post('/api/admin/daqqi-rounds', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), async (req, res) => {
  const role = (req.staffRecord?.role || '').toUpperCase();
  const allowedRoles = new Set(['MANAGER', 'ADMIN', 'DAQQI_MANAGER', 'RECEPTION_DAQQI']);
  if (req.staffRecord && !req.isSuperAdmin && !allowedRoles.has(role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const d = req.body;
    const id = d.id || uuidv4();
    const courseId = String(d.courseId || d.course_id || '').trim();
    const currentLecture = Number(d.currentLecture ?? d.current_lecture ?? 0);
    const tsMap = { 'صباحاً': 'MORNING', 'ظهراً': 'NOON', 'مساءً': 'EVENING' };
    const stMap = { new: 'NEW', active: 'ACTIVE', finished: 'FINISHED' };
    const timeSlot = tsMap[d.timeSlot] || tsMap[d.time_slot] || 'EVENING';
    const status = stMap[(d.status || '').toLowerCase()] || 'NEW';
    const startDate = toMysqlDt(d.startDate || d.start_date || null);
    // The schedule form has always sent roomName/roomId — there was simply no
    // column to put them in, so every room the desk picked was dropped on save.
    // Accept what the UI already sends rather than making it change.
    const room = String(d.room || d.roomName || d.room_name || d.roomId || '').trim().slice(0, 60) || null;
    const dayOfWeek = d.dayOfWeek || d.day_of_week || '';
    const postponedWeeks = d.postponedWeeks ?? (() => {
      try { return JSON.parse(d.postponed_weeks_json || '[]'); } catch { return null; }
    })();
    // Named one at a time. The old message listed all four every time and left
    // the desk to work out which one it meant.
    const missing = [];
    if (!courseId) missing.push('الكورس');
    if (!startDate || Number.isNaN(Date.parse(startDate))) missing.push('تاريخ البدء');
    if (!Number.isInteger(currentLecture) || currentLecture < 0 || currentLecture > 1000) missing.push('رقم المحاضرة الحالية');
    if (!Array.isArray(postponedWeeks) || postponedWeeks.length > 200) missing.push('أسابيع التأجيل');
    if (missing.length) {
      const error = new Error(`الحقول دي ناقصة أو غير صحيحة: ${missing.join('، ')}`);
      error.statusCode = 400;
      throw error;
    }
    const postponedJson = JSON.stringify(postponedWeeks);
    // A hall can hold one round per weekday slot. Checked here, before any
    // write, so a clash is refused rather than half-saved. Finished rounds are
    // excluded — they have released the room — and so is this round itself, so
    // editing a round does not report a conflict with its own booking. A round
    // with no room set takes part in no clash: you cannot conflict over a hall
    // nobody named.
    if (room) {
      const [[clash]] = await conn.query(
        `SELECT id, code FROM daqqi_rounds
           WHERE tenant_id=? AND room=? AND day_of_week=? AND time_slot=?
             AND status<>'FINISHED' AND id<>? LIMIT 1`,
        [req.tenantId, room, dayOfWeek, timeSlot, id]
      );
      if (clash) {
        const error = new Error(`القاعة ${room} محجوزة في نفس اليوم والتوقيت للروند ${clash.code || clash.id}`);
        error.statusCode = 409;
        throw error;
      }

      // The other booking system.
      //
      // routes/dokki-operations.js books the same physical rooms through
      // physical_classrooms + classroom_bookings with start_time/end_time
      // overlap checks, and neither system consulted the other — so one room
      // could be taken from both screens with each one satisfied.
      //
      // Nobody has hit it: both of those tables are empty on production and the
      // only rounds carrying a room are two rows left by a live test. The
      // conflict is real but dormant, which is why this is a check rather than a
      // migration — the moment the desk defines its first classroom, the two
      // stop being blind to each other.
      //
      // Matched on the classroom's name, because that is all a round stores: the
      // room is free text here and an entity there. A round naming something
      // that is not a defined classroom clashes with nothing, which is the rule
      // the check above already applies.
      const bookingDay = ARABIC_WEEKDAY_TO_MYSQL[String(dayOfWeek || '').trim()];
      if (bookingDay) {
        const [[roomBooking]] = await conn.query(
          `SELECT cb.id, cb.start_time
             FROM classroom_bookings cb
             JOIN physical_classrooms pc
               ON pc.id = cb.classroom_id AND pc.tenant_id = cb.tenant_id
            WHERE cb.tenant_id = ? AND pc.name = ?
              AND DAYOFWEEK(cb.start_time) = ?
            LIMIT 1`,
          [req.tenantId, room, bookingDay]
        );
        if (roomBooking) {
          const error = new Error(`القاعة ${room} محجوزة يوم ${dayOfWeek} من نظام حجز القاعات`);
          error.statusCode = 409;
          throw error;
        }
      }
    }
    const [[course]] = await conn.query(
      'SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [courseId, req.tenantId]
    );
    if (!course) {
      const error = new Error('Course not found'); error.statusCode = 404; throw error;
    }
    // The instructor comes from `therapists` — that is the list the schedule
    // form offers (DaqqiScheduleTab: instructorOptions = therapists), and
    // instructor_id carries no foreign key, unlike reception_id which does
    // point at staff.
    //
    // This used to look the instructor up in `staff` requiring role
    // instructor/trainer. No account carries either role, so the lookup could
    // not succeed for any selection the form was able to make: every round
    // creation failed with a 404 the UI reported as "Server rejected round".
    //
    // A staff id is still accepted, so a deployment that does keep instructors
    // as staff keeps working.
    const instructorId = d.instructorId || d.instructor_id;
    if (instructorId) {
      const [[therapist]] = await conn.query(
        'SELECT id FROM therapists WHERE id=? AND tenant_id=? LIMIT 1',
        [instructorId, req.tenantId]
      );
      let found = Boolean(therapist);
      if (!found) {
        const [[staff]] = await conn.query(
          `SELECT id FROM staff WHERE id=? AND tenant_id=? AND is_active=1 AND deleted_at IS NULL
            AND LOWER(role) IN ('instructor','trainer') LIMIT 1 FOR UPDATE`,
          [instructorId, req.tenantId]
        );
        found = Boolean(staff);
      }
      if (!found) {
        const error = new Error('Instructor not found');
        error.statusCode = 404;
        throw error;
      }
    }

    const receptionId = d.receptionId || d.reception_id;
    if (receptionId) {
      const [[staff]] = await conn.query(
        `SELECT id FROM staff WHERE id=? AND tenant_id=? AND is_active=1 AND deleted_at IS NULL
          AND LOWER(role) IN ('reception_daqqi','daqqi_manager') LIMIT 1 FOR UPDATE`,
        [receptionId, req.tenantId]
      );
      if (!staff) {
        const error = new Error('Reception staff not found or has an invalid role');
        error.statusCode = 404;
        throw error;
      }
    }
    let savedCode = String(d.code || '');

    const [[existing]] = await conn.query(
      'SELECT id,code,status FROM daqqi_rounds WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [id, req.tenantId]
    );
    const transitions = { NEW: ['NEW', 'ACTIVE'], ACTIVE: ['ACTIVE', 'FINISHED'], FINISHED: ['FINISHED'] };
    if (existing && !transitions[existing.status]?.includes(status)) {
      const error = new Error(`Invalid round status transition: ${existing.status} -> ${status}`);
      error.statusCode = 409;
      throw error;
    }
    if (existing) {
      savedCode = String(existing.code || savedCode);
      await conn.query(
        `UPDATE daqqi_rounds SET course_id=?,instructor_id=?,instructor_name=?,reception_id=?,reception_name=?,
         day_of_week=?,start_date=?,time_slot=?,status=?,current_lecture=?,postponed_weeks_json=?,room=?
         WHERE id=? AND tenant_id=?`,
        [
          courseId, d.instructorId || d.instructor_id || null,
          d.instructorName || d.instructor_name || '', d.receptionId || d.reception_id || null,
          d.receptionName || d.reception_name || '', dayOfWeek,
          startDate, timeSlot, status,
          currentLecture, postponedJson, room, id, req.tenantId,
        ]
      );
    } else {
      await conn.query('SELECT id FROM tenants WHERE id=? FOR UPDATE', [req.tenantId]);
      const [[codeRow]] = await conn.query(
        "SELECT MAX(CAST(code AS UNSIGNED)) AS maxcode FROM daqqi_rounds WHERE tenant_id=? AND code REGEXP '^[0-9]+$'",
        [req.tenantId]
      );
      const nextDbCode = String(Math.max(Number(codeRow?.maxcode || 0) + 1, 3000));
      const code = nextDbCode;
      savedCode = String(code);
      await conn.query(
        `INSERT INTO daqqi_rounds
          (id,code,course_id,instructor_id,instructor_name,reception_id,reception_name,
           day_of_week,start_date,time_slot,status,current_lecture,postponed_weeks_json,created_at,room,tenant_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id, code, courseId,
          d.instructorId || d.instructor_id || null, d.instructorName || d.instructor_name || '',
          d.receptionId || d.reception_id || null, d.receptionName || d.reception_name || '',
          dayOfWeek, startDate, timeSlot, status,
          currentLecture, postponedJson,
          toMysqlDt(d.createdAt || new Date().toISOString()),
          room, req.tenantId,
        ]
      );
    }

    if (Array.isArray(d.attendees)) {
      const attendeeIds = d.attendees.map(a => String(a.subscriberId || a.subscriber_id || '')).filter(Boolean);
      if (attendeeIds.length !== new Set(attendeeIds).size || attendeeIds.length > 2000) {
        const error = new Error('Attendees must be unique and cannot exceed 2000 per round');
        error.statusCode = 400;
        throw error;
      }
      const [persistedAttendees] = existing
        ? await conn.query(
          `SELECT subscriber_id,attended_lectures FROM daqqi_attendees
            WHERE tenant_id=? AND round_id=? FOR UPDATE`,
          [req.tenantId, id]
        )
        : [[]];
      const persistedAttendance = new Map(
        persistedAttendees.map(attendee => [String(attendee.subscriber_id), Number(attendee.attended_lectures || 0)])
      );
      const removedWithHistory = persistedAttendees.find(attendee =>
        Number(attendee.attended_lectures || 0) > 0 && !attendeeIds.includes(String(attendee.subscriber_id))
      );
      if (removedWithHistory) {
        const error = new Error('An attendee with attendance history cannot be removed from a round');
        error.statusCode = 409;
        throw error;
      }
      await conn.query('DELETE FROM daqqi_attendees WHERE round_id=? AND tenant_id=?', [id, req.tenantId]);
      for (const a of d.attendees) {
        const subId = a.subscriberId || a.subscriber_id;
        if (!subId) continue;
        // An attendee already on this round is re-inserted on every save, because
        // the rows above are deleted and rebuilt. Now that an archived client
        // stays visible in the round (lib/daqqiAttendees.js), the desk posts them
        // back with everyone else — and requiring deleted_at IS NULL would fail
        // that row and take the whole save down with "Subscriber not found".
        // Keeping an existing booking is allowed; making a new one is not.
        const alreadyBooked = persistedAttendance.has(String(subId));
        const attendedLectures = existing ? (persistedAttendance.get(String(subId)) || 0) : 0;
        if (!Number.isInteger(attendedLectures) || attendedLectures < 0 || attendedLectures > currentLecture) {
          const error = new Error('attendedLectures must be an integer within the round lecture count');
          error.statusCode = 400;
          throw error;
        }
        const [attendeeInsert] = await conn.query(
          `INSERT INTO daqqi_attendees
             (round_id,subscriber_id,tenant_id,name,phone,booked_at,amount_paid,attended_lectures)
           SELECT ?,s.id,?,s.name,s.phone,?,
             COALESCE((
               SELECT SUM(p.amount_egp) FROM payments p
                WHERE p.tenant_id=s.tenant_id AND p.subscriber_id=s.id
                  AND p.status='paid' AND p.deleted_at IS NULL
                  AND (p.course_id=? OR EXISTS (
                    SELECT 1 FROM bundle_courses bc
                     WHERE bc.tenant_id=p.tenant_id AND bc.bundle_id=p.bundle_id AND bc.course_id=?
                  ))
             ),0),?
           FROM subscribers s
          WHERE s.id=? AND s.tenant_id=?${alreadyBooked ? '' : ' AND s.deleted_at IS NULL'}`,
          [
            id, req.tenantId,
            toMysqlDt(a.bookedAt || a.booked_at || new Date().toISOString()),
            courseId, courseId, attendedLectures,
            subId, req.tenantId,
          ]
        );
        if (attendeeInsert.affectedRows !== 1) {
          // "Subscriber not found" was the answer for an archived client too,
          // which sent the desk looking for a client that is plainly on screen.
          const [[known]] = await conn.query(
            'SELECT deleted_at FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
            [subId, req.tenantId]
          );
          const blockedAsArchived = Boolean(known && known.deleted_at);
          const error = new Error(blockedAsArchived
            ? 'An archived client cannot be booked into a round'
            : 'Subscriber not found');
          error.statusCode = blockedAsArchived ? 409 : 404;
          throw error;
        }
      }
    }
    await writeAuditEvent({
      action: existing ? 'DAQQI_ROUND_UPDATED' : 'DAQQI_ROUND_CREATED',
      entityType: 'DAQQI_ROUND',
      entityId: id,
      metadata: { courseId, status, currentLecture, attendeeCount: d.attendees?.length ?? null },
      req,
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true, id, code: savedCode });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    sendRouteError(res, e);
  } finally {
    conn.release();
  }
});

router.get('/api/admin/daqqi-rounds/:roundId/attendance', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  try {
    const [events] = await pool.query(
      `SELECT e.id,e.subscriber_id,e.session_number,e.status,e.source,e.marked_by,e.reason,e.marked_at,
              s.name,s.phone
         FROM daqqi_attendance_events e
         JOIN subscribers s
           ON s.id=e.subscriber_id AND s.tenant_id=e.tenant_id
        WHERE e.tenant_id=? AND e.round_id=?
        ORDER BY e.session_number DESC,e.marked_at DESC
        LIMIT 5000`,
      [req.tenantId, req.params.roundId]
    );
    res.json(events);
  } catch (error) {
    logger.error('[daqqi-attendance-list]', error.message);
    sendRouteError(res, error);
  }
});

router.post('/api/admin/daqqi-rounds/:roundId/attendance', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  const subscriberId = String(req.body?.subscriberId || '').trim();
  if (!subscriberId) return res.status(400).json({ error: 'subscriberId is required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[round]] = await conn.query(
      `SELECT id,status,current_lecture FROM daqqi_rounds
        WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.roundId, req.tenantId]
    );
    if (!round) {
      await conn.rollback();
      return res.status(404).json({ error: 'Round not found' });
    }
    // A round is created NEW with current_lecture 0, and nothing in the schedule
    // tab moves it on — so taking attendance was impossible for every round the
    // desk had actually made: always 409, "active round with a current lecture".
    //
    // Marking attendance IS the act of starting the session, so treat it that
    // way instead of demanding someone first find a separate control that does
    // not exist. A NEW round becomes ACTIVE on its first attendance, and a round
    // still on lecture 0 moves to lecture 1. A FINISHED round is still refused:
    // that one is a real state, not a missing step.
    if (round.status === 'FINISHED') {
      await conn.rollback();
      return res.status(409).json({ error: 'Attendance cannot be marked for a finished round', code: 'ROUND_FINISHED' });
    }
    if (round.status !== 'ACTIVE' || Number(round.current_lecture) < 1) {
      await conn.query(
        `UPDATE daqqi_rounds
            SET status='ACTIVE', current_lecture=GREATEST(COALESCE(current_lecture,0),1)
          WHERE id=? AND tenant_id=?`,
        [round.id, req.tenantId]
      );
      round.status = 'ACTIVE';
      round.current_lecture = Math.max(Number(round.current_lecture) || 0, 1);
    }
    const sessionNumber = req.body?.sessionNumber === undefined
      ? Number(round.current_lecture)
      : Number(req.body.sessionNumber);
    if (!Number.isInteger(sessionNumber) || sessionNumber < 1 || sessionNumber > Number(round.current_lecture)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Invalid sessionNumber' });
    }
    const [[attendee]] = await conn.query(
      `SELECT attended_lectures FROM daqqi_attendees
        WHERE tenant_id=? AND round_id=? AND subscriber_id=? LIMIT 1 FOR UPDATE`,
      [req.tenantId, req.params.roundId, subscriberId]
    );
    if (!attendee) {
      await conn.rollback();
      return res.status(404).json({ error: 'Attendee not found in round' });
    }
    if (Number(attendee.attended_lectures || 0) >= sessionNumber) {
      await conn.rollback();
      return res.status(409).json({ error: 'Attendance is already recorded for this session' });
    }
    const eventId = uuidv4();
    await conn.query(
      `INSERT INTO daqqi_attendance_events
        (id,tenant_id,round_id,subscriber_id,session_number,status,source,marked_by)
       VALUES (?,?,?,?,?,'PRESENT','MANUAL',?)`,
      [eventId, req.tenantId, req.params.roundId, subscriberId, sessionNumber,
        req.staffRecord?.id || req.user?.uid || null]
    );
    await conn.query(
      `UPDATE daqqi_attendees SET attended_lectures=attended_lectures+1
        WHERE tenant_id=? AND round_id=? AND subscriber_id=?`,
      [req.tenantId, req.params.roundId, subscriberId]
    );
    await writeAuditEvent({
      action: 'DAQQI_ATTENDANCE_MARKED',
      entityType: 'DAQQI_ATTENDANCE',
      entityId: eventId,
      metadata: { roundId: req.params.roundId, subscriberId, sessionNumber },
      req,
      db: conn,
    });
    const attendedLectures = Number(attendee.attended_lectures || 0) + 1;
    await conn.commit();
    res.status(201).json({ ok: true, id: eventId, sessionNumber, attendedLectures });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Attendance is already recorded for this session' });
    }
    logger.error('[daqqi-attendance-mark]', error.message);
    sendRouteError(res, error);
  } finally {
    conn.release();
  }
});

router.post('/api/admin/daqqi-rounds/transfer-attendee', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  const { subscriberId, fromRoundId, toRoundId } = req.body || {};
  if (!subscriberId || !fromRoundId || !toRoundId || fromRoundId === toRoundId) {
    return res.status(400).json({ error: 'Valid subscriberId, fromRoundId and toRoundId are required' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rounds] = await conn.query(
      'SELECT id FROM daqqi_rounds WHERE tenant_id=? AND id IN (?,?) FOR UPDATE',
      [req.tenantId, fromRoundId, toRoundId],
    );
    if (rounds.length !== 2) {
      await conn.rollback();
      return res.status(404).json({ error: 'Source or target round not found' });
    }
    const [[source]] = await conn.query(
      `SELECT name, phone, booked_at, amount_paid, attended_lectures
         FROM daqqi_attendees
        WHERE tenant_id=? AND round_id=? AND subscriber_id=? LIMIT 1 FOR UPDATE`,
      [req.tenantId, fromRoundId, subscriberId],
    );
    if (!source) {
      await conn.rollback();
      return res.status(404).json({ error: 'Attendee not found in source round' });
    }
    if (Number(source.attended_lectures || 0) > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'Cannot transfer an attendee after attendance has started; preserve round history' });
    }
    const [[duplicate]] = await conn.query(
      `SELECT subscriber_id FROM daqqi_attendees
        WHERE tenant_id=? AND round_id=? AND subscriber_id=? LIMIT 1 FOR UPDATE`,
      [req.tenantId, toRoundId, subscriberId],
    );
    if (duplicate) {
      await conn.rollback();
      return res.status(409).json({ error: 'Attendee already exists in target round' });
    }
    await conn.query(
      'DELETE FROM daqqi_attendees WHERE tenant_id=? AND round_id=? AND subscriber_id=?',
      [req.tenantId, fromRoundId, subscriberId],
    );
    await conn.query(
      `INSERT INTO daqqi_attendees
        (round_id, subscriber_id, tenant_id, name, phone, booked_at, amount_paid, attended_lectures)
       VALUES (?,?,?,?,?,?,?,?)`,
      [toRoundId, subscriberId, req.tenantId, source.name, source.phone, new Date(),
       source.amount_paid, source.attended_lectures],
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[daqqi-transfer-attendee]', e.message);
    sendRouteError(res, e);
  } finally {
    conn.release();
  }
});

// DELETE /api/admin/daqqi-rounds/:roundId/attendees/:subscriberId
//
// Taking one client off a round is a roster change, so it touches one row.
// The admin used to do this by sending the whole round back with the client
// filtered out, which put it through the round upsert and its validation —
// and rounds saved before start_date was required could not pass, so removing
// a client from one of them was refused for a reason that had nothing to do
// with the client.
router.delete('/api/admin/daqqi-rounds/:roundId/attendees/:subscriberId', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[round]] = await conn.query(
      'SELECT id FROM daqqi_rounds WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.roundId, req.tenantId]
    );
    if (!round) {
      await conn.rollback();
      return res.status(404).json({ error: 'Round not found' });
    }
    const [result] = await conn.query(
      'DELETE FROM daqqi_attendees WHERE tenant_id=? AND round_id=? AND subscriber_id=?',
      [req.tenantId, req.params.roundId, req.params.subscriberId]
    );
    if (!result.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ error: 'Client is not booked into this round' });
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[daqqi]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

router.delete('/api/admin/daqqi-rounds/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[round]] = await conn.query(
      `SELECT r.id,r.status,
              (SELECT COUNT(*) FROM daqqi_attendees a
                WHERE a.tenant_id=r.tenant_id AND a.round_id=r.id) AS attendee_count
         FROM daqqi_rounds r WHERE r.id=? AND r.tenant_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id, req.tenantId]
    );
    if (!round) {
      await conn.rollback();
      return res.status(404).json({ error: 'Round not found' });
    }
    if (Number(round.attendee_count) > 0 || round.status !== 'NEW') {
      await conn.rollback();
      return res.status(409).json({ error: 'Only an empty NEW round can be deleted; retain operational history' });
    }
    const [result] = await conn.query(
      'DELETE FROM daqqi_rounds WHERE id=? AND tenant_id=?',
      [req.params.id, req.tenantId]
    );
    if (!result.affectedRows) throw new Error('Round delete lost its lock');
    await writeAuditEvent({
      action: 'DAQQI_ROUND_DELETED',
      entityType: 'DAQQI_ROUND',
      entityId: req.params.id,
      req,
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    sendRouteError(res, e);
  } finally {
    conn.release();
  }
});

// ── Attendance report: all rounds (or filtered by status) with per-attendee stats ──
router.get('/api/admin/daqqi/attendance-report', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  try {
    const { status } = req.query; // 'active' | 'finished' | '' (all)
    const statusFilter = status && ['NEW','ACTIVE','FINISHED'].includes(String(status).toUpperCase())
      ? String(status).toUpperCase() : null;

    const [rounds] = await pool.query(
      `SELECT id, code, course_id, instructor_name, reception_name,
              day_of_week, start_date, time_slot, status, current_lecture
       FROM daqqi_rounds
       WHERE tenant_id=? ${statusFilter ? 'AND status = ?' : ''}
       ORDER BY start_date DESC LIMIT 300`,
      statusFilter ? [req.tenantId, statusFilter] : [req.tenantId]
    );

    if (!rounds.length) return res.json([]);

    const roundIds = rounds.map(r => r.id);
    const attendees = await getDaqqiAttendees(pool, req.tenantId, roundIds);

    const attMap = {};
    for (const a of attendees) {
      if (!attMap[a.round_id]) attMap[a.round_id] = [];
      attMap[a.round_id].push(a);
    }

    const tsMap = { MORNING: 'صباحاً', NOON: 'ظهراً', EVENING: 'مساءً' };
    const result = rounds.map(r => {
      const atts = attMap[r.id] || [];
      const totalSessions = Number(r.current_lecture || 0);
      return {
        id: r.id,
        code: r.code,
        courseId: r.course_id,
        instructorName: r.instructor_name,
        receptionName: r.reception_name,
        dayOfWeek: r.day_of_week,
        startDate: ymd(r.start_date),
        timeSlot: tsMap[r.time_slot] || r.time_slot,
        status: (r.status || 'NEW').toLowerCase(),
        totalSessions,
        attendeeCount: atts.length,
        archivedAttendeeCount: atts.filter(a => Number(a.archived || 0) === 1).length,
        attendees: atts.map(a => ({
          subscriberId: a.subscriber_id,
          name: a.name,
          phone: a.phone,
          bookedAt: ymd(a.booked_at),
          amountPaid: Number(a.amount_paid || 0),
          attendedLectures: Number(a.attended_lectures || 0),
          archived: Boolean(Number(a.archived || 0)),
          absentLectures: totalSessions > 0 ? Math.max(0, totalSessions - Number(a.attended_lectures || 0)) : 0,
          attendancePct: totalSessions > 0 ? Math.round((Number(a.attended_lectures || 0) / totalSessions) * 100) : null,
        })),
      };
    });

    res.json(result);
  } catch (e) {
    logger.error('[daqqi/attendance-report]', e.message);
    sendRouteError(res, e);
  }
});

// ── Attendance CSV export ──
router.get('/api/admin/daqqi/attendance-export', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, bulkOperationLimiter, async (req, res) => {
  try {
    const { status } = req.query;
    const statusFilter = status && ['NEW','ACTIVE','FINISHED'].includes(String(status).toUpperCase())
      ? String(status).toUpperCase() : null;

    const [rounds] = await pool.query(
      `SELECT id, code, course_id, instructor_name, reception_name,
              day_of_week, start_date, time_slot, status, current_lecture
       FROM daqqi_rounds
       WHERE tenant_id=? ${statusFilter ? 'AND status = ?' : ''}
       ORDER BY start_date DESC LIMIT 300`,
      statusFilter ? [req.tenantId, statusFilter] : [req.tenantId]
    );

    if (!rounds.length) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send('﻿لا توجد بيانات');
    }

    const roundIds = rounds.map(r => r.id);
    const attendees = await getDaqqiAttendees(pool, req.tenantId, roundIds);

    const attMap = {};
    for (const a of attendees) {
      if (!attMap[a.round_id]) attMap[a.round_id] = [];
      attMap[a.round_id].push(a);
    }

    const rows = [];
    const headers = ['كود الدورة', 'المحاضر', 'يوم الأسبوع', 'تاريخ البدء', 'الوقت', 'الحالة', 'إجمالي الجلسات', 'اسم المتدرب', 'رقم الهاتف', 'تاريخ التسجيل', 'جلسات الحضور', 'جلسات الغياب', 'نسبة الحضور%', 'حالة العميل'];
    rows.push(headers);

    for (const r of rounds) {
      const total = Number(r.current_lecture || 0);
      const statusAr = { NEW: 'جديدة', ACTIVE: 'نشطة', FINISHED: 'منتهية' }[r.status] || r.status;
      const atts = attMap[r.id] || [];
      if (!atts.length) {
        rows.push([r.code, r.instructor_name, r.day_of_week, ymd(r.start_date), r.time_slot, statusAr, total, '—', '', '', '', '', '', '']);
      } else {
        for (const a of atts) {
          const pct = total > 0 ? Math.round((Number(a.attended_lectures || 0) / total) * 100) : '';
          rows.push([r.code, r.instructor_name, r.day_of_week, ymd(r.start_date), r.time_slot, statusAr, total, a.name, a.phone, ymd(a.booked_at), Number(a.attended_lectures || 0), total > 0 ? Math.max(0, total - Number(a.attended_lectures || 0)) : 0, pct !== '' ? `${pct}%` : '', Number(a.archived || 0) === 1 ? 'مؤرشف' : 'نشط']);
        }
      }
    }

    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="daqqi_attendance_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (e) {
    logger.error('[daqqi/attendance-export]', e.message);
    sendRouteError(res, e);
  }
});

// ── Monthly attendance report — aggregate rounds by month ──
router.get('/api/admin/daqqi/attendance-monthly', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  try {
    const months = Math.min(24, Math.max(1, Number(req.query.months) || 12));

    const [rounds] = await pool.query(
      `SELECT id, reception_name, instructor_name, start_date, status, current_lecture
       FROM daqqi_rounds
       WHERE tenant_id=? AND start_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
       ORDER BY start_date DESC LIMIT 1000`,
      [req.tenantId, months]
    );

    if (!rounds.length) return res.json({ months: [], totals: null });

    const roundIds = rounds.map(r => r.id);
    const attendees = await getDaqqiAttendees(pool, req.tenantId, roundIds);

    const attByRound = {};
    for (const a of attendees) {
      (attByRound[a.round_id] = attByRound[a.round_id] || []).push(a);
    }

    // Aggregate per month
    const monthMap = {};
    for (const r of rounds) {
      if (!r.start_date) continue;
      const key = ymd(r.start_date).slice(0, 7); // YYYY-MM
      const m = (monthMap[key] = monthMap[key] || {
        month: key, rounds: 0, attendees: 0, sessions: 0,
        revenue: 0, pctSum: 0, pctCount: 0, receptions: {},
      });
      const atts = attByRound[r.id] || [];
      const sessions = Number(r.current_lecture || 0);
      m.rounds += 1;
      m.attendees += atts.length;
      m.sessions += sessions;
      for (const a of atts) {
        m.revenue += Number(a.amount_paid || 0);
        if (sessions > 0) {
          m.pctSum += Math.min(100, Math.round((Number(a.attended_lectures || 0) / sessions) * 100));
          m.pctCount += 1;
        }
      }
      const rec = r.reception_name || 'غير محدد';
      m.receptions[rec] = (m.receptions[rec] || 0) + atts.length;
    }

    const monthsOut = Object.values(monthMap)
      .sort((a, b) => b.month.localeCompare(a.month))
      .map(m => ({
        month: m.month,
        rounds: m.rounds,
        attendees: m.attendees,
        sessions: m.sessions,
        revenue: m.revenue,
        avgAttendancePct: m.pctCount ? Math.round(m.pctSum / m.pctCount) : null,
        topReception: Object.entries(m.receptions).sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
      }));

    const totals = monthsOut.reduce((t, m) => ({
      rounds: t.rounds + m.rounds,
      attendees: t.attendees + m.attendees,
      sessions: t.sessions + m.sessions,
      revenue: t.revenue + m.revenue,
    }), { rounds: 0, attendees: 0, sessions: 0, revenue: 0 });
    const allPct = monthsOut.filter(m => m.avgAttendancePct !== null);
    totals.avgAttendancePct = allPct.length
      ? Math.round(allPct.reduce((s, m) => s + m.avgAttendancePct, 0) / allPct.length)
      : null;

    res.json({ months: monthsOut, totals });
  } catch (e) {
    logger.error('[daqqi/attendance-monthly]', e.message);
    sendRouteError(res, e);
  }
});

module.exports = router;
