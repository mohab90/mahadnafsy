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
const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger').child({ module: 'recruitment-workflow' });
const { pool } = require('../../lib/db');
const { uuidv4 } = require('../../lib/id');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');

const view = [requireAuth, requireAdminOrStaff, requirePermission('view_hr')];
const manage = [requireAuth, requireAdminOrStaff, requirePermission('manage_hr')];

const GRADES = new Set(['A+', 'A', 'B+', 'B', 'C+', 'C', 'R', 'W']);

const actor = req => ({
  id: req.staffRecord?.id || null,
  name: req.staffRecord?.name || req.user?.email || 'admin',
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
    const [rows] = await pool.query(
      `SELECT id, kind, body, author_name, created_at FROM recruitment_notes
        WHERE tenant_id=? AND ref_type=? AND ref_id=? ORDER BY created_at DESC LIMIT 200`,
      [req.tenantId, refType, req.params.refId]
    );
    res.json(rows);
  } catch (error) {
    logger.error('[notes/list]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/hr/notes/:refType/:refId', ...manage, async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'اكتب نص الملاحظة' });
    const refType = req.params.refType === 'applicant' ? 'applicant' : 'join_us';
    await addNote(pool, {
      tenantId: req.tenantId, refType, refId: req.params.refId, kind: 'note', body, req,
    });
    res.json({ ok: true });
  } catch (error) {
    logger.error('[notes/create]', error.message);
    res.status(500).json({ error: 'Internal server error' });
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
    res.json({ ok: true, contactedBy: who.name });
  } catch (error) {
    await conn.rollback().catch(() => {});
    logger.error('[join-us/contact]', error.message);
    res.status(500).json({ error: 'Internal server error' });
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
    const interviewAt = decision === 'ACCEPTED' && req.body?.interviewAt
      ? String(req.body.interviewAt).slice(0, 19).replace('T', ' ')
      : null;

    await conn.beginTransaction();
    const [[row]] = await conn.query(
      'SELECT id, name FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Application not found' }); }

    await conn.query(
      `UPDATE join_us_applications
          SET status=?, interview_at=?, reviewed_at=NOW()
        WHERE id=? AND tenant_id=?`,
      [decision, interviewAt, req.params.id, req.tenantId]
    );
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

module.exports = router;
