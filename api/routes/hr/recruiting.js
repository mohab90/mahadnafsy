'use strict';
const { Router } = require('express');
const router = Router();
const { requirePermission, logger, pool, getStaffIdByEmail, tryJson, requireAuth, requireAdmin, requireAdminOrStaff, createNotification, uuidv4, postJournalEntry, toEgp, getFxToEgp, logFinancialAudit, _resolveStaffByUser } = require('./_shared');
const { writeAuditEvent } = require('../../lib/auditTrail');

const EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'intern']);
const JOB_STATUSES = new Set(['draft', 'open', 'closed', 'filled']);
const APPLICANT_TRANSITIONS = {
  applied: new Set(['screening', 'rejected']),
  screening: new Set(['interview', 'rejected']),
  interview: new Set(['offer', 'rejected']),
  offer: new Set(['hired', 'rejected']),
  rejected: new Set(['screening']),
  hired: new Set(),
};
const ONBOARDING_CATEGORIES = new Set(['documents', 'training', 'setup', 'meeting', 'other']);
const STAFF_ROLES = new Set([
  'instructor', 'trainer', 'expert', 'sales', 'manager', 'admin', 'support',
  'reception_daqqi', 'collection', 'accountant', 'consultant', 'other',
  'online_manager', 'daqqi_manager', 'sales_collection_manager', 'hr',
]);

function validateApplicant(body, partial = false) {
  if (!partial && !String(body.name || '').trim()) return 'name required';
  if (body.name !== undefined && (!String(body.name).trim() || String(body.name).trim().length > 200)) return 'invalid name';
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email).trim())) return 'invalid email';
  if (body.cv_url) {
    const cvUrl = String(body.cv_url).trim();
    if (!/^https:\/\//i.test(cvUrl) && !cvUrl.startsWith('/uploads/')) return 'cv_url must use HTTPS or an uploaded file';
  }
  if (body.interview_rating !== undefined && body.interview_rating !== null) {
    const rating = Number(body.interview_rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'interview_rating must be an integer from 1 to 5';
  }
  return null;
}

function normalizeOnboardingTask(body) {
  const title = String(body?.title || '').trim();
  const dueDays = body?.due_days === undefined ? 7 : Number(body.due_days);
  const sortOrder = body?.sort_order === undefined ? 0 : Number(body.sort_order);
  const category = String(body?.category || 'other');
  if (!title || title.length > 300) return { error: 'invalid title' };
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) return { error: 'due_days must be between 0 and 365' };
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) return { error: 'invalid sort_order' };
  if (!ONBOARDING_CATEGORIES.has(category)) return { error: 'invalid category' };
  return { title, dueDays, sortOrder, category, description: body?.description || null };
}

function validateOnboardingTemplate(body) {
  const name = String(body?.name || '').trim();
  const role = body?.role ? String(body.role).toLowerCase() : null;
  if (!name || name.length > 200) return { error: 'invalid name' };
  if (role && !STAFF_ROLES.has(role)) return { error: 'invalid role' };
  return { name, role, description: body?.description || null };
}

function validateJob(body, partial = false) {
  if (!partial && !String(body.title || '').trim()) return 'title required';
  if (body.employment_type !== undefined && !EMPLOYMENT_TYPES.has(body.employment_type)) return 'invalid employment_type';
  if (body.status !== undefined && !JOB_STATUSES.has(body.status)) return 'invalid status';
  const min = body.salary_min === null || body.salary_min === undefined || body.salary_min === '' ? null : Number(body.salary_min);
  const max = body.salary_max === null || body.salary_max === undefined || body.salary_max === '' ? null : Number(body.salary_max);
  if ((min !== null && (!Number.isFinite(min) || min < 0)) || (max !== null && (!Number.isFinite(max) || max < 0))) return 'invalid salary range';
  if (min !== null && max !== null && min > max) return 'salary_min cannot exceed salary_max';
  return null;
}

async function validateJobReferences(db, tenantId, departmentId, branchValue) {
  if (departmentId) {
    const [[department]] = await db.query(
      'SELECT id FROM hr_departments WHERE tenant_id=? AND id=? AND is_active=1 LIMIT 1',
      [tenantId, departmentId]
    );
    if (!department) return { error: 'Department does not belong to tenant or is inactive' };
  }
  if (!branchValue) return { branch: null };
  const [[branch]] = await db.query(
    `SELECT branch_key FROM branches
      WHERE tenant_id=? AND is_active=1 AND (id=? OR branch_key=? OR slug=?) LIMIT 1`,
    [tenantId, branchValue, branchValue, branchValue]
  );
  return branch ? { branch: branch.branch_key } : { error: 'Branch does not belong to tenant or is inactive' };
}

// GET /api/admin/hr/branches — the real `branches` table (ground truth for
// job_postings.branch / staff.branch_id), NOT content['institute.branches']
// (a separate, customer-facing "الفرع الأقرب" list that this tenant has
// never actually populated — so it's not a usable source for this picker).
// Includes internal-only branches (e.g. an admin-only office) on purpose:
// this endpoint backs HR/job-posting UI, which is exactly where those
// belong; the public site never calls it.
router.get('/api/admin/hr/branches', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT branch_key AS id, label, internal_only FROM branches
        WHERE tenant_id=? AND is_active=1 ORDER BY label`,
      [req.tenantId]
    );
    res.json(rows.map(r => ({ ...r, internal_only: Boolean(r.internal_only) })));
  } catch (e) { logger.error('[hr/branches]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/hr/jobs', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT j.*, d.name AS department_name,
        s.name AS posted_by_name,
        (SELECT COUNT(*) FROM job_applicants a WHERE a.job_id=j.id AND a.tenant_id=j.tenant_id) AS applicant_count
      FROM job_postings j
      LEFT JOIN hr_departments d ON d.id=j.department_id AND d.tenant_id=j.tenant_id
      LEFT JOIN staff s ON s.id=j.posted_by AND s.tenant_id=j.tenant_id
      WHERE j.tenant_id=?
      ORDER BY j.created_at DESC
    `, [req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Create job posting
router.post('/api/admin/hr/jobs', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { title, department_id, branch, employment_type, description, requirements, salary_min, salary_max, status } = req.body;
    const validationError = validateJob(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const references = await validateJobReferences(conn, req.tenantId, department_id, branch);
    if (references.error) return res.status(400).json({ error: references.error });
    const id = uuidv4();
    await conn.beginTransaction(); transactionStarted = true;
    await conn.query(
      `INSERT INTO job_postings (id, tenant_id, title, department_id, branch, employment_type, description, requirements, salary_min, salary_max, status, posted_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.tenantId, String(title).trim().slice(0, 200), department_id || null, references.branch,
        employment_type || 'full_time', description || null, requirements || null,
        salary_min ?? null, salary_max ?? null, status || 'open', req.staffRecord?.id || null]
    );
    await writeAuditEvent({
      action: 'hr.job.created', entityType: 'job_posting', entityId: id,
      metadata: { department_id: department_id || null, branch: references.branch, status: status || 'open' },
      req, db: conn,
    });
    const [[row]] = await conn.query(
      `SELECT id, title, department_id, branch, employment_type, description, requirements,
              salary_min, salary_max, status, posted_by, created_at
       FROM job_postings WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    await conn.commit(); transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/jobs/create]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// Update job posting
router.put('/api/admin/hr/jobs/:jobId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { jobId } = req.params;
    const validationError = validateJob(req.body, true);
    if (validationError) return res.status(400).json({ error: validationError });
    await conn.beginTransaction(); transactionStarted = true;
    const [[current]] = await conn.query(
      'SELECT id,department_id,branch,status FROM job_postings WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [jobId, req.tenantId]
    );
    if (!current) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Job not found' });
    }
    const references = await validateJobReferences(
      conn,
      req.tenantId,
      req.body.department_id === undefined ? current.department_id : req.body.department_id,
      req.body.branch === undefined ? current.branch : req.body.branch,
    );
    if (references.error) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: references.error });
    }
    if (req.body.branch !== undefined) req.body.branch = references.branch;
    const fields = ['title','department_id','branch','employment_type','description','requirements','salary_min','salary_max','status'];
    const sets = []; const vals = [];
    for (const f of fields) { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(jobId, req.tenantId);
    const [updated] = await conn.query(`UPDATE job_postings SET ${sets.join(',')} WHERE id=? AND tenant_id=?`, vals);
    if (!updated.affectedRows) return res.status(404).json({ error: 'Job not found' });
    await writeAuditEvent({
      action: 'hr.job.updated', entityType: 'job_posting', entityId: jobId,
      metadata: { changed_fields: fields.filter(field => req.body[field] !== undefined), old_status: current.status },
      req, db: conn,
    });
    const [[row]] = await conn.query(
      `SELECT id, title, department_id, branch, employment_type, description, requirements,
              salary_min, salary_max, status, posted_by, created_at
       FROM job_postings WHERE id=? AND tenant_id=?`, [jobId, req.tenantId]
    );
    await conn.commit(); transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/jobs/update]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// Delete job posting
router.delete('/api/admin/hr/jobs/:jobId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[job]] = await conn.query(
      'SELECT id FROM job_postings WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.jobId, req.tenantId]
    );
    if (!job) {
      await conn.rollback();
      return res.status(404).json({ error: 'Job not found' });
    }
    const [[usage]] = await conn.query(
      'SELECT COUNT(*) count FROM job_applicants WHERE job_id=? AND tenant_id=?',
      [req.params.jobId, req.tenantId]
    );
    if (Number(usage.count) > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'Close the job instead; applicants are linked to it', code: 'JOB_HAS_APPLICANTS' });
    }
    await writeAuditEvent({
      action: 'hr.job.deleted', entityType: 'job_posting', entityId: req.params.jobId,
      severity: 'warning', req, db: conn,
    });
    const [deleted] = await conn.query('DELETE FROM job_postings WHERE id=? AND tenant_id=?', [req.params.jobId, req.tenantId]);
    if (!deleted.affectedRows) {
      await conn.rollback();
      return res.status(409).json({ error: 'Job changed before deletion', code: 'JOB_DELETE_CONFLICT' });
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

// List applicants for a job
router.get('/api/admin/hr/applicants', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const params = [req.tenantId];
    let filter = '';
    if (req.query.stage && req.query.stage !== 'all') {
      filter = ' AND a.stage=?';
      params.push(String(req.query.stage));
    }
    const [rows] = await pool.query(
      `SELECT a.id,a.job_id,a.name,a.email,a.phone,a.cv_url,a.notes,a.stage,a.stage_notes,a.interview_rating,
              a.source,a.source_id,a.specialty,a.applicant_type,a.linkedin,a.hired_staff_id,
              a.interview_grade,a.second_interview_grade,
              a.interviewed_at,a.second_interviewed_at,
              -- Resolved to names: the screen shows who graded each round, and
              -- a staff uuid answers that for nobody.
              g1.name interviewed_by_name, g2.name second_interviewed_by_name,
              a.created_at,a.updated_at,j.title job_title,j.branch job_branch
         FROM job_applicants a
         JOIN job_postings j ON j.id=a.job_id AND j.tenant_id=a.tenant_id
         LEFT JOIN staff g1 ON g1.id=a.interviewed_by AND g1.tenant_id=a.tenant_id
         LEFT JOIN staff g2 ON g2.id=a.second_interviewed_by AND g2.tenant_id=a.tenant_id
        WHERE a.tenant_id=?${filter}
        ORDER BY a.updated_at DESC,a.created_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/hr/jobs/:jobId/applicants', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS updated_by_name
       FROM job_applicants a LEFT JOIN staff s ON s.id=a.updated_by AND s.tenant_id=a.tenant_id
       WHERE a.job_id=? AND a.tenant_id=? ORDER BY a.created_at DESC`,
      [req.params.jobId, req.tenantId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Add applicant
router.post('/api/admin/hr/jobs/:jobId/applicants', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { name, email, phone, cv_url, notes, stage } = req.body;
    const validationError = validateApplicant(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    // Only 'interview' is accepted here — the two legal hops from the default
    // 'applied' (applied→screening→interview) are performed below, same as
    // the join-us "نقل للمقابلات" one-click path; any other requested stage
    // would either be a no-op (applied) or need transitions this endpoint
    // doesn't own the rules for, so it's rejected rather than guessed at.
    if (stage !== undefined && stage !== 'interview') {
      return res.status(400).json({ error: "stage must be 'interview' when provided" });
    }
    const id = uuidv4();
    await conn.beginTransaction(); transactionStarted = true;
    const [created] = await conn.query(
      `INSERT INTO job_applicants (id, tenant_id, job_id, name, email, phone, cv_url, notes, updated_by)
       SELECT ?,?,?,?,?,?,?,?,?
       WHERE EXISTS (SELECT 1 FROM job_postings WHERE id=? AND tenant_id=? AND status IN ('draft','open'))`,
      [id, req.tenantId, req.params.jobId, String(name).trim(), email ? String(email).trim().toLowerCase() : null,
        phone || null, cv_url || null, notes || null, req.staffRecord?.id || null, req.params.jobId, req.tenantId]
    );
    if (!created.affectedRows) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Job not found or no longer accepts applicants', code: 'JOB_NOT_ACCEPTING_APPLICANTS' });
    }
    if (stage === 'interview') {
      await conn.query(
        "UPDATE job_applicants SET stage='screening', updated_by=? WHERE id=? AND tenant_id=?",
        [req.staffRecord?.id || null, id, req.tenantId]
      );
      await conn.query(
        "UPDATE job_applicants SET stage='interview', updated_by=? WHERE id=? AND tenant_id=?",
        [req.staffRecord?.id || null, id, req.tenantId]
      );
    }
    await writeAuditEvent({
      action: 'hr.applicant.created', entityType: 'job_applicant', entityId: id,
      metadata: { job_id: req.params.jobId, source: 'manual', stage: stage || 'applied' }, req, db: conn,
    });
    const [[row]] = await conn.query(
      `SELECT id, job_id, name, email, phone, cv_url, notes, stage, stage_notes, interview_rating, updated_by, created_at, updated_at
       FROM job_applicants WHERE id=? AND tenant_id=?`, [id, req.tenantId]
    );
    await conn.commit(); transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/applicant/create]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// Update applicant (stage, notes, etc.)
router.put('/api/admin/hr/applicants/:appId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const { appId } = req.params;
    const validationError = validateApplicant(req.body, true);
    if (validationError) return res.status(400).json({ error: validationError });
    const fields = ['name','email','phone','cv_url','notes','stage','stage_notes','interview_rating'];
    await conn.beginTransaction(); transactionStarted = true;
    const [[current]] = await conn.query(
      'SELECT stage FROM job_applicants WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [appId, req.tenantId]
    );
    if (!current) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Applicant not found' });
    }
    if (current.stage === 'hired') {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Hired applicant history is immutable', code: 'HIRED_APPLICANT_IMMUTABLE' });
    }
    const stageGuard = current.stage;
    if (req.body.stage !== undefined) {
      if (req.body.stage !== current.stage && !APPLICANT_TRANSITIONS[current.stage]?.has(req.body.stage)) {
        await conn.rollback(); transactionStarted = false;
        return res.status(409).json({ error: `Illegal applicant transition ${current.stage} -> ${req.body.stage}`, code: 'INVALID_APPLICANT_TRANSITION' });
      }
      if (req.body.stage === 'hired') {
        await conn.rollback(); transactionStarted = false;
        return res.status(409).json({ error: 'Use the hire action to create and link the staff record', code: 'HIRE_ACTION_REQUIRED' });
      }
    }
    const sets = []; const vals = [];
    for (const f of fields) { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } }
    if (!sets.length) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'nothing to update' });
    }
    sets.push('updated_by=?'); vals.push(req.staffRecord?.id||null);
    vals.push(appId, req.tenantId, stageGuard);
    const [updated] = await conn.query(
      `UPDATE job_applicants SET ${sets.join(',')} WHERE id=? AND tenant_id=? AND stage=?`,
      vals
    );
    if (!updated.affectedRows) {
      await conn.rollback(); transactionStarted = false;
      return res.status(409).json({ error: 'Applicant stage changed; refresh and retry', code: 'APPLICANT_STAGE_CONFLICT' });
    }
    await writeAuditEvent({
      action: 'hr.applicant.updated', entityType: 'job_applicant', entityId: appId,
      metadata: { old_stage: current.stage, new_stage: req.body.stage || current.stage, changed_fields: fields.filter(f => req.body[f] !== undefined) },
      req, db: conn,
    });
    const [[row]] = await conn.query(
      `SELECT id, job_id, name, email, phone, cv_url, notes, stage, stage_notes, interview_rating, updated_by, created_at, updated_at
       FROM job_applicants WHERE id=? AND tenant_id=?`, [appId, req.tenantId]
    );
    await conn.commit(); transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[hr/applicant/update]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// Delete applicant
router.delete('/api/admin/hr/applicants/:appId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const [deleted] = await pool.query(
      `DELETE FROM job_applicants
        WHERE id=? AND tenant_id=? AND hired_staff_id IS NULL AND stage<>'hired' AND source<>'website'`,
      [req.params.appId, req.tenantId]
    );
    if (!deleted.affectedRows) {
      const [[row]] = await pool.query(
        'SELECT hired_staff_id,stage FROM job_applicants WHERE id=? AND tenant_id=? LIMIT 1',
        [req.params.appId, req.tenantId]
      );
      if (row) return res.status(409).json({ error: 'A website or hired applicant is part of the HR audit trail', code: 'APPLICANT_IMMUTABLE' });
      return res.status(404).json({ error: 'Applicant not found' });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v14 — Onboarding
// ══════════════════════════════════════════════════════════════

// List templates
router.get('/api/admin/hr/onboarding/templates', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, COUNT(tk.id) AS task_count
      FROM onboarding_templates t LEFT JOIN onboarding_tasks tk ON tk.template_id=t.id AND tk.tenant_id=t.tenant_id
      WHERE t.tenant_id=?
      GROUP BY t.id ORDER BY t.name
    `, [req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Create template
router.post('/api/admin/hr/onboarding/templates', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const normalized = validateOnboardingTemplate(req.body);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    const id = uuidv4();
    await conn.beginTransaction(); transactionStarted = true;
    await conn.query(`INSERT INTO onboarding_templates (id, tenant_id, name, role, description) VALUES (?,?,?,?,?)`,
      [id, req.tenantId, normalized.name, normalized.role, normalized.description]);
    await writeAuditEvent({
      action: 'hr.onboarding_template.created', entityType: 'onboarding_template', entityId: id,
      metadata: { role: normalized.role }, req, db: conn,
    });
    const [[row]] = await conn.query(
      'SELECT id, name, role, description, created_at FROM onboarding_templates WHERE id=? AND tenant_id=?', [id, req.tenantId]
    );
    await conn.commit(); transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// Update template
router.put('/api/admin/hr/onboarding/templates/:tplId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const normalized = validateOnboardingTemplate(req.body);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    await conn.beginTransaction(); transactionStarted = true;
    const [updated] = await conn.query(`UPDATE onboarding_templates SET name=?, role=?, description=? WHERE id=? AND tenant_id=?`,
      [normalized.name, normalized.role, normalized.description, req.params.tplId, req.tenantId]);
    if (!updated.affectedRows) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Template not found' });
    }
    await writeAuditEvent({
      action: 'hr.onboarding_template.updated', entityType: 'onboarding_template', entityId: req.params.tplId,
      metadata: { role: normalized.role }, req, db: conn,
    });
    const [[row]] = await conn.query(
      'SELECT id, name, role, description, created_at FROM onboarding_templates WHERE id=? AND tenant_id=?',
      [req.params.tplId, req.tenantId]
    );
    await conn.commit(); transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// Delete template
router.delete('/api/admin/hr/onboarding/templates/:tplId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[usage]] = await conn.query(
        'SELECT COUNT(*) count FROM employee_onboarding WHERE template_id=? AND tenant_id=?',
        [req.params.tplId, req.tenantId]
      );
      if (Number(usage.count) > 0) {
        await conn.rollback();
        return res.status(409).json({ error: 'Template is part of employee onboarding history', code: 'ONBOARDING_TEMPLATE_IN_USE' });
      }
      await conn.query('DELETE FROM onboarding_tasks WHERE template_id=? AND tenant_id=?', [req.params.tplId, req.tenantId]);
      const [deleted] = await conn.query('DELETE FROM onboarding_templates WHERE id=? AND tenant_id=?', [req.params.tplId, req.tenantId]);
      if (!deleted.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ error: 'Template not found' });
      }
      await writeAuditEvent({
        action: 'hr.onboarding_template.deleted', entityType: 'onboarding_template', entityId: req.params.tplId,
        req, db: conn,
      });
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Get tasks for template
router.get('/api/admin/hr/onboarding/templates/:tplId/tasks', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, template_id, title, description, due_days, category, sort_order
       FROM onboarding_tasks WHERE template_id=? AND tenant_id=? ORDER BY sort_order, id`,
      [req.params.tplId, req.tenantId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Add task to template
router.post('/api/admin/hr/onboarding/templates/:tplId/tasks', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const task = normalizeOnboardingTask(req.body);
    if (task.error) return res.status(400).json({ error: task.error });
    const id = uuidv4();
    await conn.beginTransaction(); transactionStarted = true;
    const [created] = await conn.query(
      `INSERT INTO onboarding_tasks (id, tenant_id, template_id, title, description, due_days, category, sort_order)
       SELECT ?,?,?,?,?,?,?,?
       WHERE EXISTS (SELECT 1 FROM onboarding_templates WHERE id=? AND tenant_id=?)`,
      [id, req.tenantId, req.params.tplId, task.title, task.description, task.dueDays, task.category,
        task.sortOrder, req.params.tplId, req.tenantId]
    );
    if (!created.affectedRows) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Template not found' });
    }
    await writeAuditEvent({
      action: 'hr.onboarding_template_task.created', entityType: 'onboarding_task', entityId: id,
      metadata: { template_id: req.params.tplId }, req, db: conn,
    });
    const [[row]] = await conn.query(
      'SELECT id, template_id, title, description, due_days, category, sort_order FROM onboarding_tasks WHERE id=? AND tenant_id=?',
      [id, req.tenantId]
    );
    await conn.commit(); transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// Update / delete task
router.put('/api/admin/hr/onboarding/tasks/:taskId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const task = normalizeOnboardingTask(req.body);
    if (task.error) return res.status(400).json({ error: task.error });
    await conn.beginTransaction(); transactionStarted = true;
    const [updated] = await conn.query(
      `UPDATE onboarding_tasks SET title=?, description=?, due_days=?, category=?, sort_order=? WHERE id=? AND tenant_id=?`,
      [task.title, task.description, task.dueDays, task.category, task.sortOrder, req.params.taskId, req.tenantId]
    );
    if (!updated.affectedRows) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Task not found' });
    }
    await writeAuditEvent({
      action: 'hr.onboarding_template_task.updated', entityType: 'onboarding_task', entityId: req.params.taskId,
      req, db: conn,
    });
    const [[row]] = await conn.query(
      'SELECT id, template_id, title, description, due_days, category, sort_order FROM onboarding_tasks WHERE id=? AND tenant_id=?',
      [req.params.taskId, req.tenantId]
    );
    await conn.commit(); transactionStarted = false;
    res.json(row);
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

router.delete('/api/admin/hr/onboarding/tasks/:taskId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    await conn.beginTransaction(); transactionStarted = true;
    const [deleted] = await conn.query('DELETE FROM onboarding_tasks WHERE id=? AND tenant_id=?', [req.params.taskId, req.tenantId]);
    if (!deleted.affectedRows) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Task not found' });
    }
    await writeAuditEvent({
      action: 'hr.onboarding_template_task.deleted', entityType: 'onboarding_task', entityId: req.params.taskId,
      req, db: conn,
    });
    await conn.commit(); transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// List employees with onboarding status
router.get('/api/admin/hr/onboarding/employees', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.name, s.role, s.image, COALESCE(s.hire_date,DATE(s.joined_at)) AS hire_date,
        eo.id AS onboarding_id, eo.status AS onboarding_status, eo.started_at,
        COUNT(eoi.id) AS total_items,
        SUM(CASE WHEN eoi.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done_items,
        t.name AS template_name
      FROM staff s
      LEFT JOIN employee_onboarding eo ON eo.id=(
        SELECT current_onboarding.id
          FROM employee_onboarding current_onboarding
         WHERE current_onboarding.staff_id=s.id
           AND current_onboarding.tenant_id=s.tenant_id
           AND current_onboarding.status IN ('in_progress','completed')
         ORDER BY (current_onboarding.status='in_progress') DESC,current_onboarding.started_at DESC
         LIMIT 1
      )
      LEFT JOIN onboarding_templates t ON t.id=eo.template_id AND t.tenant_id=eo.tenant_id
      LEFT JOIN employee_onboarding_items eoi ON eoi.onboarding_id=eo.id AND eoi.tenant_id=eo.tenant_id
      WHERE s.is_active=1 AND s.tenant_id=? AND s.deleted_at IS NULL
      GROUP BY s.id, eo.id ORDER BY s.name
    `, [req.tenantId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Get onboarding items for an employee onboarding
router.get('/api/admin/hr/onboarding/:onboardingId/items', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, s.name AS completed_by_name
       FROM employee_onboarding_items i LEFT JOIN staff s ON s.id=i.completed_by AND s.tenant_id=i.tenant_id
       WHERE i.onboarding_id=? AND i.tenant_id=? ORDER BY i.sort_order, i.id`,
      [req.params.onboardingId, req.tenantId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Start onboarding for employee (from template or custom)
router.post('/api/admin/hr/onboarding/start', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { staff_id, template_id, tasks } = req.body; // tasks: [{title,category,due_days}]
    if (!staff_id) return res.status(400).json({ error: 'staff_id required' });
    const onboardingId = uuidv4();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[emp]] = await conn.query(
        'SELECT role,COALESCE(hire_date,DATE(joined_at)) hire_date FROM staff WHERE id=? AND tenant_id=? AND is_active=1 AND deleted_at IS NULL FOR UPDATE',
        [staff_id, req.tenantId]
      );
      if (!emp) {
        await conn.rollback();
        return res.status(404).json({ error: 'Employee not found' });
      }
      const hireDate = emp.hire_date ? new Date(emp.hire_date) : new Date();
      const [[active]] = await conn.query(
        `SELECT id FROM employee_onboarding
          WHERE tenant_id=? AND staff_id=? AND status='in_progress'
          LIMIT 1 FOR UPDATE`,
        [req.tenantId, staff_id]
      );
      if (active) {
        await conn.rollback();
        return res.status(409).json({ error: 'Employee already has active onboarding', code: 'ACTIVE_ONBOARDING_EXISTS', onboardingId: active.id });
      }

      let items = [];
      if (template_id) {
        const [[template]] = await conn.query(
          'SELECT id,role FROM onboarding_templates WHERE id=? AND tenant_id=?',
          [template_id, req.tenantId]
        );
        if (!template) {
          await conn.rollback();
          return res.status(404).json({ error: 'Template not found' });
        }
        if (template.role && String(template.role).toLowerCase() !== String(emp.role).toLowerCase()) {
          await conn.rollback();
          return res.status(409).json({ error: 'Template role does not match employee role', code: 'ONBOARDING_ROLE_MISMATCH' });
        }
        const [tplTasks] = await conn.query(
          `SELECT id, template_id, title, description, due_days, category, sort_order
             FROM onboarding_tasks WHERE template_id=? AND tenant_id=? ORDER BY sort_order`,
          [template_id, req.tenantId]
        );
        items = tplTasks;
      } else if (tasks && Array.isArray(tasks)) {
        items = tasks.slice(0, 100);
      }
      const normalizedItems = items.map(normalizeOnboardingTask);
      const invalidTask = normalizedItems.find(item => item.error);
      if (invalidTask) {
        await conn.rollback();
        return res.status(400).json({ error: invalidTask.error });
      }
      items = normalizedItems;
      if (!items.length) {
        await conn.rollback();
        return res.status(400).json({ error: 'Onboarding requires at least one task', code: 'ONBOARDING_TASK_REQUIRED' });
      }

      await conn.query(
        `INSERT INTO employee_onboarding (id, tenant_id, staff_id, template_id) VALUES (?,?,?,?)`,
        [onboardingId, req.tenantId, staff_id, template_id||null]
      );

      if (items.length > 0) {
        const onbInsertRows = items.map(() => '(?,?,?,?,?,?,?)');
        const onbInsertParams = items.flatMap(t => {
          const dueDate = new Date(hireDate);
          dueDate.setDate(dueDate.getDate() + t.dueDays);
          return [uuidv4(), req.tenantId, onboardingId, t.title, t.category, dueDate.toISOString().slice(0,10), t.sortOrder];
        });
        await conn.query(
          `INSERT INTO employee_onboarding_items (id, tenant_id, onboarding_id, task_title, category, due_date, sort_order) VALUES ${onbInsertRows.join(',')}`,
          onbInsertParams
        );
      }

      const [itemRows] = await conn.query(
        `SELECT id, onboarding_id, task_title, category, due_date, completed_at, completed_by, notes, sort_order
           FROM employee_onboarding_items WHERE onboarding_id=? AND tenant_id=? ORDER BY sort_order`,
        [onboardingId, req.tenantId]
      );
      await writeAuditEvent({
        action: 'hr.onboarding.started',
        entityType: 'employee_onboarding',
        entityId: onboardingId,
        metadata: { staff_id, template_id: template_id || null, task_count: itemRows.length },
        req,
        db: conn,
      });
      await conn.commit();
      res.json({ id: onboardingId, items: itemRows });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// Toggle onboarding item complete/incomplete
router.put('/api/admin/hr/onboarding/items/:itemId', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  try {
    const { done, notes } = req.body;
    const now = done ? new Date().toISOString().slice(0,19).replace('T',' ') : null;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[existing]] = await conn.query(
        `SELECT i.id,i.onboarding_id,o.status onboarding_status
           FROM employee_onboarding_items i
           JOIN employee_onboarding o ON o.id=i.onboarding_id AND o.tenant_id=i.tenant_id
          WHERE i.id=? AND i.tenant_id=? LIMIT 1 FOR UPDATE`,
        [req.params.itemId, req.tenantId]
      );
      if (!existing) {
        await conn.rollback();
        return res.status(404).json({ error: 'Onboarding item not found' });
      }
      if (existing.onboarding_status === 'cancelled') {
        await conn.rollback();
        return res.status(409).json({ error: 'Cancelled onboarding is immutable', code: 'ONBOARDING_CANCELLED' });
      }
      const [updated] = await conn.query(
        `UPDATE employee_onboarding_items SET completed_at=?, completed_by=?, notes=COALESCE(?,notes) WHERE id=? AND tenant_id=?`,
        [now, done ? (req.staffRecord?.id||null) : null, notes||null, req.params.itemId, req.tenantId]
      );
      if (!updated.affectedRows) {
        await conn.rollback();
        return res.status(404).json({ error: 'Onboarding item not found' });
      }
      const [[item]] = await conn.query(
        'SELECT onboarding_id FROM employee_onboarding_items WHERE id=? AND tenant_id=? FOR UPDATE',
        [req.params.itemId, req.tenantId]
      );
      const [[cnt]] = await conn.query(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done
           FROM employee_onboarding_items WHERE onboarding_id=? AND tenant_id=?`,
        [item.onboarding_id, req.tenantId]
      );
      if (Number(cnt.total) > 0 && Number(cnt.total) === Number(cnt.done)) {
        await conn.query(`UPDATE employee_onboarding SET status='completed', completed_at=NOW() WHERE id=? AND tenant_id=?`, [item.onboarding_id, req.tenantId]);
      } else {
        await conn.query(`UPDATE employee_onboarding SET status='in_progress', completed_at=NULL WHERE id=? AND tenant_id=?`, [item.onboarding_id, req.tenantId]);
      }
      const [[row]] = await conn.query(
        `SELECT id, onboarding_id, task_title, category, due_date, completed_at, completed_by, notes, sort_order
           FROM employee_onboarding_items WHERE id=? AND tenant_id=?`,
        [req.params.itemId, req.tenantId]
      );
      await writeAuditEvent({
        action: done ? 'hr.onboarding.task.completed' : 'hr.onboarding.task.reopened',
        entityType: 'employee_onboarding_item',
        entityId: req.params.itemId,
        metadata: { onboarding_id: existing.onboarding_id },
        req,
        db: conn,
      });
      await conn.commit();
      res.json(row);
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ══════════════════════════════════════════════════════════════
// HR v14 — BI Reports
// ══════════════════════════════════════════════════════════════

module.exports = router;
