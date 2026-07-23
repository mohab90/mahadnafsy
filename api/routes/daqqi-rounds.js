'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');
function sendRouteError(res, err) {
  if (res.headersSent) return;
  const dbCodes = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'ER_SERVER_LOST']);
  const status = err && dbCodes.has(err.code) ? 503 : 500;
  res.status(status).json({ error: status === 503 ? 'Database unavailable' : 'Internal server error' });
}


// MariaDB DATETIME columns reject ISO-8601 strings ("2026-07-12T03:25:31.525Z")
// under STRICT_TRANS_TABLES. Normalise any date-ish value to "YYYY-MM-DD HH:MM:SS"
// (a bare "YYYY-MM-DD" is left as-is, which the column accepts as midnight).
function toMysqlDt(v) {
  if (v == null || v === '') return null;
  return String(v).slice(0, 19).replace('T', ' ');
}

// Shared by every Dokki-schedule route below — was only actually applied to
// GET /api/admin/daqqi-rounds; the attendance-report/export/monthly routes had no
// role check at all, so e.g. a SALES or HR account could pull every Dokki attendee's
// name/phone/payments via CSV export.
const DAQQI_ALLOWED_ROLES = new Set(['MANAGER', 'ADMIN', 'DAQQI_MANAGER', 'RECEPTION_DAQQI', 'INSTRUCTOR', 'TRAINER']);
function requireDaqqiAccess(req, res, next) {
  const role = (req.staffRecord?.role || '').toUpperCase();
  if (req.staffRecord && !req.isSuperAdmin && !DAQQI_ALLOWED_ROLES.has(role)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

router.get('/api/admin/daqqi-rounds', requireAuth, requireAdminOrStaff, requireDaqqiAccess, async (req, res) => {
  try {
    const [rounds] = await pool.query(
      `SELECT id, code, course_id, instructor_id, instructor_name, reception_id, reception_name,
       day_of_week, start_date, time_slot, status, current_lecture, postponed_weeks_json, created_at
       FROM daqqi_rounds ORDER BY created_at DESC LIMIT 500`
    );
    if (rounds.length === 0) return res.json([]);

    const [attendees] = await pool.query(
      'SELECT round_id, subscriber_id, name, phone, booked_at, amount_paid, attended_lectures FROM daqqi_attendees'
    );
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
      startDate: r.start_date ? String(r.start_date).slice(0, 10) : '',
      timeSlot: tsMap[r.time_slot] || 'مساءً',
      status: (r.status || 'NEW').toLowerCase(),
      currentLecture: Number(r.current_lecture || 0),
      postponedWeeks: r.postponed_weeks_json ? (() => {
        try { return JSON.parse(r.postponed_weeks_json); } catch { return []; }
      })() : [],
      createdAt: r.created_at ? String(r.created_at) : '',
      attendees: (attendeesMap[r.id] || []).map(a => ({
        subscriberId: a.subscriber_id,
        name: a.name,
        phone: a.phone,
        bookedAt: a.booked_at ? String(a.booked_at) : '',
        amountPaid: Number(a.amount_paid || 0),
        attendedLectures: Number(a.attended_lectures || 0),
      })),
    }));
    res.json(result);
  } catch (e) {
    logger.error('[route]', e.message);
    sendRouteError(res, e);
  }
});

router.post('/api/admin/daqqi-rounds', requireAuth, requireAdminOrStaff, async (req, res) => {
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
    const tsMap = { 'صباحاً': 'MORNING', 'ظهراً': 'NOON', 'مساءً': 'EVENING' };
    const stMap = { new: 'NEW', active: 'ACTIVE', finished: 'FINISHED' };
    const timeSlot = tsMap[d.timeSlot] || tsMap[d.time_slot] || 'EVENING';
    const status = stMap[(d.status || '').toLowerCase()] || 'NEW';
    const startDate = toMysqlDt(d.startDate || d.start_date || null);
    const postponedJson = d.postponedWeeks ? JSON.stringify(d.postponedWeeks) : (d.postponed_weeks_json || null);

    const [[existing]] = await conn.query('SELECT id FROM daqqi_rounds WHERE id = ? LIMIT 1', [id]);
    if (existing) {
      await conn.query(
        `UPDATE daqqi_rounds SET course_id=?,instructor_id=?,instructor_name=?,reception_id=?,reception_name=?,
         day_of_week=?,start_date=?,time_slot=?,status=?,current_lecture=?,postponed_weeks_json=? WHERE id=?`,
        [
          d.courseId || d.course_id || '', d.instructorId || d.instructor_id || null,
          d.instructorName || d.instructor_name || '', d.receptionId || d.reception_id || null,
          d.receptionName || d.reception_name || '', d.dayOfWeek || d.day_of_week || '',
          startDate, timeSlot, status,
          Number(d.currentLecture || d.current_lecture || 0), postponedJson, id,
        ]
      );
    } else {
      const [[codeRow]] = await conn.query("SELECT MAX(CAST(code AS UNSIGNED)) as maxcode FROM daqqi_rounds WHERE code REGEXP '^[0-9]+$'");
      const nextDbCode = String(Math.max(Number(codeRow?.maxcode || 0) + 1, 3000));
      const code = d.code || nextDbCode;
      await conn.query(
        `INSERT INTO daqqi_rounds
          (id,code,course_id,instructor_id,instructor_name,reception_id,reception_name,
           day_of_week,start_date,time_slot,status,current_lecture,postponed_weeks_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id, code, d.courseId || d.course_id || '',
          d.instructorId || d.instructor_id || null, d.instructorName || d.instructor_name || '',
          d.receptionId || d.reception_id || null, d.receptionName || d.reception_name || '',
          d.dayOfWeek || d.day_of_week || '', startDate, timeSlot, status,
          Number(d.currentLecture || d.current_lecture || 0), postponedJson,
          toMysqlDt(d.createdAt || new Date().toISOString()),
        ]
      );
    }

    if (Array.isArray(d.attendees)) {
      await conn.query('DELETE FROM daqqi_attendees WHERE round_id = ?', [id]);
      for (const a of d.attendees) {
        const subId = a.subscriberId || a.subscriber_id;
        if (!subId) continue;
        await conn.query(
          `INSERT INTO daqqi_attendees (round_id,subscriber_id,name,phone,booked_at,amount_paid,attended_lectures)
           VALUES (?,?,?,?,?,?,?)`,
          [
            id, subId, a.name || '', a.phone || '',
            toMysqlDt(a.bookedAt || a.booked_at || new Date().toISOString()),
            Number(a.amountPaid || a.amount_paid || 0), Number(a.attendedLectures || a.attended_lectures || 0),
          ]
        );
      }
    }
    await conn.commit();
    res.json({ ok: true, id });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[route]', e.message);
    sendRouteError(res, e);
  } finally {
    conn.release();
  }
});

router.delete('/api/admin/daqqi-rounds/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM daqqi_rounds WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    sendRouteError(res, e);
  }
});

// ── Attendance report: all rounds (or filtered by status) with per-attendee stats ──
router.get('/api/admin/daqqi/attendance-report', requireAuth, requireAdminOrStaff, requireDaqqiAccess, async (req, res) => {
  try {
    const { status } = req.query; // 'active' | 'finished' | '' (all)
    const statusFilter = status && ['NEW','ACTIVE','FINISHED'].includes(String(status).toUpperCase())
      ? String(status).toUpperCase() : null;

    const [rounds] = await pool.query(
      `SELECT id, code, course_id, instructor_name, reception_name,
              day_of_week, start_date, time_slot, status, current_lecture
       FROM daqqi_rounds
       ${statusFilter ? 'WHERE status = ?' : ''}
       ORDER BY start_date DESC LIMIT 300`,
      statusFilter ? [statusFilter] : []
    );

    if (!rounds.length) return res.json([]);

    const roundIds = rounds.map(r => r.id);
    const [attendees] = await pool.query(
      `SELECT round_id, subscriber_id, name, phone, booked_at, amount_paid, attended_lectures
       FROM daqqi_attendees WHERE round_id IN (${roundIds.map(() => '?').join(',')})`,
      roundIds
    );

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
        startDate: r.start_date ? String(r.start_date).slice(0, 10) : '',
        timeSlot: tsMap[r.time_slot] || r.time_slot,
        status: (r.status || 'NEW').toLowerCase(),
        totalSessions,
        attendeeCount: atts.length,
        attendees: atts.map(a => ({
          subscriberId: a.subscriber_id,
          name: a.name,
          phone: a.phone,
          bookedAt: a.booked_at ? String(a.booked_at).slice(0, 10) : '',
          amountPaid: Number(a.amount_paid || 0),
          attendedLectures: Number(a.attended_lectures || 0),
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
router.get('/api/admin/daqqi/attendance-export', requireAuth, requireAdminOrStaff, requireDaqqiAccess, bulkOperationLimiter, async (req, res) => {
  try {
    const { status } = req.query;
    const statusFilter = status && ['NEW','ACTIVE','FINISHED'].includes(String(status).toUpperCase())
      ? String(status).toUpperCase() : null;

    const [rounds] = await pool.query(
      `SELECT id, code, course_id, instructor_name, reception_name,
              day_of_week, start_date, time_slot, status, current_lecture
       FROM daqqi_rounds
       ${statusFilter ? 'WHERE status = ?' : ''}
       ORDER BY start_date DESC LIMIT 300`,
      statusFilter ? [statusFilter] : []
    );

    if (!rounds.length) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send('﻿لا توجد بيانات');
    }

    const roundIds = rounds.map(r => r.id);
    const [attendees] = await pool.query(
      `SELECT round_id, name, phone, booked_at, amount_paid, attended_lectures
       FROM daqqi_attendees WHERE round_id IN (${roundIds.map(() => '?').join(',')})`,
      roundIds
    );

    const attMap = {};
    for (const a of attendees) {
      if (!attMap[a.round_id]) attMap[a.round_id] = [];
      attMap[a.round_id].push(a);
    }

    const rows = [];
    const headers = ['كود الدورة', 'المحاضر', 'يوم الأسبوع', 'تاريخ البدء', 'الوقت', 'الحالة', 'إجمالي الجلسات', 'اسم المتدرب', 'رقم الهاتف', 'تاريخ التسجيل', 'جلسات الحضور', 'جلسات الغياب', 'نسبة الحضور%'];
    rows.push(headers);

    for (const r of rounds) {
      const total = Number(r.current_lecture || 0);
      const statusAr = { NEW: 'جديدة', ACTIVE: 'نشطة', FINISHED: 'منتهية' }[r.status] || r.status;
      const atts = attMap[r.id] || [];
      if (!atts.length) {
        rows.push([r.code, r.instructor_name, r.day_of_week, String(r.start_date || '').slice(0,10), r.time_slot, statusAr, total, '—', '', '', '', '', '']);
      } else {
        for (const a of atts) {
          const pct = total > 0 ? Math.round((Number(a.attended_lectures || 0) / total) * 100) : '';
          rows.push([r.code, r.instructor_name, r.day_of_week, String(r.start_date || '').slice(0,10), r.time_slot, statusAr, total, a.name, a.phone, String(a.booked_at || '').slice(0,10), Number(a.attended_lectures || 0), total > 0 ? Math.max(0, total - Number(a.attended_lectures || 0)) : 0, pct !== '' ? `${pct}%` : '']);
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
router.get('/api/admin/daqqi/attendance-monthly', requireAuth, requireAdminOrStaff, requireDaqqiAccess, async (req, res) => {
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
    // Revenue = LIVE per-course paid amount from the payments ledger (same logic the
    // Financial tab + DaqqiScheduleTab use: this subscriber's paid EGP payments for the
    // round's course, or uncategorised), so the rounds report matches the accounting
    // instead of a stored amount_paid that can go stale. COALESCE falls back to the
    // stored value for walk-ins / attendees with no linked subscriber.
    const [attendees] = await pool.query(
      `SELECT da.round_id, da.attended_lectures,
              COALESCE((
                SELECT SUM(p.amount_egp) FROM payments p
                WHERE p.tenant_id=da.tenant_id AND p.subscriber_id = da.subscriber_id
                  AND p.status = 'paid'
                  AND (p.course_id = dr.course_id OR p.course_id IS NULL)
              ), da.amount_paid, 0) AS amount_paid
       FROM daqqi_attendees da
       JOIN daqqi_rounds dr ON dr.id = da.round_id AND dr.tenant_id=da.tenant_id
       WHERE da.tenant_id=? AND da.round_id IN (${roundIds.map(() => '?').join(',')})`,
      [req.tenantId, ...roundIds]
    );

    const attByRound = {};
    for (const a of attendees) {
      (attByRound[a.round_id] = attByRound[a.round_id] || []).push(a);
    }

    // Aggregate per month
    const monthMap = {};
    for (const r of rounds) {
      if (!r.start_date) continue;
      const key = String(r.start_date).slice(0, 7); // YYYY-MM
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
