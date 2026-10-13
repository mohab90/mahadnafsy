'use strict';

// «بيانات الشهادة»: the button on every client's page for collection and customer
// service — the client's English name, national id, and the dates each of their
// courses ran. «اي عميل في صفحته لازم يكون في زر بيظهر للتحصيل وخدمة العملاء اسمه
// بيانات الشهادة يقدر يدخل فيه اسم العميل بالانجليزي وتاريخ الكورس البداية والنهاية
// والرقم القومي» (13 Oct 2026).
//
//   GET /api/admin/subscribers/:id/certificate-data
//   PUT /api/admin/subscribers/:id/certificate-data
//
// The name and the id are the CLIENT's (subscribers.name_en / national_id), so every
// certificate — the institute's free one, a board's, an attestation — reads them from
// one place; the dates are the ENROLMENT's (enrollments.course_start_date / _end_date).
// Saving also fills the same blanks on that client's open certificate requests.

const express = require('express');
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');
const { requireAuth, requireAdminOrStaff, requireAnyPermission } = require('../../middleware/auth');
const { financialRecordMatches, resolveFinancialScope } = require('../../lib/financialScope');
const { checkEnglishName, checkNationalId } = require('../../lib/bookingIdentity');
const { actorName, logClientEvent } = require('../../lib/clientHistory');
const { dateOnlyInTimeZone, safeDateOnly } = require('../../lib/dates');

const router = express.Router();
const GUARD = [requireAuth, requireAdminOrStaff, requireAnyPermission('manage_certificates', 'manage_financial')];
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
// A DATE column is a calendar day as it stands; a DATETIME is UTC, read as the institute's day in Cairo.
const calendarDay = value => (value ? safeDateOnly(value) || null : null);
const cairoDay = value => (value ? dateOnlyInTimeZone(new Date(value)) : null);

async function loadSubscriber(req, db = pool, lock = false) {
  const [[row]] = await db.query(
    `SELECT id, name, name_en, national_id, nationality, client_code, branch_id, assigned_cs_id, assigned_sales_id,
            personal_photo_url, id_photo_url
       FROM subscribers WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [req.tenantId, req.params.id]);
  if (!row) return { status: 404, error: 'العميل مش موجود' };
  let scope;
  try { scope = resolveFinancialScope(req, { allowAssigned: true }); } catch { scope = null; }
  if (!scope || !financialRecordMatches(scope, row)) return { status: 403, error: 'العميل ده خارج نطاق صلاحياتك' };
  return { row };
}

const isEgyptian = row => !row.nationality || String(row.nationality).toUpperCase() === 'EGYPTIAN';

router.get('/api/admin/subscribers/:id/certificate-data', ...GUARD, async (req, res) => {
  try {
    const found = await loadSubscriber(req);
    if (found.error) return res.status(found.status).json({ error: found.error });
    const { row } = found;
    const [courses] = await pool.query(
      `SELECT e.course_id, e.course_start_date, e.course_end_date, e.enrolled_at, e.completed_at,
              COALESCE(NULLIF(c.title_ar, ''), c.title) AS title, c.title_en,
              (SELECT MIN(dr.start_date) FROM daqqi_attendees da
                 JOIN daqqi_rounds dr ON dr.id = da.round_id AND dr.tenant_id = da.tenant_id
                WHERE da.tenant_id = e.tenant_id AND da.subscriber_id = e.subscriber_id AND dr.course_id = e.course_id) AS round_start
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id AND c.tenant_id = e.tenant_id AND c.deleted_at IS NULL
        WHERE e.tenant_id = ? AND e.subscriber_id = ? AND e.course_id IS NOT NULL AND e.status = 'active'
        ORDER BY e.enrolled_at DESC`,
      [req.tenantId, row.id]);
    res.json({
      id: row.id, name: row.name, clientCode: row.client_code || null,
      nameEn: row.name_en || '', nationalId: row.national_id || '', egyptian: isEgyptian(row),
      courses: courses.map(course => ({
        courseId: course.course_id, title: course.title || '', titleEn: course.title_en || null,
        start: calendarDay(course.course_start_date), end: calendarDay(course.course_end_date),
        // What the system knows when nobody typed it: the Dokki round, else the enrolment; the end, once completed.
        suggestedStart: calendarDay(course.round_start) || cairoDay(course.enrolled_at),
        suggestedEnd: cairoDay(course.completed_at),
      })),
    });
  } catch (error) {
    logger.error('[certificate-data/get]', error.message);
    res.status(500).json({ error: 'تعذّر قراءة بيانات الشهادة' });
  }
});

router.put('/api/admin/subscribers/:id/certificate-data', ...GUARD, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const body = req.body || {};
    await conn.beginTransaction();
    const found = await loadSubscriber(req, conn, true);
    if (found.error) { await conn.rollback(); return res.status(found.status).json({ error: found.error }); }
    const { row } = found;

    const english = checkEnglishName(body.nameEn);
    if (!english.ok) { await conn.rollback(); return res.status(400).json({ error: english.error, code: 'NAME_EN_INVALID' }); }
    const id = checkNationalId(body.nationalId, { egyptian: isEgyptian(row) });
    if (!id.ok) { await conn.rollback(); return res.status(400).json({ error: id.error, code: 'NATIONAL_ID_INVALID' }); }
    const dates = [];
    for (const course of Array.isArray(body.courses) ? body.courses : []) {
      const start = isDate(course.start) ? String(course.start) : null;
      const end = isDate(course.end) ? String(course.end) : null;
      if (start && end && end < start) {
        await conn.rollback();
        return res.status(400).json({ error: 'تاريخ نهاية الكورس قبل تاريخ بدايته', code: 'COURSE_DATES_INVALID' });
      }
      if (course.courseId && (start || end)) dates.push({ courseId: String(course.courseId), start, end });
    }

    if (id.value) {
      const [[other]] = await conn.query(
        'SELECT name, client_code FROM subscribers WHERE tenant_id = ? AND national_id = ? AND id <> ? AND deleted_at IS NULL LIMIT 1',
        [req.tenantId, id.value, row.id]);
      if (other) {
        await conn.rollback();
        return res.status(409).json({ error: `الرقم القومي ده متسجل لعميل تاني: ${other.name || ''}${other.client_code ? ` (${other.client_code})` : ''}`, code: 'NATIONAL_ID_TAKEN' });
      }
    }
    // The desk is SETTING these (unlike a booking, which only fills blanks): what is typed replaces.
    if (english.value || id.value) {
      await conn.query(
        'UPDATE subscribers SET name_en = COALESCE(?, name_en), national_id = COALESCE(?, national_id) WHERE id = ? AND tenant_id = ?',
        [english.value, id.value, row.id, req.tenantId]);
    }
    for (const date of dates) {
      await conn.query(
        `UPDATE enrollments SET course_start_date = COALESCE(?, course_start_date), course_end_date = COALESCE(?, course_end_date)
          WHERE tenant_id = ? AND subscriber_id = ? AND course_id = ?`,
        [date.start, date.end, req.tenantId, row.id, date.courseId]);
      // The same blanks on this course's open certificate requests.
      await conn.query(
        `UPDATE certificate_requests
            SET course_start_date = COALESCE(course_start_date, ?), course_end_date = COALESCE(course_end_date, ?)
          WHERE tenant_id = ? AND subscriber_id = ? AND course_id = ? AND status <> 'DELIVERED'`,
        [date.start, date.end, req.tenantId, row.id, date.courseId]);
    }
    if (english.value || id.value) {
      await conn.query(
        `UPDATE certificate_requests
            SET name_en = COALESCE(NULLIF(name_en, ''), ?), id_number = COALESCE(NULLIF(id_number, ''), ?)
          WHERE tenant_id = ? AND subscriber_id = ? AND status <> 'DELIVERED'`,
        [english.value, id.value, req.tenantId, row.id]);
    }
    await logClientEvent(conn, {
      tenantId: req.tenantId, subscriberId: row.id, action: 'certificate_data', actor: actorName(req),
      label: `بيانات الشهادة${english.value ? ` · ${english.value}` : ''}${id.value ? ' · الرقم القومي' : ''}${dates.length ? ` · تواريخ ${dates.length} كورس` : ''}`,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'الرقم القومي ده متسجل لعميل تاني', code: 'NATIONAL_ID_TAKEN' });
    logger.error('[certificate-data/put]', error.message);
    res.status(500).json({ error: 'تعذّر حفظ بيانات الشهادة' });
  } finally { conn.release(); }
});

module.exports = router;
