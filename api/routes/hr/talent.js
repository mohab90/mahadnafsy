'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// HR ↔ website recruiting bridge (weakness: join-us was a dead-end).
// Turns website "join us" submissions into tracked applicants in the HR
// recruiting funnel (job_postings → job_applicants → stages → hire → staff).
// This is how a candidate flows from the public site INTO the HR department.
// ═══════════════════════════════════════════════════════════════════════════
const { Router } = require('express');
const router = Router();
const { requirePermission, pool, uuidv4, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, logger } = require('./_shared');

const TALENT_POOL_JOB = 'job-talent-pool';
const ROLE_FOR_TYPE = { INSTRUCTOR: 'instructor', CONSULTANT: 'consultant', EMPLOYEE: 'support' };

// Lazily ensure the catch-all "Talent Pool" job exists so website applicants
// always have a funnel home even before HR posts a specific job. Best-effort.
async function ensureTalentPoolJob() {
  try {
    await pool.query(
      `INSERT IGNORE INTO job_postings (id, title, employment_type, status, description)
       VALUES (?, 'مسار المتقدمين من الموقع (Talent Pool)', 'full_time', 'open', 'تجميع تلقائي لطلبات الانضمام من الموقع')`,
      [TALENT_POOL_JOB]);
  } catch (e) { logger.warn('[hr/talent] ensure pool job:', e.message); }
  return TALENT_POOL_JOB;
}

// Shared conversion: join_us_applications row → job_applicants row. Returns appId.
async function convertJoinUs(j, { jobId, actorId } = {}) {
  const targetJob = jobId || await ensureTalentPoolJob();
  const appId = uuidv4();
  const notes = [j.specialty ? `التخصص: ${j.specialty}` : '', j.experience || '', j.message || ''].filter(Boolean).join('\n');
  await pool.query(
    `INSERT INTO job_applicants (id, job_id, name, email, phone, notes, source, source_id, specialty, applicant_type, linkedin, updated_by)
     VALUES (?,?,?,?,?,?, 'website', ?,?,?,?,?)`,
    [appId, targetJob, j.name, j.email || null, j.phone || null, notes, j.id, j.specialty || null, j.type || null, j.linkedin || null, actorId || null]);
  await pool.query(
    "UPDATE join_us_applications SET status='REVIEWED', converted_applicant_id=?, reviewed_at=NOW(), assigned_to=COALESCE(assigned_to,?) WHERE id=?",
    [appId, actorId || null, j.id]);
  return appId;
}

// ── The website recruiting funnel: join-us applications + their pipeline state ─
router.get('/api/admin/hr/talent-pool', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT j.id, j.name, j.email, j.phone, j.specialty, j.type AS applicant_type, j.linkedin,
              j.status, j.created_at, j.reviewed_at, j.converted_applicant_id,
              a.stage AS applicant_stage, a.job_id, a.hired_staff_id
         FROM join_us_applications j
         LEFT JOIN job_applicants a ON a.id = j.converted_applicant_id
        ORDER BY j.created_at DESC LIMIT 300`);
    res.json(rows);
  } catch (e) { logger.error('[hr/talent-pool]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Move a website application into the recruiting pipeline ───────────────────
router.post('/api/admin/hr/join-us/:id/to-applicant', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [[j]] = await pool.query('SELECT * FROM join_us_applications WHERE id=? LIMIT 1', [req.params.id]);
    if (!j) return res.status(404).json({ error: 'Not found' });
    if (j.converted_applicant_id) return res.status(409).json({ error: 'Already in pipeline', applicantId: j.converted_applicant_id });
    const appId = await convertJoinUs(j, { jobId: req.body.job_id, actorId: req.staffRecord?.id });
    const [[app]] = await pool.query('SELECT id, job_id, name, email, phone, stage, source, specialty, applicant_type FROM job_applicants WHERE id=?', [appId]);
    res.json({ ok: true, applicant: app });
  } catch (e) { logger.error('[hr/to-applicant]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Hire an applicant → create a (pending) staff record ──────────────────────
router.post('/api/admin/hr/applicants/:appId/hire', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [[a]] = await pool.query('SELECT * FROM job_applicants WHERE id=? LIMIT 1', [req.params.appId]);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (a.hired_staff_id) return res.status(409).json({ error: 'Already hired', staffId: a.hired_staff_id });
    const role = req.body.role || ROLE_FOR_TYPE[String(a.applicant_type || '').toUpperCase()] || 'support';
    // Reuse an existing staff account with the same email if present.
    let staffId = null;
    if (a.email) {
      const [[ex]] = await pool.query('SELECT id FROM staff WHERE LOWER(TRIM(email))=? LIMIT 1', [String(a.email).toLowerCase().trim()]);
      staffId = ex?.id || null;
    }
    if (!staffId) {
      staffId = uuidv4();
      await pool.query(
        `INSERT INTO staff (id, name, email, phone, role, is_active, employment_type, hire_date)
         VALUES (?,?,?,?,?, 0, 'full_time', CURDATE())`,
        [staffId, a.name, a.email || null, a.phone || null, role]);
    }
    await pool.query("UPDATE job_applicants SET stage='hired', hired_staff_id=?, updated_by=? WHERE id=?",
      [staffId, req.staffRecord?.id || null, a.id]);
    if (a.source === 'website' && a.source_id) {
      await pool.query("UPDATE join_us_applications SET status='ACCEPTED' WHERE id=?", [a.source_id]).catch(() => {});
    }
    createNotification('hr', 'تعيين جديد', `${a.name} تم تعيينه (${role}) — يحتاج تفعيل الحساب وكلمة مرور`, { staffId }).catch(() => {});
    res.json({ ok: true, staffId, role, activation_required: true });
  } catch (e) { logger.error('[hr/hire]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = { router, convertJoinUs, ensureTalentPoolJob };
