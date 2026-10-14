'use strict';
/**
 * The steps between "someone applied" and "someone was interviewed".
 *
 * طلبات الانضمام previously offered four statuses and one overwritable note
 * field, which cannot express what the desk actually does: ring the applicant,
 * record that the call happened and who made it, and only then accept or reject
 * based on how it went. Two people working the list had no way to see that an
 * applicant had already been called.
 *
 * Every write here lands a row in recruitment_notes as well, so the reason
 * behind a status — and the person behind the reason — survives the next edit.
 */
const { signerName } = require('../../lib/staffNames');
const express = require('express');
const { hrError } = require('./_shared');
const router = express.Router();
const logger = require('../../lib/logger').child({ module: 'recruitment-workflow' });
const { pool } = require('../../lib/db');
const { uuidv4 } = require('../../lib/id');
const { requireAuth, requireAdminOrStaff, requireAnyPermission } = require('../../middleware/auth');
const {
  requireRecruiting, joinUsInReach, applicantInReach, outOfRecruitReach,
} = require('../../lib/branchHr');
const { parseFirstCall, parseInterviewAt } = require('../../lib/joinApplication');
const { advanceToInterview, convertJoinUs } = require('./talent');

// view_hr / manage_hr as before, or a branch manager on their own branch's
// applications — «اتاكد ان طلبات الانضمام للدقي والانترفيو للدقي بيظهر لنشوي مدير
// الدقي» (12 Oct 2026). Each handler checks the row is within req.recruitReach.
const view = [requireAuth, requireAdminOrStaff, requireAnyPermission('view_hr', 'branch_hr'), requireRecruiting('view_hr')];
const manage = [requireAuth, requireAdminOrStaff, requireAnyPermission('manage_hr', 'branch_hr'), requireRecruiting('manage_hr')];

/** Is the row a note is about within reach? */
const refInReach = (db, req, refType, refId) => (refType === 'applicant'
  ? applicantInReach(db, req, refId) : joinUsInReach(db, req, refId));

const GRADES = new Set(['A+', 'A', 'B+', 'B', 'C+', 'C', 'R', 'W']);

const actor = req => ({
  id: req.staffRecord?.id || null,
  name: signerName(req),
});

/** Append-only, so a later note never overwrites the one before it. */
async function addNote(db, { tenantId, refType, refId, kind, body, req }) {
  const who = actor(req);
  await db.query(
    `INSERT INTO recruitment_notes (id, tenant_id, ref_type, ref_id, kind, body, author_id, author_name)
     VALUES (?,?,?,?,?,?,?,?)`,
    [uuidv4(), tenantId, refType, refId, kind, String(body || '').slice(0, 5000), who.id, who.name]
  );
}

// ── Notes timeline (both screens) ────────────────────────────────────────────
router.get('/api/admin/hr/notes/:refType/:refId', ...view, async (req, res) => {
  try {
    const refType = req.params.refType === 'applicant' ? 'applicant' : 'join_us';
    if (!await refInReach(pool, req, refType, req.params.refId)) return outOfRecruitReach(res);
    // One history per person: an application's notes and its applicant's notes
    // (the calls logged from the interviews screen) read as one timeline.
    const [[link]] = await pool.query(
      refType === 'join_us'
        ? 'SELECT converted_applicant_id other FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1'
        : 'SELECT id other FROM join_us_applications WHERE converted_applicant_id=? AND tenant_id=? LIMIT 1',
      [req.params.refId, req.tenantId]
    );
    const otherType = refType === 'join_us' ? 'applicant' : 'join_us';
    const [rows] = await pool.query(
      `SELECT id, kind, body, author_name, created_at FROM recruitment_notes
        WHERE tenant_id=? AND ((ref_type=? AND ref_id=?) OR (ref_type=? AND ref_id=?))
        ORDER BY created_at DESC LIMIT 200`,
      [req.tenantId, refType, req.params.refId, otherType, link?.other || '']
    );
    res.json(rows);
  } catch (error) {
    logger.error('[notes/list]', error.message);
    hrError(res, error);
  }
});

router.post('/api/admin/hr/notes/:refType/:refId', ...manage, async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'اكتب نص الملاحظة' });
    const refType = req.params.refType === 'applicant' ? 'applicant' : 'join_us';
    if (!await refInReach(pool, req, refType, req.params.refId)) return outOfRecruitReach(res);
    await addNote(pool, {
      tenantId: req.tenantId, refType, refId: req.params.refId, kind: 'note', body, req,
    });
    res.json({ ok: true });
  } catch (error) {
    logger.error('[notes/create]', error.message);
    hrError(res, error);
  }
});

// ── طلبات الانضمام: mark contacted ───────────────────────────────────────────
// Stamps the call rather than toggling a flag: `contacted_at` is what tells the
// next person the applicant has already been rung, and by whom.
router.post('/api/admin/join-us/:id/contact', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      'SELECT id, name, status FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Application not found' }); }
    if (!await joinUsInReach(conn, req, row.id)) { await conn.rollback(); return outOfRecruitReach(res); }

    const who = actor(req);
    // Status only advances out of the pre-contact states. Re-contacting someone
    // already accepted or rejected must not drag them backwards in the pipeline.
    const advances = row.status === 'NEW' || row.status === 'REVIEWED';
    await conn.query(
      `UPDATE join_us_applications
          SET contacted_at=NOW(), contacted_by=?${advances ? ", status='CONTACTED'" : ''}
        WHERE id=? AND tenant_id=?`,
      [who.id, req.params.id, req.tenantId]
    );
    await addNote(conn, {
      tenantId: req.tenantId, refType: 'join_us', refId: req.params.id, kind: 'contact',
      body: String(req.body?.body || '').trim() || 'تم التواصل مع المتقدم', req,
    });
    await conn.commit();
    res.json({ ok: true, contactedBy: who.name, status: advances ? 'CONTACTED' : row.status });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[join-us/contact]', error.message);
    hrError(res, error);
  } finally { conn.release(); }
});

// ── طلبات الانضمام: the decision after the call ──────────────────────────────
// One endpoint for all three outcomes because they are one decision. "Accepted
// with a date" and "accepted, date still to be agreed" differ only by whether
// interview_at is set — modelling them as separate statuses would make an
// accepted applicant whose date is later cancelled unrepresentable.
router.post('/api/admin/join-us/:id/evaluate', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const decision = String(req.body?.decision || '').toUpperCase();
    if (!['ACCEPTED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ error: 'القرار لازم يكون قبول أو رفض' });
    }
    // Checked as strictly as «نقل للانترفيو»: this stored whatever string it was
    // given, so a typo became NULL and a day already gone filed the candidate
    // under السابق on the interviews screen.
    const parsed = decision === 'ACCEPTED' ? parseInterviewAt(req.body?.interviewAt) : { value: null };
    if (parsed.error) return res.status(400).json({ error: parsed.error, code: parsed.code });
    const interviewAt = parsed.value;

    await conn.beginTransaction();
    const [[row]] = await conn.query(
      'SELECT * FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Application not found' }); }
    if (!await joinUsInReach(conn, req, row.id)) { await conn.rollback(); return outOfRecruitReach(res); }

    await conn.query(
      `UPDATE join_us_applications
          SET status=?, interview_at=?, reviewed_at=NOW()
        WHERE id=? AND tenant_id=?`,
      [decision, interviewAt, req.params.id, req.tenantId]
    );
    // Accepting after the call is accepting for an interview. It changed this
    // row only, so «مقبول + تحديد موعد» set a date nobody on the interviews screen
    // could see — the applicant stayed at 'applied'. They are walked there now,
    // with the date, the same way «نقل للانترفيو» does it.
    if (decision === 'ACCEPTED') {
      const applicantId = await convertJoinUs(row, { actorId: req.staffRecord?.id, db: conn });
      await advanceToInterview(conn, {
        tenantId: req.tenantId, applicantId, actorId: req.staffRecord?.id, interviewAt,
      });
      await conn.query('UPDATE join_us_applications SET status=? WHERE id=? AND tenant_id=?',
        [decision, req.params.id, req.tenantId]);
    }
    const label = decision === 'REJECTED' ? 'مرفوض'
      : interviewAt ? `مقبول — موعد المقابلة ${interviewAt}`
        : 'مقبول — لم يتحدد موعد المقابلة بعد';
    await addNote(conn, {
      tenantId: req.tenantId, refType: 'join_us', refId: req.params.id, kind: 'evaluation',
      body: [label, String(req.body?.body || '').trim()].filter(Boolean).join(' — '), req,
    });
    await conn.commit();
    res.json({ ok: true, status: decision, interviewAt });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[join-us/evaluate]', error.message);
    hrError(res, error);
  } finally { conn.release(); }
});

// ── الانترفيوهات: record a grade ─────────────────────────────────────────────
// `round` picks which of the two interviews is being graded. Each round stamps
// its own grader and time, so "who interviewed this person" is answerable per
// round rather than only for whoever touched the row last.
router.post('/api/admin/hr/applicants/:id/grade', ...manage, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const grade = String(req.body?.grade || '').toUpperCase();
    if (!GRADES.has(grade)) return res.status(400).json({ error: 'تقييم غير معروف' });
    const second = String(req.body?.round || '1') === '2';

    await conn.beginTransaction();
    const [[row]] = await conn.query(
      'SELECT id, name FROM job_applicants WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Applicant not found' }); }
    if (!await applicantInReach(conn, req, row.id)) { await conn.rollback(); return outOfRecruitReach(res); }

    const who = actor(req);
    await conn.query(
      second
        ? `UPDATE job_applicants SET second_interview_grade=?, second_interviewed_by=?, second_interviewed_at=NOW()
            WHERE id=? AND tenant_id=?`
        : `UPDATE job_applicants SET interview_grade=?, interviewed_by=?, interviewed_at=NOW()
            WHERE id=? AND tenant_id=?`,
      [grade, who.id, req.params.id, req.tenantId]
    );
    await addNote(conn, {
      tenantId: req.tenantId, refType: 'applicant', refId: req.params.id, kind: 'evaluation',
      body: [`تقييم المقابلة ${second ? 'الثانية' : 'الأولى'}: ${grade}`,
        String(req.body?.body || '').trim()].filter(Boolean).join(' — '),
      req,
    });
    await conn.commit();
    res.json({ ok: true, grade, round: second ? 2 : 1, by: who.name });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[applicants/grade]', error.message);
    hrError(res, error);
  } finally { conn.release(); }
});

// ── «تقييم أول مكالمة» ────────────────────────────────────────────────────────
// «لازم يكون في زر تقييم اول مكالمه» (12 Oct 2026). How the first call went, as
// a number the list can be read by: 1–5, a few quick tags and the notes. Kept on
// the application (the latest rating shows on the card) and written to the
// history, so a second rating does not erase what the first one said.
router.post('/api/admin/join-us/:id/first-call', ...manage, async (req, res) => {
  const parsed = parseFirstCall(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      'SELECT id, status FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Application not found' }); }
    if (!await joinUsInReach(conn, req, row.id)) { await conn.rollback(); return outOfRecruitReach(res); }
    const who = actor(req);
    // Rating a call is having made it: the call is stamped too, and a fresh
    // application moves to «تم التواصل» exactly as the contact button moves it.
    const advances = row.status === 'NEW' || row.status === 'REVIEWED';
    await conn.query(
      `UPDATE join_us_applications
          SET first_call_rating=?, first_call_tags=?, first_call_notes=?, first_call_at=NOW(),
              first_call_by=?, first_call_by_name=?,
              contacted_at=COALESCE(contacted_at, NOW()), contacted_by=COALESCE(contacted_by, ?)
              ${advances ? ", status='CONTACTED'" : ''}
        WHERE id=? AND tenant_id=?`,
      [parsed.rating, JSON.stringify(parsed.tags), parsed.notes || null, who.id, who.name, who.id,
        req.params.id, req.tenantId]
    );
    await addNote(conn, {
      tenantId: req.tenantId, refType: 'join_us', refId: req.params.id, kind: 'first_call',
      body: [`تقييم أول مكالمة: ${parsed.rating}/5`, parsed.tags.join('، '), parsed.notes]
        .filter(Boolean).join(' — '),
      req,
    });
    await conn.commit();
    res.json({ ok: true, rating: parsed.rating, tags: parsed.tags, by: who.name });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[join-us/first-call]', error.message);
    hrError(res, error);
  } finally { conn.release(); }
});

// ── الانترفيوهات: log a call ──────────────────────────────────────────────────
// «ليه التواصل مش بيتجسل صح» (12 Oct 2026). The interviews screen's «تواصل»
// wrote phone_interview_result='no_answer' and nothing else: no time, no caller,
// no note, nothing in the history — and its other two answers (هينزل تدريب /
// رفض) recorded no call at all. The applicants panel stamped the time from the
// browser's UTC clock as if it were Cairo's. Every outcome now lands here: the
// result, the time (the server's), who rang, a note in the history, and the
// linked website application learns it was contacted.
const CALL_RESULTS = new Set(['no_answer', 'passed', 'failed']);
router.post('/api/admin/hr/applicants/:id/contact', ...manage, async (req, res) => {
  const result = String(req.body?.result || '');
  if (!CALL_RESULTS.has(result)) return res.status(400).json({ error: 'نتيجة المكالمة لازم تكون: مردّش، كويس، أو مش مناسب' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      'SELECT id, name, source, source_id FROM job_applicants WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Applicant not found' }); }
    if (!await applicantInReach(conn, req, row.id)) { await conn.rollback(); return outOfRecruitReach(res); }
    const who = actor(req);
    await conn.query(
      `UPDATE job_applicants SET phone_interview_result=?, phone_interview_at=NOW(), updated_by=?
        WHERE id=? AND tenant_id=?`,
      [result, who.id, row.id, req.tenantId]
    );
    if (row.source === 'website' && row.source_id) {
      await conn.query(
        `UPDATE join_us_applications
            SET contacted_at=NOW(), contacted_by=?, status=IF(status IN ('NEW','REVIEWED'),'CONTACTED',status)
          WHERE id=? AND tenant_id=?`,
        [who.id, row.source_id, req.tenantId]
      );
    }
    const label = { no_answer: 'مردّش', passed: 'المكالمة كويسة', failed: 'مش مناسب' }[result];
    await addNote(conn, {
      tenantId: req.tenantId, refType: 'applicant', refId: row.id, kind: 'contact',
      body: [`تواصل — ${label}`, String(req.body?.body || '').trim()].filter(Boolean).join(' — '),
      req,
    });
    await conn.commit();
    res.json({ ok: true, result, by: who.name });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[applicants/contact]', error.message);
    hrError(res, error);
  } finally { conn.release(); }
});

module.exports = router;
