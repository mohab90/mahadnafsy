'use strict';

// Website recruiting bridge: public join applications become tenant-owned HR
// applicants, then inactive staff records that require explicit activation.
const { Router } = require('express');
const router = Router();
const {
  requirePermission, pool, uuidv4, requireAuth, requireAdminOrStaff,
  createNotification, logger,
} = require('./_shared');

const ROLE_FOR_TYPE = { INSTRUCTOR: 'instructor', CONSULTANT: 'consultant', EMPLOYEE: 'support' };
const talentPoolJobId = tenantId => `talent-${String(tenantId || 'tenant-default').slice(0, 29)}`;

async function ensureTalentPoolJob(tenantId) {
  const id = talentPoolJobId(tenantId);
  try {
    await pool.query(
      `INSERT IGNORE INTO job_postings
         (id, tenant_id, title, employment_type, status, description)
       VALUES (?, ?, 'Website applicants (Talent Pool)', 'full_time', 'open',
               'Automatically collected website applications')`,
      [id, tenantId]
    );
  } catch (error) {
    logger.warn('[hr/talent] ensure pool job:', error.message);
    throw error;
  }
  return id;
}

async function convertJoinUs(j, { jobId, actorId } = {}) {
  const tenantId = j.tenant_id || 'tenant-default';
  const targetJob = jobId || await ensureTalentPoolJob(tenantId);
  const appId = uuidv4();
  const notes = [j.specialty ? `Specialty: ${j.specialty}` : '', j.experience || '', j.message || '']
    .filter(Boolean).join('\n');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[source]] = await conn.query(
      'SELECT id, converted_applicant_id FROM join_us_applications WHERE id=? AND tenant_id=? FOR UPDATE',
      [j.id, tenantId]
    );
    if (!source) throw new Error('Join application not found in tenant');
    if (source.converted_applicant_id) {
      await conn.commit();
      return source.converted_applicant_id;
    }
    const [[job]] = await conn.query(
      'SELECT id FROM job_postings WHERE id=? AND tenant_id=? LIMIT 1',
      [targetJob, tenantId]
    );
    if (!job) throw new Error('Target job not found in tenant');
    await conn.query(
      `INSERT INTO job_applicants
         (id, tenant_id, job_id, name, email, phone, notes, source, source_id,
          specialty, applicant_type, linkedin, updated_by)
       VALUES (?,?,?,?,?,?,?, 'website', ?,?,?,?,?)`,
      [appId, tenantId, targetJob, j.name, j.email || null, j.phone || null, notes,
        j.id, j.specialty || null, j.type || null, j.linkedin || null, actorId || null]
    );
    await conn.query(
      `UPDATE join_us_applications
       SET status='REVIEWED', converted_applicant_id=?, reviewed_at=NOW(),
           assigned_to=COALESCE(assigned_to,?)
       WHERE id=? AND tenant_id=?`,
      [appId, actorId || null, j.id, tenantId]
    );
    await conn.commit();
    return appId;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

router.get('/api/admin/hr/talent-pool', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT j.id, j.name, j.email, j.phone, j.specialty, j.type AS applicant_type,
              j.linkedin, j.status, j.created_at, j.reviewed_at, j.converted_applicant_id,
              a.stage AS applicant_stage, a.job_id, a.hired_staff_id
       FROM join_us_applications j
       LEFT JOIN job_applicants a ON a.id=j.converted_applicant_id AND a.tenant_id=j.tenant_id
       WHERE j.tenant_id=? ORDER BY j.created_at DESC LIMIT 300`,
      [req.tenantId]
    );
    res.json(rows);
  } catch (error) {
    logger.error('[hr/talent-pool]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/hr/join-us/:id/to-applicant', requireAuth, requireAdminOrStaff, requirePermission('view_hr'), async (req, res) => {
  try {
    const [[j]] = await pool.query(
      'SELECT * FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1',
      [req.params.id, req.tenantId]
    );
    if (!j) return res.status(404).json({ error: 'Not found' });
    if (j.converted_applicant_id) {
      return res.status(409).json({ error: 'Already in pipeline', applicantId: j.converted_applicant_id });
    }
    const appId = await convertJoinUs(j, { jobId: req.body.job_id, actorId: req.staffRecord?.id });
    const [[app]] = await pool.query(
      `SELECT id, job_id, name, email, phone, stage, source, specialty, applicant_type
       FROM job_applicants WHERE id=? AND tenant_id=?`,
      [appId, req.tenantId]
    );
    res.json({ ok: true, applicant: app });
  } catch (error) {
    logger.error('[hr/to-applicant]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/hr/applicants/:appId/hire', requireAuth, requireAdminOrStaff, requirePermission('manage_hr'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[a]] = await conn.query(
      'SELECT * FROM job_applicants WHERE id=? AND tenant_id=? FOR UPDATE',
      [req.params.appId, req.tenantId]
    );
    if (!a) {
      await conn.rollback();
      return res.status(404).json({ error: 'Not found' });
    }
    if (a.hired_staff_id) {
      await conn.rollback();
      return res.status(409).json({ error: 'Already hired', staffId: a.hired_staff_id });
    }
    const role = req.body.role || ROLE_FOR_TYPE[String(a.applicant_type || '').toUpperCase()] || 'support';
    let staffId = null;
    if (a.email) {
      const [[existing]] = await conn.query(
        'SELECT id FROM staff WHERE LOWER(TRIM(email))=? AND tenant_id=? LIMIT 1',
        [String(a.email).toLowerCase().trim(), req.tenantId]
      );
      staffId = existing?.id || null;
    }
    if (!staffId) {
      staffId = uuidv4();
      await conn.query(
        `INSERT INTO staff
           (id, tenant_id, branch_id, name, email, phone, role, is_active, employment_type, hire_date)
         VALUES (?,?,?,?,?,?,?, 0, 'full_time', CURDATE())`,
        [staffId, req.tenantId, req.tenantBranchId || null, a.name, a.email || null, a.phone || null, role]
      );
    }
    await conn.query(
      "UPDATE job_applicants SET stage='hired', hired_staff_id=?, updated_by=? WHERE id=? AND tenant_id=?",
      [staffId, req.staffRecord?.id || null, a.id, req.tenantId]
    );
    if (a.source === 'website' && a.source_id) {
      await conn.query(
        "UPDATE join_us_applications SET status='ACCEPTED' WHERE id=? AND tenant_id=?",
        [a.source_id, req.tenantId]
      );
    }
    await conn.commit();
    createNotification('hr', 'New hire awaiting activation', `${a.name} (${role})`, { staffId }).catch(() => {});
    res.json({ ok: true, staffId, role, activation_required: true });
  } catch (error) {
    await conn.rollback();
    logger.error('[hr/hire]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

module.exports = { router, convertJoinUs, ensureTalentPoolJob };
